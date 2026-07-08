import { supabase } from '../../../lib/supabase';
import { dbgInfo, dbgWarn, dbgError } from './callDebugStore';
import { log } from './types';
import { v4 as uuidv4 } from 'uuid';

// ── Subscribe error types ─────────────────────────────────────────────────

export type RealtimeSubscribeFailureKind =
  | 'SUPABASE_TIMED_OUT'
  | 'SUPABASE_CHANNEL_ERROR'
  | 'CHANNEL_CLOSED'
  | 'CUSTOM_SUBSCRIBE_TIMEOUT';

export interface SafeRealtimeError {
  name: string;
  message: string;
  causeName?: string;
  causeMessage?: string;
}

export class RealtimeSubscribeError extends Error {
  readonly kind: RealtimeSubscribeFailureKind;
  readonly status: string;
  readonly safeCause: SafeRealtimeError | null;
  readonly purpose: string;
  readonly attemptId: string;

  constructor(opts: {
    kind: RealtimeSubscribeFailureKind;
    status: string;
    safeCause?: SafeRealtimeError;
    purpose: string;
    attemptId: string;
  }) {
    super(`Realtime subscribe failed: ${opts.kind} (status=${opts.status}) purpose=${opts.purpose}`);
    this.name = 'RealtimeSubscribeError';
    this.kind = opts.kind;
    this.status = opts.status;
    this.safeCause = opts.safeCause ?? null;
    this.purpose = opts.purpose;
    this.attemptId = opts.attemptId;
  }
}

// ── Channel purpose ───────────────────────────────────────────────────────

export type ChannelPurpose =
  | 'session'
  | 'callee-inbox'
  | 'callee-global-inbox'
  | 'reject-temp'
  | 'busy-reject-temp'
  | 'user-inbox';

export interface SubscribeAttemptMeta {
  attemptId:    string;
  purpose:      ChannelPurpose;
  generation:   number;
  sessionId:    string;
  channelId:    string;
  topicSummary: string;
  startedAt:    number;
}

// ── Active channel registry ───────────────────────────────────────────────
// In-memory only. Tracks lifecycle of call-related channels for diagnostics.

export interface ChannelRecord {
  channelId:         string;
  purpose:           ChannelPurpose;
  generation:        number;
  sessionId:         string;
  topicSummary:      string;
  status:            'created' | 'subscribing' | 'subscribed' | 'failed' | 'removed';
  lastSupabaseStatus: string;
  subscribeAttemptId: string;
  createdAt:         number;
  subscribeStartedAt: number | null;
  subscribedAt:      number | null;
  closedAt:          number | null;
  safeLastError:     SafeRealtimeError | null;
}

const _channelRegistry = new Map<string, ChannelRecord>();

export function getChannelRegistry(): ReadonlyMap<string, ChannelRecord> {
  return _channelRegistry;
}

export function getSessionChannelRecord(generation: number, sessionId: string): ChannelRecord | null {
  for (const rec of _channelRegistry.values()) {
    if (rec.purpose === 'session' && rec.generation === generation && rec.sessionId === sessionId) {
      return rec;
    }
  }
  return null;
}

export function clearChannelRegistry() {
  _channelRegistry.clear();
}

function safeErrorMeta(err: unknown): SafeRealtimeError | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as Record<string, unknown>;
  const cause = e.cause as Record<string, unknown> | undefined;
  return {
    name:         typeof e.name    === 'string' ? e.name    : 'unknown',
    message:      typeof e.message === 'string' ? scrubSensitive(e.message) : 'unknown',
    causeName:    typeof cause?.name    === 'string' ? cause.name    : undefined,
    causeMessage: typeof cause?.message === 'string' ? scrubSensitive(cause.message) : undefined,
  };
}

