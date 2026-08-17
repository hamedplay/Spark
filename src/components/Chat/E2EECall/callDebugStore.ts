/**
 * callDebugStore.ts — in-memory bounded ring buffer for E2EE call diagnostics.
 *
 * SECURITY NOTE: this store NEVER persists cryptographic key material.
 * Stored fields are redacted at ingestion. Only safe metadata is kept.
 * Debug enablement uses sessionStorage (tab-scoped, never persisted).
 */

import { v4 as uuidv4 } from 'uuid';

// ── Runtime debug flag ──────────────────────────────────────────────────────
// Enable: sessionStorage.setItem('e2ee_debug','1'); location.reload();

export function isCallDebugEnabled(): boolean {
  if (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) return true;
  try {
    return typeof sessionStorage !== 'undefined' && sessionStorage.getItem('e2ee_debug') === '1';
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
    // Remote video rendering sub-classifications
    | 'REMOTE_ELEMENT_MISSING'
    | 'REMOTE_ELEMENT_DETACHED'
    | 'REMOTE_STREAM_NOT_BOUND'
    | 'REMOTE_VIDEO_NO_DIMENSIONS'
    | 'REMOTE_VIDEO_PAUSED'
    | 'REMOTE_VIDEO_NO_CURRENT_DATA'
    | 'REMOTE_VIDEO_ZERO_LAYOUT_SIZE'
    | 'DECODED_FRAMES_NOT_PRESENTED'
    // Remote audio rendering sub-classifications
    | 'REMOTE_AUDIO_SOURCE_SILENT_OR_VERY_LOW'
    | 'REMOTE_AUDIO_ELEMENT_MUTED'
    | 'REMOTE_AUDIO_VOLUME_ZERO'
    | 'REMOTE_AUDIO_AUTOPLAY_BLOCKED'
    | 'UNKNOWN';
  persianExplanation: string;
  // Rendering diagnostics (populated for remote video checks)
  renderDiag?: RemoteRenderDiag;
}

export interface RemoteRenderDiag {
  elementPresent:     boolean;
  elementAttached:    boolean;
  srcObjectBound:     boolean;
  videoWidth:         number;
  videoHeight:        number;
  paused:             boolean;
  readyState:         number;
  muted:              boolean;
  volume:             number;
  layoutWidth:        number;
  layoutHeight:       number;
  opacity:            string;
  visibility:         string;
  presentedFrames:    number | null;
}

// ── Ring buffer ─────────────────────────────────────────────────────────────

const MAX_EVENTS    = 750;
const MAX_SNAPSHOTS = 30;

let sessionStartMs    = Date.now();
let currentRole: 'caller' | 'callee' | null = null;
let currentSessionId: string | undefined;
let currentPCId: string | undefined;
let currentGeneration: number | undefined;
// 'ended' or 'failed' — set when cleanup preserves the timeline
let sessionLifecycleEnded = false;

const events: CallDebugEvent[] = [];
const snapshots: RTPSnapshot[] = [];
let listeners: Array<() => void> = [];

export function debugStoreSetSession(opts: {
  role?: 'caller' | 'callee' | null;
  sessionId?: string;
  peerConnectionId?: string;
  generation?: number;
}) {
  if (opts.role           !== undefined) currentRole       = opts.role;
  if (opts.sessionId      !== undefined) currentSessionId  = opts.sessionId;
  if (opts.peerConnectionId !== undefined) currentPCId     = opts.peerConnectionId;
  if (opts.generation     !== undefined) currentGeneration = opts.generation;
  sessionStartMs = Date.now();
  sessionLifecycleEnded = false;
}

// Mark the session ended/failed without erasing the event buffer.
// This allows the Debug Center to show the failure timeline after cleanup.
export function debugStoreMarkEnded(failReason?: string) {
  sessionLifecycleEnded = true;
  dbg('info', 'lifecycle', 'session-debug-lifecycle-ended', failReason ? { failReason } : undefined);
  notifyListeners();
}

export function isDebugSessionEnded(): boolean {
  return sessionLifecycleEnded;
}

// Called only at the START of a genuinely new call — wipes the previous timeline.
export function debugStoreReset() {
  events.length    = 0;
  snapshots.length = 0;
  sessionStartMs   = Date.now();
  currentRole      = null;
  currentSessionId = undefined;
  currentPCId      = undefined;
  currentGeneration = undefined;
  sessionLifecycleEnded = false;
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
    id:               uuidv4(),
    timestamp:        Date.now(),
    elapsedMs:        Date.now() - sessionStartMs,
    level,
    category,
    endpointRole:     overrides?.endpointRole    ?? currentRole,
    sessionId:        overrides?.sessionId       ?? (currentSessionId  ? currentSessionId.slice(0, 8)  : undefined),
    peerConnectionId: overrides?.peerConnectionId ?? (currentPCId       ? currentPCId.slice(0, 8)       : undefined),
    generation:       overrides?.generation      ?? currentGeneration,
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
  'jwk', 'publicKey', 'd', 'x', 'y', 'credential', 'username',
  'turn_username', 'turn_credential', 'turnUsername', 'turnCredential',
  'urls', 'iceServerUrl',
]);

