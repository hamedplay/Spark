/**
 * callDebugStore.ts — in-memory bounded ring buffer for E2EE call diagnostics.
 *
 * SECURITY NOTE: this store NEVER persists cryptographic key material.
 * Stored fields are redacted at ingestion. Only fingerprints/truncated IDs
 * of sensitive values are kept.
 */

import { v4 as uuidv4 } from 'uuid';

// ── Runtime debug flag ──────────────────────────────────────────────────────

export function isCallDebugEnabled(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) return true;
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('e2ee_debug') === '1';
  } catch {
    return false;
  }
}

// ── Types ───────────────────────────────────────────────────────────────────

export type CallDebugLevel = 'info' | 'warn' | 'error';

export type CallDebugCategory =
  | 'lifecycle'
  | 'media'
  | 'peer-connection'
  | 'ice'
  | 'signaling'
  | 'sdp'
  | 'rtp'
  | 'e2ee'
  | 'transform'
  | 'worker'
  | 'crypto';

export interface CallDebugEvent {
  id: string;
  timestamp: number;
  elapsedMs: number;
  level: CallDebugLevel;
  category: CallDebugCategory;
  endpointRole: 'caller' | 'callee' | null;
  sessionId?: string;
  peerConnectionId?: string;
  generation?: number;
  event: string;
  data?: Record<string, unknown>;
}

export interface RTPSnapshot {
  timestamp: number;
  pcStates: {
    connectionState: string;
    iceConnectionState: string;
    iceGatheringState: string;
    signalingState: string;
  };
  candidatePair: {
    localType: string;
    remoteType: string;
    localAddress: string;
    remoteAddress: string;
  } | null;
  senders: Array<{
    index: number;
    kind: string;
    trackEnabled: boolean;
    trackMuted: boolean;
    trackReadyState: string;
    mid: string | null;
    direction: string;
    currentDirection: string;
    bytesSent: number;
    packetsSent: number;
    framesEncoded: number;
    nackCount: number;
    pliCount: number;
  }>;
  receivers: Array<{
    index: number;
    kind: string;
    trackMuted: boolean;
    trackReadyState: string;
    mid: string | null;
    direction: string;
    currentDirection: string;
    bytesReceived: number;
    packetsReceived: number;
    packetsLost: number;
    jitter: number;
    framesReceived: number;
    framesDecoded: number;
    audioLevel: number | null;
  }>;
  portRecordStates: Array<{
    id: string;
    role: string;
    kind: string;
    state: string;
    installedEpoch: number | null;
  }>;
}

export interface MediaHealthClassification {
  kind: 'audio' | 'video';
  direction: 'send' | 'recv';
  classification:
    | 'HEALTHY'
    | 'LOCAL_CAPTURE_FAILURE'
    | 'LOCAL_SENDER_MISSING'
    | 'LOCAL_SENDER_STALLED'
    | 'NEGOTIATED_NOT_SENDRECV'
    | 'INBOUND_RTP_STALLED'
    | 'RECEIVER_TRANSFORM_MISSING'
    | 'E2EE_RECEIVER_NOT_READY'
    | 'E2EE_DECRYPT_FAILURE'
    | 'DECODER_STALLED'
    | 'REMOTE_TRACK_MISSING'
    | 'REMOTE_PLAYBACK_BLOCKED'
    | 'REMOTE_RENDER_OR_AUTOPLAY_FAILURE'
    | 'UNKNOWN';
  persianExplanation: string;
}

// ── Ring buffer ─────────────────────────────────────────────────────────────

const MAX_EVENTS   = 750;
const MAX_SNAPSHOTS = 30;

let sessionStartMs = Date.now();
let currentRole: 'caller' | 'callee' | null = null;
let currentSessionId: string | undefined;
let currentPCId: string | undefined;
let currentGeneration: number | undefined;