const SCRUB_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+/g,
  /apikey=[^\s&"]+/gi,
  /token=[^\s&"]+/gi,
  /Authorization[^\s]*/gi,
];

function scrubSensitive(s: string): string {
  let out = s;
  for (const pat of SCRUB_PATTERNS) out = out.replace(pat, '[REDACTED]');
  return out.slice(0, 300);
}

// ── subscribeChannelOrThrow ───────────────────────────────────────────────
// The ONLY function that calls channel.subscribe().
// Resolves when SUBSCRIBED. Rejects with RealtimeSubscribeError otherwise.

export function subscribeChannelOrThrow(
  ch: ReturnType<typeof supabase.channel>,
  meta: SubscribeAttemptMeta,
  timeoutMs = 15_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const rec: ChannelRecord = {
      channelId:         meta.channelId,
      purpose:           meta.purpose,
      generation:        meta.generation,
      sessionId:         meta.sessionId,
      topicSummary:      meta.topicSummary,
      status:            'subscribing',
      lastSupabaseStatus: '',
      subscribeAttemptId: meta.attemptId,
      createdAt:         meta.startedAt,
      subscribeStartedAt: Date.now(),
      subscribedAt:      null,
      closedAt:          null,
      safeLastError:     null,
    };
    _channelRegistry.set(meta.channelId, rec);

    dbgInfo('signaling', 'channel-subscribe-start', {
      attemptId:    meta.attemptId,
      purpose:      meta.purpose,
      generation:   meta.generation,
      sessionId:    meta.sessionId.slice(0, 8),
      topicSummary: meta.topicSummary,
    });

    const customTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rec.status = 'failed';
      rec.closedAt = Date.now();
      const safeCause: SafeRealtimeError = { name: 'CustomTimeout', message: `subscribe timed out after ${timeoutMs}ms` };
      rec.safeLastError = safeCause;
      const err = new RealtimeSubscribeError({
        kind: 'CUSTOM_SUBSCRIBE_TIMEOUT',
        status: rec.lastSupabaseStatus || 'pending',
        safeCause,
        purpose: meta.purpose,
        attemptId: meta.attemptId,
      });
      dbgError('signaling', 'channel-custom-timeout', {
        attemptId: meta.attemptId, purpose: meta.purpose, timeoutMs,
      });
      reject(err);
    }, timeoutMs);

    ch.subscribe((status, err) => {
      rec.lastSupabaseStatus = status;
      dbgInfo('signaling', 'channel-subscribe-status', {
        attemptId: meta.attemptId, purpose: meta.purpose, status,
        hasErr: !!err,
      });

      if (status === 'SUBSCRIBED') {
        if (settled) return;
        settled = true;
        clearTimeout(customTimer);
        rec.status = 'subscribed';
        rec.subscribedAt = Date.now();
        dbgInfo('signaling', 'channel-subscribed', {
          attemptId: meta.attemptId, purpose: meta.purpose,
          elapsedMs: rec.subscribedAt - (rec.subscribeStartedAt ?? rec.subscribedAt),
        });
        resolve();
        return;
      }

      if (status === 'TIMED_OUT') {
        if (settled) return;
        settled = true;
        clearTimeout(customTimer);
        const safeCause = safeErrorMeta(err);
        rec.status = 'failed';
        rec.closedAt = Date.now();
        if (safeCause) rec.safeLastError = safeCause;
        const e = new RealtimeSubscribeError({
          kind: 'SUPABASE_TIMED_OUT',
          status,
          safeCause,
          purpose: meta.purpose,
          attemptId: meta.attemptId,
        });
        dbgError('signaling', 'channel-subscribe-failed', {
          attemptId: meta.attemptId, purpose: meta.purpose, kind: e.kind, status,
        });
        reject(e);
        return;
      }

      if (status === 'CHANNEL_ERROR') {
        if (settled) return;
        settled = true;
        clearTimeout(customTimer);
        const safeCause = safeErrorMeta(err);
        rec.status = 'failed';
        rec.closedAt = Date.now();
        if (safeCause) rec.safeLastError = safeCause;
        const e = new RealtimeSubscribeError({
          kind: 'SUPABASE_CHANNEL_ERROR',
          status,
          safeCause,
          purpose: meta.purpose,
          attemptId: meta.attemptId,
        });
        dbgError('signaling', 'channel-subscribe-failed', {
          attemptId: meta.attemptId, purpose: meta.purpose, kind: e.kind, status,
          safeErr: safeCause?.message,
        });
        reject(e);
        return;
      }

      if (status === 'CLOSED') {
        if (settled) return;
        settled = true;
        clearTimeout(customTimer);
        const safeCause = safeErrorMeta(err);
        rec.status = 'failed';
        rec.closedAt = Date.now();
        if (safeCause) rec.safeLastError = safeCause;
        const e = new RealtimeSubscribeError({
          kind: 'CHANNEL_CLOSED',
          status,
          safeCause,
          purpose: meta.purpose,
          attemptId: meta.attemptId,
        });
        dbgError('signaling', 'channel-subscribe-failed', {
          attemptId: meta.attemptId, purpose: meta.purpose, kind: e.kind, status,
        });
        reject(e);
      }
    });
  });
}