const SENSITIVE_VALUE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9._-]+/gi,
  /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+/g,
  /apikey=[^\s&"]+/gi,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,   // IPv4
  /\[[0-9a-fA-F:]+\]/g,              // IPv6 in brackets
];

function redactString(value: string): string {
  let out = value;
  for (const pat of SENSITIVE_VALUE_PATTERNS) out = out.replace(pat, '[REDACTED]');
  return out;
}

function redactValue(key: string, value: unknown): unknown {
  if (SENSITIVE_KEYS.has(key)) return '[REDACTED]';
  if (key === 'requestId' && typeof value === 'string') return value.slice(0, 8);
  if (key === 'sessionId' && typeof value === 'string') return value.slice(0, 8);
  if (key === 'deviceId'  && typeof value === 'string') return '[DEVICE_ID]';
  if (key === 'sdp'       && typeof value === 'string') return '[SDP_REDACTED]';
  if (key === 'candidate' && typeof value === 'string') return '[ICE_CANDIDATE_REDACTED]';
  if (typeof value === 'string') return redactString(value);
  return value;
}

export function redactData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = redactAny(k, v);
  }
  return out;
}

function redactAny(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map(item => redactAny(key, item));
  }
  if (typeof value === 'object') {
    return redactData(value as Record<string, unknown>);
  }
  return redactValue(key, value);
}

// ── Debug report builder ────────────────────────────────────────────────────

export interface CallDebugReport {
  generatedAt:      string;
  userAgent:        string;
  role:             string | null;
  sessionId:        string | undefined;
  generation:       number | undefined;
  sessionEnded:     boolean;
  events:           CallDebugEvent[];
  latestSnapshot:   RTPSnapshot | null;
  snapshotCount:    number;
}

export function buildDebugReport(): CallDebugReport {
  return {
    generatedAt:    new Date().toISOString(),
    userAgent:      typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
    role:           currentRole,
    sessionId:      currentSessionId ? currentSessionId.slice(0, 8) : undefined,
    generation:     currentGeneration,
    sessionEnded:   sessionLifecycleEnded,
    events:         [...events],
    latestSnapshot: getLatestSnapshot(),
    snapshotCount:  snapshots.length,
  };
}

// ── Export sanitization ─────────────────────────────────────────────────────
// Applied immediately before clipboard copy or download Blob creation.
// Allowlist-based: only known-safe scalar fields pass through unchecked.

const EXPORT_BLOCKLIST = new Set([
  'sdp', 'candidate', 'key', 'keyData', 'ivSeed', 'privateKey', 'sharedSecret',
  'hkdfKey', 'rawSecret', 'aesKey', 'token', 'accessToken', 'password', 'secret',
  'jwk', 'publicKey', 'd', 'x', 'y', 'credential', 'username',
  'turn_username', 'turn_credential', 'Authorization', 'authorization',
]);

function sanitizeAny(key: string, value: unknown): unknown {
  if (EXPORT_BLOCKLIST.has(key)) return '[SANITIZED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  if (Array.isArray(value)) return value.map(item => sanitizeAny(key, item));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = sanitizeAny(k, v);
    }
    return out;
  }
  if (typeof value === 'string') {
    // Strip IP addresses and bearer tokens from strings
    return value
      .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, '[SANITIZED]')
      .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+/g, '[SANITIZED]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}(:\d+)?\b/g, '[IP_REDACTED]')
      .replace(/\[[0-9a-fA-F:]+\](:\d+)?/g, '[IP_REDACTED]')
      .slice(0, 2000);
  }
  return value;
}