const events: CallDebugEvent[]   = [];
const snapshots: RTPSnapshot[]   = [];
let listeners: Array<() => void> = [];

export function debugStoreSetSession(opts: {
  role: 'caller' | 'callee' | null;
  sessionId?: string;
  peerConnectionId?: string;
  generation?: number;
}) {
  if (opts.role !== undefined) currentRole = opts.role;
  if (opts.sessionId     !== undefined) currentSessionId  = opts.sessionId;
  if (opts.peerConnectionId !== undefined) currentPCId   = opts.peerConnectionId;
  if (opts.generation    !== undefined) currentGeneration = opts.generation;
  sessionStartMs = Date.now();
}

export function debugStoreReset() {
  events.length    = 0;
  snapshots.length = 0;
  sessionStartMs   = Date.now();
  currentRole      = null;
  currentSessionId = undefined;
  currentPCId      = undefined;
  currentGeneration = undefined;
  notifyListeners();
}

function notifyListeners() {
  for (const fn of listeners) { try { fn(); } catch { /* ignore */ } }
}

export function debugStoreSubscribe(fn: () => void): () => void {
  listeners.push(fn);
  return () => { listeners = listeners.filter(l => l !== fn); };
}

// ── Emit ────────────────────────────────────────────────────────────────────

export function dbg(
  level: CallDebugLevel,
  category: CallDebugCategory,
  event: string,
  data?: Record<string, unknown>,
  overrides?: Partial<Pick<CallDebugEvent, 'peerConnectionId' | 'generation' | 'endpointRole' | 'sessionId'>>,
): void {
  const ev: CallDebugEvent = {
    id:              uuidv4(),
    timestamp:       Date.now(),
    elapsedMs:       Date.now() - sessionStartMs,
    level,
    category,
    endpointRole:    overrides?.endpointRole ?? currentRole,
    sessionId:       overrides?.sessionId    ?? (currentSessionId ? currentSessionId.slice(0, 8) : undefined),
    peerConnectionId: overrides?.peerConnectionId ?? (currentPCId ? currentPCId.slice(0, 8) : undefined),
    generation:      overrides?.generation   ?? currentGeneration,
    event,
    data: data ? redactData(data) : undefined,
  };

  events.push(ev);
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
  notifyListeners();
}

export function dbgInfo (cat: CallDebugCategory, event: string, data?: Record<string, unknown>) { dbg('info',  cat, event, data); }
export function dbgWarn (cat: CallDebugCategory, event: string, data?: Record<string, unknown>) { dbg('warn',  cat, event, data); }
export function dbgError(cat: CallDebugCategory, event: string, data?: Record<string, unknown>) { dbg('error', cat, event, data); }

// ── RTP Snapshots ───────────────────────────────────────────────────────────

export function pushRTPSnapshot(snap: RTPSnapshot): void {
  snapshots.push(snap);
  if (snapshots.length > MAX_SNAPSHOTS) snapshots.splice(0, snapshots.length - MAX_SNAPSHOTS);
  notifyListeners();
}

// ── Read-only accessors ─────────────────────────────────────────────────────

export function getDebugEvents(): ReadonlyArray<CallDebugEvent> { return events; }
export function getRTPSnapshots(): ReadonlyArray<RTPSnapshot>   { return snapshots; }
export function getLatestSnapshot(): RTPSnapshot | null         { return snapshots[snapshots.length - 1] ?? null; }

// ── Redaction ───────────────────────────────────────────────────────────────

const SENSITIVE_KEYS = new Set([
  'key', 'keyData', 'ivSeed', 'privateKey', 'sharedSecret', 'hkdfKey',
  'rawSecret', 'aesKey', 'token', 'accessToken', 'password', 'secret',
  'jwk', 'publicKey', 'd', 'x', 'y',
]);

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key)) return '[REDACTED]';
  if (key === 'requestId' && typeof value === 'string') return value.slice(0, 8);
  if (key === 'sessionId' && typeof value === 'string') return value.slice(0, 8);
  if (key === 'deviceId'  && typeof value === 'string') return '[DEVICE_ID]';
  if (key === 'sdp'       && typeof value === 'string') return '[SDP_REDACTED]';
  return value;
}

