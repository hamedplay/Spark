// ── Constants ──────────────────────────────────────────────────────────────

export const INVITE_TTL_MS = 2 * 60 * 1000;
export const ICE_QUEUE_MAX = 50;
export const APP_ID        = 'e2ee-call-v1';
export const PROTO_VER     = 'v2';

export const SUPPORTS_TRANSFORMS =
  typeof RTCRtpScriptTransform !== 'undefined';

export const E2EE_DEBUG =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('e2ee_debug') === '1');

// ── Logging ────────────────────────────────────────────────────────────────

export function log(tag: string, ...args: unknown[]) {
  if (!E2EE_DEBUG) return;
  console.log(tag, ...args);
}
export function logWarn(tag: string, ...args: unknown[]) {
  if (!E2EE_DEBUG) return;
  console.warn(tag, ...args);
}
export function logError(tag: string, ...args: unknown[]) {
  console.error(tag, ...args);
}

// ── Types ──────────────────────────────────────────────────────────────────

export type CallPhase =
  | 'idle'
  | 'outgoing_ring'
  | 'incoming_ring'
  | 'connecting'
  | 'connected'
  | 'ended'
  | 'failed';

export type E2EEStatus = 'unsupported' | 'pending' | 'active_unverified' | 'active_verified' | 'error';

export type TransformState =
  | 'created'       // attachXxxTransform returned, init sent
  | 'worker-ready'  // worker replied 'ready' to init message
  | 'key-pending'   // set-xxx-key sent, awaiting matching requestId ACK
  | 'key-ready'     // matching ACK received — frame crypto active
  | 'failed'        // unrecoverable error
  | 'closed';       // port closed during cleanup

export type FailReason =
  | 'ice_failed'
  | 'key_exchange'
  | 'no_transforms'
  | 'peer_disconnected'
  | 'invite_expired'
  | null;

export interface UserProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
}

export interface MediaKeys {
  key:    CryptoKey;
  ivSeed: Uint8Array;
}

export interface DerivedKeys {
  send: { audio: MediaKeys; video: MediaKeys };
  recv: { audio: MediaKeys; video: MediaKeys };
}

export interface IncomingCall {
  from:        string;
  sessionId:   string;
  callerName:  string;
  callerId:    string;
  expiresAt:   number;
  acceptToken: string;
}

export interface E2EECallProps {
  currentUserId:   string;
  currentUserName: string;
  onBack:          () => void;
}