export function sanitizeDebugReportForExport(report: CallDebugReport): CallDebugReport {
  return sanitizeAny('report', report) as CallDebugReport;
}

// ── Media health analyser ───────────────────────────────────────────────────

interface HealthContext {
  prev: RTPSnapshot | null;
  curr: RTPSnapshot;
  portRecordStates: Array<{ role: string; kind: string; state: string }>;
  remoteVideoElement: HTMLVideoElement | null;
  localTracks: MediaStreamTrack[];
  stalledCounters: Map<string, number>;
  // Optional: canonical visible remote element (for render audit)
  remoteVisibleElement?: HTMLVideoElement | null;
  // Optional: presented frame counter from requestVideoFrameCallback
  presentedFrameCount?: number | null;
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
  const sender     = ctx.curr.senders.find(s => s.kind === kind);
  const prevSender = ctx.prev?.senders.find(s => s.kind === kind);
  const label      = kind === 'audio' ? 'صدای ارسالی' : 'ویدیو ارسالی';

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
      const key   = `send-${kind}`;
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
  const receiver     = ctx.curr.receivers.find(r => r.kind === kind);
  const prevReceiver = ctx.prev?.receivers.find(r => r.kind === kind);
  const portRec      = ctx.portRecordStates.find(pr => pr.role === 'receiver' && pr.kind === kind);
  const label        = kind === 'audio' ? 'صدای دریافتی' : 'ویدیو دریافتی';

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
      const key   = `recv-${kind}`;
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