function redactData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      out[k] = redactData(v as Record<string, unknown>);
    } else {
      out[k] = redactValue(k, v);
    }
  }
  return out;
}

// ── Key fingerprint helper (SHA-256 prefix, NOT the key itself) ─────────────

export async function keyFingerprint(material: ArrayBuffer): Promise<string> {
  try {
    const hash = await crypto.subtle.digest('SHA-256', material);
    return Array.from(new Uint8Array(hash).slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return 'unknown';
  }
}

// ── Debug report builder ────────────────────────────────────────────────────

export interface CallDebugReport {
  generatedAt:   string;
  userAgent:     string;
  role:          string | null;
  sessionId:     string | undefined;
  generation:    number | undefined;
  events:        CallDebugEvent[];
  latestSnapshot: RTPSnapshot | null;
  snapshotCount: number;
}

export function buildDebugReport(): CallDebugReport {
  return {
    generatedAt:    new Date().toISOString(),
    userAgent:      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    role:           currentRole,
    sessionId:      currentSessionId ? currentSessionId.slice(0, 8) : undefined,
    generation:     currentGeneration,
    events:         [...events],
    latestSnapshot: getLatestSnapshot(),
    snapshotCount:  snapshots.length,
  };
}

// ── Media health analyser ───────────────────────────────────────────────────

interface HealthContext {
  prev: RTPSnapshot | null;
  curr: RTPSnapshot;
  portRecordStates: Array<{ role: string; kind: string; state: string }>;
  remoteVideoElement: HTMLVideoElement | null;
  localTracks: MediaStreamTrack[];
  stalledCounters: Map<string, number>; // key → consecutive stalled snapshot count
}

export function analyseMediaHealth(ctx: HealthContext): MediaHealthClassification[] {
  const results: MediaHealthClassification[] = [];
  const kinds: Array<'audio' | 'video'> = ['audio', 'video'];

  for (const kind of kinds) {
    results.push(analyseSend(kind, ctx));
    results.push(analyseRecv(kind, ctx));
  }

  return results;
}

function analyseSend(kind: 'audio' | 'video', ctx: HealthContext): MediaHealthClassification {
  const sender = ctx.curr.senders.find(s => s.kind === kind);
  const prevSender = ctx.prev?.senders.find(s => s.kind === kind);

  const label = kind === 'audio' ? 'صدای ارسالی' : 'ویدیو ارسالی';

  if (!sender) {
    return { kind, direction: 'send', classification: 'LOCAL_SENDER_MISSING',
      persianExplanation: `${label}: RTCRtpSender برای ${kind} پیدا نشد. Track احتمالاً به PC اضافه نشده.` };
  }

  if (!sender.trackEnabled || sender.trackReadyState !== 'live') {
    return { kind, direction: 'send', classification: 'LOCAL_CAPTURE_FAILURE',
      persianExplanation: `${label}: Track میکروفون/دوربین غیرفعال یا خاتمه یافته است.` };
  }

  if (sender.direction !== 'sendrecv' && sender.direction !== 'sendonly') {
    return { kind, direction: 'send', classification: 'NEGOTIATED_NOT_SENDRECV',
      persianExplanation: `${label}: جهت transceiver '${sender.direction}' است. انتظار sendrecv بود.` };
  }

  if (prevSender) {
    const bytesDelta = sender.bytesSent - prevSender.bytesSent;
    if (bytesDelta === 0) {
      const key = `send-${kind}`;
      const count = (ctx.stalledCounters.get(key) ?? 0) + 1;
      ctx.stalledCounters.set(key, count);
      if (count >= 3) {
        return { kind, direction: 'send', classification: 'LOCAL_SENDER_STALLED',
          persianExplanation: `${label}: bytesSent در ${count} snapshot متوالی افزایش نداشت. مشکل احتمالی: Transform رمزنگاری یا ICE.` };
      }
    } else {
      ctx.stalledCounters.delete(`send-${kind}`);
    }
  }

  return { kind, direction: 'send', classification: 'HEALTHY',
    persianExplanation: `${label}: ارسال فعال است.` };
}

function analyseRecv(kind: 'audio' | 'video', ctx: HealthContext): MediaHealthClassification {
  const receiver = ctx.curr.receivers.find(r => r.kind === kind);
  const prevReceiver = ctx.prev?.receivers.find(r => r.kind === kind);
  const portRec = ctx.portRecordStates.find(pr => pr.role === 'receiver' && pr.kind === kind);

  const label = kind === 'audio' ? 'صدای دریافتی' : 'ویدیو دریافتی';

  if (!receiver) {
    return { kind, direction: 'recv', classification: 'REMOTE_TRACK_MISSING',
      persianExplanation: `${label}: RTCRtpReceiver پیدا نشد. ontrack احتمالاً فیره نشده.` };
  }

  if (!portRec) {
    return { kind, direction: 'recv', classification: 'RECEIVER_TRANSFORM_MISSING',
      persianExplanation: `${label}: PortRecord برای receiver/${kind} وجود ندارد. Transform ثبت نشده.` };
  }

  if (portRec.state !== 'key-ready') {
    return { kind, direction: 'recv', classification: 'E2EE_RECEIVER_NOT_READY',
      persianExplanation: `${label}: بسته‌های RTP وارد می‌شوند اما Transform رمزگشایی در وضعیت '${portRec.state}' است. احتمال: مشکل نصب کلید E2EE.` };
  }

  if (prevReceiver) {
    const bytesDelta = receiver.bytesReceived - prevReceiver.bytesReceived;
    if (bytesDelta === 0) {
      const key = `recv-${kind}`;
      const count = (ctx.stalledCounters.get(key) ?? 0) + 1;
      ctx.stalledCounters.set(key, count);
      if (count >= 3) {
        return { kind, direction: 'recv', classification: 'INBOUND_RTP_STALLED',
          persianExplanation: `${label}: bytesReceived در ${count} snapshot متوالی افزایش نداشت. مشکل احتمالی: ICE یا ارسال از طرف مقابل.` };
      }
    } else {
      ctx.stalledCounters.delete(`recv-${kind}`);
      if (kind === 'video' && receiver.framesDecoded === prevReceiver.framesDecoded && receiver.bytesReceived > prevReceiver.bytesReceived) {
        return { kind, direction: 'recv', classification: 'DECODER_STALLED',
          persianExplanation: `${label}: بایت‌ها دریافت می‌شوند اما framesDecoded افزایش نمی‌یابد. مشکل decoder یا رمزگشایی E2EE.` };
      }
    }
  }

  if (kind === 'video' && ctx.remoteVideoElement) {
    const v = ctx.remoteVideoElement;
    if (!v.srcObject) {
      return { kind, direction: 'recv', classification: 'REMOTE_RENDER_OR_AUTOPLAY_FAILURE',
        persianExplanation: `${label}: RTP دریافت می‌شود اما srcObject ویدیو null است. Track به element متصل نشده.` };
    }
    if (v.paused && (v.srcObject as MediaStream)?.getVideoTracks().some(t => t.readyState === 'live')) {
      return { kind, direction: 'recv', classification: 'REMOTE_RENDER_OR_AUTOPLAY_FAILURE',
        persianExplanation: `${label}: Track زنده است اما play() اجرا نشده. احتمال: سیاست autoplay مرورگر.` };
    }
  }

  return { kind, direction: 'recv', classification: 'HEALTHY',
    persianExplanation: `${label}: دریافت فعال است.` };
}