// ── Safe channel removal ──────────────────────────────────────────────────

export async function safeRemoveChannel(
  ch: ReturnType<typeof supabase.channel> | null,
  channelId: string,
  delayMs = 0,
): Promise<void> {
  if (!ch) return;
  const rec = _channelRegistry.get(channelId);
  dbgInfo('signaling', 'channel-remove-start', { channelId: channelId.slice(0, 8) });
  if (delayMs > 0) {
    await new Promise(r => setTimeout(r, delayMs));
  }
  try {
    await supabase.removeChannel(ch);
  } catch { /* ignore */ }
  if (rec) {
    rec.status = 'removed';
    rec.closedAt = rec.closedAt ?? Date.now();
  }
  dbgInfo('signaling', 'channel-removed', { channelId: channelId.slice(0, 8) });
}

// ── Validators (unchanged) ────────────────────────────────────────────────

export function validateIceCandidate(c: unknown): c is RTCIceCandidateInit {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (typeof o.candidate !== 'string' || o.candidate.length > 2000) return false;
  if ('sdpMid' in o && o.sdpMid !== null && typeof o.sdpMid !== 'string') return false;
  if ('sdpMLineIndex' in o && o.sdpMLineIndex !== null && !Number.isInteger(o.sdpMLineIndex)) return false;
  if ('usernameFragment' in o && o.usernameFragment !== null && typeof o.usernameFragment !== 'string') return false;
  return true;
}

export function validateSDP(sdp: unknown, expectedType: 'offer' | 'answer'): sdp is RTCSessionDescriptionInit {
  if (!sdp || typeof sdp !== 'object') return false;
  const o = sdp as Record<string, unknown>;
  if (o.type !== expectedType) return false;
  if (typeof o.sdp !== 'string' || o.sdp.length === 0 || o.sdp.length > 65536) return false;
  return true;
}

export function validateSignalPayload(
  payload: unknown,
  sessionId: string,
  lockedPeer: string | null,
): (Record<string, unknown> & { type: string; from: string }) | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.type !== 'string' || p.type.length === 0 || p.type.length > 50) return null;
  if (typeof p.from !== 'string' || p.from.length === 0 || p.from.length > 200) return null;
  if (p.session !== sessionId) {
    log('[E2EE][SIGNAL]', `drop: session mismatch got=${p.session} want=${sessionId}`);
    return null;
  }
  if (lockedPeer !== null && p.from !== lockedPeer) {
    log('[E2EE][SIGNAL]', `drop: locked-peer mismatch from=${p.from} locked=${lockedPeer}`);
    return null;
  }
  return p as Record<string, unknown> & { type: string; from: string };
}