  // ── Remote video rendering checks ────────────────────────────────────
  // Only run when framesDecoded is increasing (we know decode is working).
  if (kind === 'video') {
    // Use the canonical visible element if provided, otherwise fall back to remoteVideoElement
    const el = ctx.remoteVisibleElement ?? ctx.remoteVideoElement;

    // Build render diag regardless of element presence for debug export
    const buildDiag = (v: HTMLVideoElement | null): RemoteRenderDiag => {
      if (!v) {
        return {
          elementPresent: false, elementAttached: false, srcObjectBound: false,
          videoWidth: 0, videoHeight: 0, paused: true, readyState: 0,
          muted: false, volume: 1, layoutWidth: 0, layoutHeight: 0,
          opacity: '', visibility: '', presentedFrames: ctx.presentedFrameCount ?? null,
        };
      }
      const rect    = v.getBoundingClientRect();
      const style   = window.getComputedStyle(v);
      const attached = document.contains(v);
      return {
        elementPresent: true,
        elementAttached: attached,
        srcObjectBound: v.srcObject !== null,
        videoWidth:     v.videoWidth,
        videoHeight:    v.videoHeight,
        paused:         v.paused,
        readyState:     v.readyState,
        muted:          v.muted,
        volume:         v.volume,
        layoutWidth:    rect.width,
        layoutHeight:   rect.height,
        opacity:        style.opacity,
        visibility:     style.visibility,
        presentedFrames: ctx.presentedFrameCount ?? null,
      };
    };

    if (!el) {
      return { kind, direction: 'recv', classification: 'REMOTE_ELEMENT_MISSING',
        persianExplanation: `${label}: فریم‌ها decode می‌شوند اما element ویدیوی remote در DOM موجود نیست.`,
        renderDiag: buildDiag(null) };
    }

    const diag = buildDiag(el);

    if (!diag.elementAttached) {
      return { kind, direction: 'recv', classification: 'REMOTE_ELEMENT_DETACHED',
        persianExplanation: `${label}: element موجود است اما از DOM جدا شده است. React remount یا swap ممکن است باعث شده.`,
        renderDiag: diag };
    }

    if (!diag.srcObjectBound) {
      return { kind, direction: 'recv', classification: 'REMOTE_STREAM_NOT_BOUND',
        persianExplanation: `${label}: element موجود است اما srcObject null است. bindRemoteStreamToElement فراخوانی نشده.`,
        renderDiag: diag };
    }

    if (diag.muted) {
      return { kind, direction: 'recv', classification: 'REMOTE_AUDIO_ELEMENT_MUTED',
        persianExplanation: `${label}: element ویدیوی remote مقدار muted=true دارد. صدا نخواهد پخش شد.`,
        renderDiag: diag };
    }

    if (diag.videoWidth === 0 || diag.videoHeight === 0) {
      return { kind, direction: 'recv', classification: 'REMOTE_VIDEO_NO_DIMENSIONS',
        persianExplanation: `${label}: srcObject متصل است اما videoWidth/Height صفر است. frame هنوز دریافت نشده یا track متوقف شده.`,
        renderDiag: diag };
    }

    if (diag.paused) {
      return { kind, direction: 'recv', classification: 'REMOTE_VIDEO_PAUSED',
        persianExplanation: `${label}: ویدیو pause است. احتمال: autoplay block یا play() صدا زده نشده.`,
        renderDiag: diag };
    }

    // readyState < HAVE_CURRENT_DATA (2) means no presentable frame yet
    if (diag.readyState < 2) {
      return { kind, direction: 'recv', classification: 'REMOTE_VIDEO_NO_CURRENT_DATA',
        persianExplanation: `${label}: readyState=${diag.readyState} — هنوز فریم قابل نمایش وجود ندارد (HAVE_CURRENT_DATA نیست).`,
        renderDiag: diag };
    }

    if (diag.layoutWidth === 0 || diag.layoutHeight === 0) {
      return { kind, direction: 'recv', classification: 'REMOTE_VIDEO_ZERO_LAYOUT_SIZE',
        persianExplanation: `${label}: element ویدیو ابعاد صفر در layout دارد. احتمال: visibility:hidden، opacity:0، یا display:none.`,
        renderDiag: diag };
    }

    // If we have a presented frame counter and it hasn't moved despite frames decoding
    if (
      diag.presentedFrames !== null &&
      prevReceiver &&
      receiver.framesDecoded > prevReceiver.framesDecoded &&
      diag.presentedFrames === 0
    ) {
      return { kind, direction: 'recv', classification: 'DECODED_FRAMES_NOT_PRESENTED',
        persianExplanation: `${label}: ${receiver.framesDecoded} فریم decode شده اما requestVideoFrameCallback هیچ فریمی ارائه نداده. element از stream جدا شده.`,
        renderDiag: diag };
    }

    return { kind, direction: 'recv', classification: 'HEALTHY',
      persianExplanation: `${label}: دریافت و رندر فعال است.`,
      renderDiag: diag };
  }

  // ── Remote audio checks ───────────────────────────────────────────────
  if (kind === 'audio' && ctx.remoteVideoElement) {
    const v = ctx.remoteVideoElement;
    if (v.muted) {
      return { kind, direction: 'recv', classification: 'REMOTE_AUDIO_ELEMENT_MUTED',
        persianExplanation: `${label}: element صدا muted=true دارد.` };
    }
    if (v.volume === 0) {
      return { kind, direction: 'recv', classification: 'REMOTE_AUDIO_VOLUME_ZERO',
        persianExplanation: `${label}: volume=0 روی element صدا.` };
    }
    if (v.paused) {
      return { kind, direction: 'recv', classification: 'REMOTE_AUDIO_AUTOPLAY_BLOCKED',
        persianExplanation: `${label}: element صدا pause است. احتمال: autoplay block.` };
    }
    if (prevReceiver && receiver.audioLevel !== null) {
      const prevLevel = prevReceiver.audioLevel ?? 0;
      const currLevel = receiver.audioLevel;
      if (currLevel < 0.0001 && prevLevel < 0.0001 && receiver.bytesReceived > (prevReceiver.bytesReceived + 1000)) {
        return { kind, direction: 'recv', classification: 'REMOTE_AUDIO_SOURCE_SILENT_OR_VERY_LOW',
          persianExplanation: `${label}: بایت‌ها دریافت می‌شوند اما audioLevel بسیار پایین است (${currLevel.toFixed(6)}). احتمال: طرف مقابل بی‌صدا شده.` };
      }
    }
  }

  return { kind, direction: 'recv', classification: 'HEALTHY',
    persianExplanation: `${label}: دریافت فعال است.` };
}
