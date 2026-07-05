/**
 * E2EECallPage — secure 1-to-1 video call
 *
 * SECURITY STACK
 * ──────────────
 * Key exchange : ECDH P-256 (ephemeral, non-extractable private key)
 * Key derivation:
 *   1. ECDH deriveBits(256) → raw shared secret
 *   2. importKey('raw', sharedSecret, 'HKDF', false, ['deriveKey','deriveBits'])
 *   3. For each (direction × media-kind) → AES-GCM-256 key (non-extractable) + 8-byte IV seed
 * Keys:
 *   caller-to-callee/audio  caller-to-callee/video
 *   callee-to-caller/audio  callee-to-caller/video
 * IV  : 8-byte HKDF-derived seed ‖ 4-byte monotonic counter (BE)
 * Frame format: [0x02 version][epoch][4B counter BE][AES-GCM ciphertext + 16B tag]
 *
 * SIGNALLING (Supabase Realtime Broadcast)
 * ─────────────────────────────────────────
 * e2ee-inbox-{userId}   — ring/invite (per user, persistent)
 * e2ee-sess-{sessionId} — offer/answer/ICE/key-exchange (per call)
 *
 * ACCEPT TOKEN
 * ────────────
 * Caller generates a 128-bit random acceptToken in the ring payload.
 * Callee echoes it in 'accepted'. Caller verifies before locking peer
 * and sending the offer — blocks trivial accepted-hijack on session channel.
 *
 * E2EE STATUS
 * ───────────
 * unsupported       — browser lacks RTCRtpScriptTransform
 * pending           — no active call / keys not yet derived
 * active_unverified — transforms installed + keys set; Safety Number not verified
 * active_verified   — Safety Number confirmed out-of-band
 * error             — worker / key-derivation failure
 *
 * KNOWN LIMITATIONS
 * ─────────────────
 * • Safety Number uses ephemeral session public keys, not long-term identity keys.
 *   TOFU is not implemented.
 * • Media metadata (IP, timing, bitrate, codec, packet sizes) is NOT protected
 *   by E2EE — only media payload content is encrypted.
 * • Key rotation on long calls is scaffolded in the worker but not triggered yet.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, ShieldCheck, ShieldAlert,
  Loader, Check, Users, RefreshCw, Phone, PhoneIncoming, Eye,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getSharedRTCConfig, invalidateRTCConfigCache } from '../../lib/rtcConfig';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';

// ── Constants ─────────────────────────────────────────────────────────────────

const INVITE_TTL_MS = 2 * 60 * 1000;
const ICE_QUEUE_MAX = 50;
const APP_ID        = typeof window !== 'undefined' ? window.location.hostname : 'app';
const PROTO_VER     = 'v2';

const SUPPORTS_TRANSFORMS =
  typeof RTCRtpScriptTransform !== 'undefined';

// Debug flag — true in dev, or when localStorage flag is set
const E2EE_DEBUG =
  (typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) ||
  (typeof localStorage !== 'undefined' && localStorage.getItem('e2ee_debug') === '1');

// ── Logging ───────────────────────────────────────────────────────────────────

function log(tag: string, ...args: unknown[]) {
  if (!E2EE_DEBUG) return;
  console.log(tag, ...args);
}
function logWarn(tag: string, ...args: unknown[]) {
  if (!E2EE_DEBUG) return;
  console.warn(tag, ...args);
}
function logError(tag: string, ...args: unknown[]) {
  // Errors always logged regardless of debug flag
  console.error(tag, ...args);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type CallPhase =
  | 'idle'
  | 'outgoing_ring'
  | 'incoming_ring'
  | 'connecting'
  | 'connected'
  | 'ended'
  | 'failed';

type E2EEStatus = 'unsupported' | 'pending' | 'active_unverified' | 'active_verified' | 'error';

type FailReason =
  | 'ice_failed'
  | 'key_exchange'
  | 'no_transforms'
  | 'peer_disconnected'
  | 'invite_expired'
  | null;

interface UserProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
}

interface MediaKeys {
  key:    CryptoKey;
  ivSeed: Uint8Array; // 8 bytes
}

interface DerivedKeys {
  send: { audio: MediaKeys; video: MediaKeys };
  recv: { audio: MediaKeys; video: MediaKeys };
}

interface IncomingCall {
  from:        string;   // caller peerId
  sessionId:   string;
  callerName:  string;
  callerId:    string;
  expiresAt:   number;
  acceptToken: string;   // 128-bit hex, must echo in 'accepted'
}

// ── JWK Validation ────────────────────────────────────────────────────────────

/**
 * Strict P-256 public-key JWK validator.
 * x and y must be 32-byte base64url values (43 chars unpadded).
 * No private key material ('d'), no unexpected fields.
 */
function validatePublicJWK(jwk: unknown): asserts jwk is JsonWebKey {
  if (typeof jwk !== 'object' || jwk === null) throw new Error('JWK must be an object');
  const j = jwk as Record<string, unknown>;
  if (j.kty !== 'EC')    throw new Error('JWK: expected EC');
  if (j.crv !== 'P-256') throw new Error('JWK: expected P-256');

  // x and y must be 32-byte values encoded as base64url without padding → 43 chars
  for (const coord of ['x', 'y'] as const) {
    if (typeof j[coord] !== 'string') throw new Error(`JWK: ${coord} missing`);
    const val = j[coord] as string;
    // base64url → bytes: every 4 chars → 3 bytes; 43 chars = 32 bytes
    const bytes = Math.floor(val.length * 3 / 4);
    if (bytes < 31 || bytes > 33) throw new Error(`JWK: ${coord} wrong length (${val.length} chars → ~${bytes} bytes, expected 32)`);
    if (!/^[A-Za-z0-9_-]+=*$/.test(val)) throw new Error(`JWK: ${coord} invalid base64url`);
  }

  if ('d' in j) throw new Error('JWK contains private key material (d)');

  const allowed = new Set(['kty', 'crv', 'x', 'y', 'key_ops', 'ext', 'use']);
  for (const k of Object.keys(j)) {
    if (!allowed.has(k)) throw new Error(`JWK: unexpected field ${k}`);
  }
}

// ── ECDH helpers ──────────────────────────────────────────────────────────────

async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

async function exportPublicKey(pub: CryptoKey): Promise<string> {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pub));
}

async function importPublicKey(raw: string): Promise<CryptoKey> {
  let jwk: unknown;
  try { jwk = JSON.parse(raw); } catch (e) { throw new Error(`JWK parse failed: ${e}`); }
  validatePublicJWK(jwk);
  return crypto.subtle.importKey(
    'jwk', jwk as JsonWebKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    [],
  );
}

// ── Per-media-kind key derivation ──────────────────────────────────────────────

/**
 * Full derivation chain:
 *   ECDH P-256 deriveBits(256) → rawSecret
 *   importKey(rawSecret, 'HKDF') → hkdfKey
 *   For each (direction, mediaKind):
 *     deriveKey  → AES-GCM-256 (non-extractable)
 *     deriveBits → 8-byte IV seed
 *
 * Info strings use protocol version, appId, sessionId, direction and media kind
 * so no two derived values share the same context.
 *
 * Both peers independently derive the same four key pairs from the same ECDH IKM.
 */
async function deriveSessionKeys(
  myPrivate: CryptoKey,
  peerPublic: CryptoKey,
  sessionId: string,
  myRole: 'caller' | 'callee',
  salt: Uint8Array,
): Promise<DerivedKeys> {
  const enc  = new TextEncoder();
  const base = `${PROTO_VER}|${APP_ID}|${sessionId}`;

  // Step 1: ECDH → raw shared secret (non-extractable after import)
  const rawSecret = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerPublic },
    myPrivate,
    256,
  );

  // Step 2: import as HKDF key (not extractable)
  const hkdfKey = await crypto.subtle.importKey(
    'raw', rawSecret, 'HKDF', false, ['deriveKey', 'deriveBits'],
  );

  // Step 3: derive per (direction × media-kind) AES-GCM keys and IV seeds
  const directions = ['caller-to-callee', 'callee-to-caller'] as const;
  const media      = ['audio', 'video'] as const;

  // caller→callee audio/video use 'encrypt' for caller, 'decrypt' for callee
  // callee→caller audio/video use 'encrypt' for callee, 'decrypt' for caller
  const keyResults: Record<string, MediaKeys> = {};

  await Promise.all(
    directions.flatMap(dir =>
      media.map(async kind => {
        const isSendDir = (myRole === 'caller') === (dir === 'caller-to-callee');
        const usage = isSendDir ? ['encrypt'] as KeyUsage[] : ['decrypt'] as KeyUsage[];
        const aesInfo  = enc.encode(`${base}|${dir}|${kind}|aes-gcm-256`);
        const seedInfo = enc.encode(`${base}|${dir}|${kind}|iv-seed`);

        const [key, seedBits] = await Promise.all([
          crypto.subtle.deriveKey(
            { name: 'HKDF', hash: 'SHA-256', salt, info: aesInfo },
            hkdfKey,
            { name: 'AES-GCM', length: 256 },
            false,
            usage,
          ),
          crypto.subtle.deriveBits(
            { name: 'HKDF', hash: 'SHA-256', salt, info: seedInfo },
            hkdfKey,
            64, // 8 bytes
          ),
        ]);
        keyResults[`${dir}|${kind}`] = { key, ivSeed: new Uint8Array(seedBits) };
      }),
    ),
  );

  const c2cAudio = keyResults['caller-to-callee|audio'];
  const c2cVideo = keyResults['caller-to-callee|video'];
  const cc2Audio = keyResults['callee-to-caller|audio'];
  const cc2Video = keyResults['callee-to-caller|video'];

  if (myRole === 'caller') {
    return {
      send: { audio: c2cAudio, video: c2cVideo },
      recv: { audio: cc2Audio, video: cc2Video },
    };
  } else {
    return {
      send: { audio: cc2Audio, video: cc2Video },
      recv: { audio: c2cAudio, video: c2cVideo },
    };
  }
}

// ── Safety Number ─────────────────────────────────────────────────────────────

/**
 * Session-level fingerprint for MITM detection.
 * Both peers independently compute the same value by hashing the same sorted keys
 * along with protocol version, appId and sessionId as context.
 */
async function computeSafetyNumber(
  myJWK: string,
  peerJWK: string,
  sessionId: string,
): Promise<string[]> {
  const sorted = [myJWK, peerJWK].sort();
  const input  = new TextEncoder().encode(`${PROTO_VER}|${APP_ID}|${sessionId}|${sorted.join('\0')}`);
  const hash   = await crypto.subtle.digest('SHA-256', input);
  const hex    = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 16), hex.slice(16, 24), hex.slice(24, 32)];
}

// ── Utility ───────────────────────────────────────────────────────────────────

const bytesToHex = (arr: Uint8Array) =>
  Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');

const hexToBytes = (hex: string): Uint8Array | null => {
  if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) out[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  return out;
};

function randomHex(bytes: number): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

// ── Signal shape validators ───────────────────────────────────────────────────

function validateIceCandidate(c: unknown): c is RTCIceCandidateInit {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  if (typeof o.candidate !== 'string' || o.candidate.length > 2000) return false;
  if ('sdpMid' in o && o.sdpMid !== null && typeof o.sdpMid !== 'string') return false;
  if ('sdpMLineIndex' in o && o.sdpMLineIndex !== null && !Number.isInteger(o.sdpMLineIndex)) return false;
  if ('usernameFragment' in o && o.usernameFragment !== null && typeof o.usernameFragment !== 'string') return false;
  return true;
}

function validateSDP(sdp: unknown, expectedType: 'offer' | 'answer'): sdp is RTCSessionDescriptionInit {
  if (!sdp || typeof sdp !== 'object') return false;
  const o = sdp as Record<string, unknown>;
  if (o.type !== expectedType) return false;
  if (typeof o.sdp !== 'string' || o.sdp.length === 0 || o.sdp.length > 65536) return false;
  return true;
}

function validateSignalPayload(
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

/**
 * Resolves when the channel reaches SUBSCRIBED, rejects on error or timeout.
 * Use this instead of ad-hoc subscribe() promise wrappers.
 */
function waitForSubscribed(
  ch: ReturnType<typeof supabase.channel>,
  timeoutMs = 9000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('channel subscribe timeout')), timeoutMs);
    ch.subscribe(status => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        reject(new Error(`channel subscribe failed: ${status}`));
      }
    });
  });
}

// ── Transform helpers ─────────────────────────────────────────────────────────

interface PortRecord {
  port:  MessagePort;
  kind:  'audio' | 'video';
  role:  'sender' | 'receiver';
}

function attachSenderTransform(
  sender: RTCRtpSender,
  worker: Worker,
  debug: boolean,
): PortRecord | null {
  if (!SUPPORTS_TRANSFORMS || !sender.track) return null;
  const kind = sender.track.kind as 'audio' | 'video';
  if (kind !== 'audio' && kind !== 'video') {
    logWarn('[E2EE][XFORM]', `unknown sender track kind=${sender.track.kind} — skipping`);
    return null;
  }
  const { port1, port2 } = new MessageChannel();
  sender.transform = new RTCRtpScriptTransform(worker, { role: 'sender', port: port2 }, [port2]);
  port1.start();
  port1.postMessage({ type: 'init', debug, media: kind });
  log('[E2EE][XFORM]', `sender transform attached trackId=${sender.track.id} kind=${kind}`);
  return { port: port1, kind, role: 'sender' };
}

function attachReceiverTransform(
  receiver: RTCRtpReceiver,
  worker: Worker,
  debug: boolean,
): PortRecord | null {
  if (!SUPPORTS_TRANSFORMS) return null;
  const kind = receiver.track.kind as 'audio' | 'video';
  if (kind !== 'audio' && kind !== 'video') {
    logWarn('[E2EE][XFORM]', `unknown receiver track kind=${receiver.track.kind} — skipping`);
    return null;
  }
  const { port1, port2 } = new MessageChannel();
  receiver.transform = new RTCRtpScriptTransform(worker, { role: 'receiver', port: port2 }, [port2]);
  port1.start();
  port1.postMessage({ type: 'init', debug, media: kind });
  log('[E2EE][XFORM]', `receiver transform attached trackId=${receiver.track.id} kind=${kind}`);
  return { port: port1, kind, role: 'receiver' };
}

function pushKeyToPortRecord(pr: PortRecord, keys: DerivedKeys) {
  const mk = pr.role === 'sender' ? keys.send[pr.kind] : keys.recv[pr.kind];
  const msgType = pr.role === 'sender' ? 'set-encrypt-key' : 'set-decrypt-key';
  pr.port.postMessage({ type: msgType, key: mk.key, ivSeed: mk.ivSeed, epoch: 0 }, []);
  log('[E2EE][KEY]', `pushKey role=${pr.role} kind=${pr.kind} msgType=${msgType}`);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  currentUserId:   string;
  currentUserName: string;
  onBack:          () => void;
}

export function E2EECallPage({ currentUserId, currentUserName, onBack }: Props) {
  // ── Display state ─────────────────────────────────────────────────────────
  const [phase,           setPhase]          = useState<CallPhase>('idle');
  const [e2eeStatus,      setE2eeStatus]     = useState<E2EEStatus>(SUPPORTS_TRANSFORMS ? 'pending' : 'unsupported');
  const [isMuted,         setIsMuted]        = useState(false);
  const [isVideoOff,      setIsVideoOff]     = useState(false);
  const [targetUser,      setTargetUser]     = useState<UserProfile | null>(null);
  const [incomingCall,    setIncomingCall]   = useState<IncomingCall | null>(null);
  const [safetyNums,      setSafetyNums]     = useState<string[] | null>(null);
  const [showSafety,      setShowSafety]     = useState(false);
  const [sessionCode,     setSessionCode]    = useState('');
  const [failReason,      setFailReason]     = useState<FailReason>(null);
  const [userSearch,      setUserSearch]     = useState('');
  const [users,           setUsers]          = useState<UserProfile[]>([]);
  const [searching,       setSearching]      = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const localVideoRef     = useRef<HTMLVideoElement>(null);
  const remoteVideoRef    = useRef<HTMLVideoElement>(null);
  const localStreamRef    = useRef<MediaStream | null>(null);
  const pcRef             = useRef<RTCPeerConnection | null>(null);
  const workerRef         = useRef<Worker | null>(null);
  const inboxChannelRef   = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sessionChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const ecdhKeyPairRef    = useRef<CryptoKeyPair | null>(null);
  const myPeerIdRef       = useRef(uuidv4());
  const sessionIdRef      = useRef('');
  const lockedPeerRef     = useRef<string | null>(null);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const portRecordsRef    = useRef<PortRecord[]>([]);
  const activeKeysRef     = useRef<DerivedKeys | null>(null);
  const myRoleRef         = useRef<'caller' | 'callee'>('caller');
  const myPublicJWKRef    = useRef('');
  const saltRef           = useRef<Uint8Array | null>(null);
  const sessionActiveRef  = useRef(false);
  const acceptTokenRef    = useRef<string>('');   // caller sets; callee echoes
  const safetyVerifiedRef = useRef(false);
  const phaseRef          = useRef<CallPhase>('idle');   // mirror of phase for use in timeouts
  const remoteStreamRef   = useRef<MediaStream | null>(null); // stable remote stream across tracks
  const offerSentRef      = useRef(false);               // prevents duplicate offer on double-accepted
  const cleaningUpRef     = useRef(false);               // reentrancy guard for doFullCleanup

  // Keep phaseRef in sync with phase state
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── User search ───────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(async () => {
      if (!userSearch.trim()) { setUsers([]); return; }
      setSearching(true);
      try {
        const safe = userSearch.replace(/[%_\\'"]/g, '');
        const { data } = await supabase
          .from('profiles')
          .select('user_id, full_name, email, avatar_url')
          .neq('user_id', currentUserId)
          .not('is_hidden', 'eq', true)
          .or(`full_name.ilike.%${safe}%,email.ilike.%${safe}%`)
          .limit(20);
        setUsers((data as UserProfile[]) || []);
      } catch { toast.error('خطا در جستجو'); }
      finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [userSearch, currentUserId]);

  // ── Worker init ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS) return;
    log('[E2EE][CALL]', 'creating e2ee-worker');
    try {
      const w = new Worker('/e2ee-worker.js');
      w.addEventListener('error', e => {
        logError('[E2EE][ERROR]', 'worker error:', e.message);
        setE2eeStatus('error');
        toast.error('خطای Worker رمزنگاری — تماس قطع شد');
        doFullCleanup('ice_failed');
      });
      w.addEventListener('message', e => {
        const { type, level, tag, msg } = e.data || {};
        if (type === 'log' && E2EE_DEBUG) {
          const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
          fn(`[worker]${tag}`, msg);
        }
        if (type === 'counter-exhausted') {
          logError('[E2EE][WORKER]', 'counter exhausted — ending call');
          toast.error('رمزنگاری: شمارنده پر شد — تماس قطع می‌شود');
          doHangup(true);
        }
        if (type === 'encrypt-error' || type === 'decrypt-error') {
          logError('[E2EE][WORKER]', `${type}:`, e.data.message);
        }
      });
      workerRef.current = w;
      log('[E2EE][CALL]', 'e2ee-worker created');
    } catch (e) {
      logError('[E2EE][ERROR]', 'worker load failed:', e);
      setE2eeStatus('error');
    }
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Inbox channel — receives incoming ring ────────────────────────────────
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS || !currentUserId) return;
    const ch = supabase.channel(`e2ee-inbox-${currentUserId}`, {
      config: { broadcast: { self: false } },
    });
    inboxChannelRef.current = ch;

    ch.on('broadcast', { event: 'e2ee-ring' }, ({ payload }) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as Record<string, unknown>;

      if (p.targetUserId !== currentUserId) {
        log('[E2EE][SIGNAL]', `ring dropped: targetUserId mismatch got=${p.targetUserId}`);
        return;
      }
      if (typeof p.from !== 'string'        || p.from.length > 200)       return;
      if (typeof p.sessionId !== 'string'   || p.sessionId.length > 100)  return;
      if (typeof p.callerName !== 'string'  || p.callerName.length > 200) return;
      if (typeof p.callerId !== 'string'    || p.callerId.length > 200)   return;
      if (typeof p.acceptToken !== 'string' || p.acceptToken.length !== 32) return;
      if (typeof p.expiresAt !== 'number') return;
      if (Date.now() > (p.expiresAt as number)) {
        log('[E2EE][SIGNAL]', `ring dropped: expired expiresAt=${p.expiresAt}`);
        return;
      }

      log('[E2EE][SIGNAL]', `incoming ring from=${p.from} sessionId=${p.sessionId} callerName=${p.callerName}`);

      if (sessionActiveRef.current) {
        log('[E2EE][SIGNAL]', 'auto-reject: already in call');
        const rejCh = supabase.channel(`e2ee-sess-${p.sessionId}`, { config: { broadcast: { self: false } } });
        rejCh.subscribe(() => {
          rejCh.send({
            type: 'broadcast', event: 'e2ee-signal',
            payload: { type: 'rejected', from: myPeerIdRef.current, session: p.sessionId, data: {} },
          });
          setTimeout(() => supabase.removeChannel(rejCh), 1500);
        });
        return;
      }

      setIncomingCall({
        from:        p.from as string,
        sessionId:   p.sessionId as string,
        callerName:  p.callerName as string,
        callerId:    p.callerId as string,
        expiresAt:   p.expiresAt as number,
        acceptToken: p.acceptToken as string,
      });
      setPhase('incoming_ring');
    });

    ch.subscribe(status => log('[E2EE][SIGNAL]', `inbox channel status=${status}`));
    return () => { supabase.removeChannel(ch); inboxChannelRef.current = null; };
  }, [currentUserId]);

  // ── Core session functions ────────────────────────────────────────────────

  const doFullCleanup = useCallback((reason?: FailReason) => {
    if (cleaningUpRef.current) {
      log('[E2EE][CALL]', `cleanup already in progress, skipping reason=${reason ?? 'none'}`);
      return;
    }
    cleaningUpRef.current = true;
    log('[E2EE][CALL]', `cleanup reason=${reason ?? 'none'}`);
    sessionActiveRef.current = false;
    offerSentRef.current = false;

    pcRef.current?.close();
    pcRef.current = null;

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;

    remoteStreamRef.current = null;
    if (localVideoRef.current)  localVideoRef.current.srcObject  = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    portRecordsRef.current.forEach(pr => { try { pr.port.close(); } catch { /* already closed */ } });
    portRecordsRef.current = [];

    iceCandidateQueue.current = [];
    activeKeysRef.current = null;
    lockedPeerRef.current = null;
    saltRef.current       = null;
    acceptTokenRef.current = '';

    if (sessionChannelRef.current) {
      supabase.removeChannel(sessionChannelRef.current);
      sessionChannelRef.current = null;
    }
    sessionIdRef.current   = '';
    ecdhKeyPairRef.current = null;
    myPublicJWKRef.current = '';

    setSafetyNums(null);
    setShowSafety(false);
    safetyVerifiedRef.current = false;
    setE2eeStatus(SUPPORTS_TRANSFORMS ? 'pending' : 'unsupported');
    setTargetUser(null);
    setIncomingCall(null);
    setSessionCode('');
    setIsMuted(false);
    setIsVideoOff(false);

    cleaningUpRef.current = false;

    if (reason) {
      setFailReason(reason);
      setPhase('failed');
    }
  }, []);

  const doHangup = useCallback((sendSignal = true) => {
    if (sendSignal && sessionChannelRef.current && sessionIdRef.current) {
      sessionChannelRef.current.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: { type: 'hangup', from: myPeerIdRef.current, session: sessionIdRef.current, data: {} },
      });
      log('[E2EE][CALL]', 'hangup signal sent');
    }
    doFullCleanup();
    setPhase('ended');
  }, [doFullCleanup]);

  const startLocalStream = async (): Promise<MediaStream | null> => {
    log('[E2EE][MEDIA]', 'requesting getUserMedia');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = s;
      const audioTracks = s.getAudioTracks().length;
      const videoTracks = s.getVideoTracks().length;
      log('[E2EE][MEDIA]', `local stream ready audioTracks=${audioTracks} videoTracks=${videoTracks}`);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = s;
        log('[E2EE][MEDIA]', 'localVideoRef.srcObject set');
      }
      return s;
    } catch (e) {
      logError('[E2EE][ERROR]', 'getUserMedia failed:', e);
      toast.error('دسترسی به دوربین/میکروفون ممکن نیست');
      return null;
    }
  };

  const flushICEQueue = async (pc: RTCPeerConnection) => {
    const queued = iceCandidateQueue.current.splice(0);
    log('[E2EE][ICE]', `flushing queue count=${queued.length}`);
    for (const c of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(e =>
        logWarn('[E2EE][ICE]', 'addIceCandidate (queued) failed:', e)
      );
    }
  };

  const doSetupKeys = async (peerPublicJWK: string, salt: Uint8Array) => {
    if (!ecdhKeyPairRef.current) return;
    log('[E2EE][KEY]', 'starting key derivation');
    try {
      const peerPub = await importPublicKey(peerPublicJWK);
      log('[E2EE][KEY]', 'peer public key imported and validated');

      const keys = await deriveSessionKeys(
        ecdhKeyPairRef.current.privateKey, peerPub,
        sessionIdRef.current, myRoleRef.current, salt,
      );
      activeKeysRef.current = keys;
      log('[E2EE][KEY]', 'session keys derived (4 × AES-GCM-256 keys + IV seeds)');

      // Push to all existing port records
      for (const pr of portRecordsRef.current) {
        pushKeyToPortRecord(pr, keys);
      }
      log('[E2EE][KEY]', `keys pushed to ${portRecordsRef.current.length} transform port(s)`);

      const nums = await computeSafetyNumber(myPublicJWKRef.current, peerPublicJWK, sessionIdRef.current);
      setSafetyNums(nums);
      setE2eeStatus('active_unverified');
      log('[E2EE][KEY]', 'safety number computed, e2eeStatus=active_unverified');
    } catch (e) {
      logError('[E2EE][ERROR]', 'key setup failed:', e);
      toast.error('خطا در رمزنگاری — تماس لغو شد');
      doFullCleanup('key_exchange');
    }
  };

  const buildPC = async () => {
    const cfg = await getSharedRTCConfig();
    log('[E2EE][PC]', `creating RTCPeerConnection iceServers=${(cfg.iceServers as RTCIceServer[])?.length ?? 0}`);
    const pc = new RTCPeerConnection(cfg);
    pcRef.current = pc;

    const stream = localStreamRef.current;
    if (stream) {
      for (const t of stream.getTracks()) {
        pc.addTrack(t, stream);
        log('[E2EE][PC]', `addTrack kind=${t.kind} id=${t.id} enabled=${t.enabled} readyState=${t.readyState}`);
      }
    } else {
      logWarn('[E2EE][PC]', 'buildPC called with no local stream');
    }

    // Attach sender transforms immediately; push keys if already derived
    if (workerRef.current) {
      for (const sender of pc.getSenders()) {
        if (!sender.track) continue;
        const pr = attachSenderTransform(sender, workerRef.current, E2EE_DEBUG);
        if (pr) {
          portRecordsRef.current.push(pr);
          if (activeKeysRef.current) {
            pushKeyToPortRecord(pr, activeKeysRef.current);
            log('[E2EE][XFORM]', `sender keys pushed early kind=${pr.kind}`);
          }
        }
      }
    }

    pc.ontrack = e => {
      log('[E2EE][PC]', `ontrack kind=${e.track.kind} id=${e.track.id} muted=${e.track.muted} readyState=${e.track.readyState}`);

      // Attach receiver transform
      if (workerRef.current) {
        const pr = attachReceiverTransform(e.receiver, workerRef.current, E2EE_DEBUG);
        if (pr) {
          portRecordsRef.current.push(pr);
          if (activeKeysRef.current) {
            pushKeyToPortRecord(pr, activeKeysRef.current);
            log('[E2EE][XFORM]', `receiver keys pushed early kind=${pr.kind}`);
          }
        }
      }

      // Attach remote stream to video element — use a stable stream ref so that
      // audio and video tracks arriving separately both land on the same stream.
      const remoteEl = remoteVideoRef.current;
      if (remoteEl) {
        let remoteStream: MediaStream;
        if (e.streams && e.streams[0]) {
          // Browser provided a stream — use it and remember it
          remoteStream = e.streams[0];
          remoteStreamRef.current = remoteStream;
          log('[E2EE][MEDIA]', `ontrack using provided stream id=${remoteStream.id}`);
        } else {
          // No stream from browser — reuse or create a stable stream
          if (!remoteStreamRef.current) {
            remoteStreamRef.current = new MediaStream();
            log('[E2EE][MEDIA]', `created stable fallback remote stream`);
          }
          remoteStream = remoteStreamRef.current;
          // Only add the track if not already present
          const alreadyPresent = remoteStream.getTracks().some(t => t.id === e.track.id);
          if (!alreadyPresent) {
            remoteStream.addTrack(e.track);
            log('[E2EE][MEDIA]', `added track kind=${e.track.kind} to stable stream trackCount=${remoteStream.getTracks().length}`);
          }
        }
        if (remoteEl.srcObject !== remoteStream) {
          remoteEl.srcObject = remoteStream;
          log('[E2EE][MEDIA]', `remoteVideoRef.srcObject set trackCount=${remoteStream.getTracks().length}`);
        }
        remoteEl.play().catch(err => {
          log('[E2EE][MEDIA]', `remote video play() error (may be expected before user gesture): ${err}`);
        });
        // Log video element diagnostics 2 s after first track arrives
        const streamForDiag = remoteStream;
        setTimeout(() => {
          if (!remoteVideoRef.current) return;
          const v = remoteVideoRef.current;
          log('[E2EE][MEDIA]', `remote video diag: readyState=${v.readyState} paused=${v.paused} muted=${v.muted} autoplay=${v.autoplay} playsInline=${v.playsInline} videoWidth=${v.videoWidth} videoHeight=${v.videoHeight} trackCount=${streamForDiag.getTracks().length}`);
        }, 2000);
      } else {
        logWarn('[E2EE][MEDIA]', 'remoteVideoRef not mounted when ontrack fired');
      }
    };

    pc.onicecandidate = e => {
      if (!e.candidate || !sessionChannelRef.current) return;
      log('[E2EE][ICE]', `sending candidate type=${e.candidate.type}`);
      sessionChannelRef.current.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: { type: 'ice', from: myPeerIdRef.current, session: sessionIdRef.current, data: { candidate: e.candidate.toJSON() } },
      });
    };

    pc.onicecandidateerror = (e: Event) => {
      const ev = e as RTCPeerConnectionIceErrorEvent;
      logError('[E2EE][ICE]', `candidate error code=${ev.errorCode} text="${ev.errorText}" url=${ev.url}`);
      if (ev.errorCode === 701) {
        logError('[E2EE][ICE]', 'TURN authentication failed — check credentials in system_config');
        toast.error('احراز هویت سرور TURN شکست خورد — با پشتیبانی تماس بگیرید');
      }
    };

    pc.onicegatheringstatechange = () => {
      log('[E2EE][ICE]', `iceGatheringState=${pc.iceGatheringState}`);
    };

    let iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null;

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      log('[E2EE][ICE]', `iceConnectionState=${s}`);

      if (s === 'connected' || s === 'completed') {
        // Clear any pending disconnect timer when connection recovers
        if (iceDisconnectTimer) { clearTimeout(iceDisconnectTimer); iceDisconnectTimer = null; }
      }

      if (s === 'disconnected') {
        logWarn('[E2EE][ICE]', 'ICE disconnected — waiting 10 s before restart');
        if (iceDisconnectTimer) clearTimeout(iceDisconnectTimer);
        iceDisconnectTimer = setTimeout(() => {
          iceDisconnectTimer = null;
          if (pc.iceConnectionState !== 'disconnected') return;
          log('[E2EE][ICE]', 'still disconnected after 10 s — attempting ICE restart');
          pc.createOffer({ iceRestart: true })
            .then(offer => pc.setLocalDescription(offer).then(() => offer))
            .then(offer => {
              sessionChannelRef.current?.send({
                type: 'broadcast', event: 'e2ee-signal',
                payload: { type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: saltRef.current ? bytesToHex(saltRef.current) : '' } },
              });
              log('[E2EE][ICE]', 'ICE restart offer sent');
            })
            .catch(err => {
              logError('[E2EE][ICE]', 'ICE restart failed:', err);
              doFullCleanup('peer_disconnected');
            });
        }, 10_000);
      }

      if (s === 'failed') {
        if (iceDisconnectTimer) { clearTimeout(iceDisconnectTimer); iceDisconnectTimer = null; }
        logError('[E2EE][ERROR]', 'ICE connection failed — cleaning up');
        doFullCleanup('ice_failed');
      }
    };

    pc.onsignalingstatechange = () => {
      log('[E2EE][PC]', `signalingState=${pc.signalingState}`);
    };

    pc.onnegotiationneeded = () => {
      log('[E2EE][PC]', 'negotiationneeded');
    };

    pc.onconnectionstatechange = () => {
      log('[E2EE][PC]', `connectionState=${pc.connectionState}`);
      if (pc.connectionState === 'connected') setPhase('connected');
      else if (pc.connectionState === 'failed') doFullCleanup('ice_failed');
      else if (pc.connectionState === 'disconnected') {
        logWarn('[E2EE][PC]', 'peer connection state: disconnected (ICE handler will manage recovery)');
      }
    };

    return pc;
  };

  const doSendOffer = async () => {
    const pc = pcRef.current;
    const ch = sessionChannelRef.current;
    if (!pc || !ch) return;

    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltRef.current = salt;

    log('[E2EE][PC]', 'createOffer');
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    log('[E2EE][PC]', `setLocalDescription offer signalingState=${pc.signalingState}`);

    ch.send({
      type: 'broadcast', event: 'e2ee-signal',
      payload: {
        type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current,
        data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: bytesToHex(salt) },
      },
    });
    log('[E2EE][SIGNAL]', 'offer sent');
  };

  const openSessionChannel = (sessionId: string) => {
    log('[E2EE][SIGNAL]', `opening session channel sessionId=${sessionId}`);
    const ch = supabase.channel(`e2ee-sess-${sessionId}`, {
      config: { broadcast: { self: false } },
    });
    sessionChannelRef.current = ch;

    ch.on('broadcast', { event: 'e2ee-signal' }, async ({ payload }) => {
      const p = validateSignalPayload(payload, sessionIdRef.current, lockedPeerRef.current);
      if (!p) return;

      log('[E2EE][SIGNAL]', `received type=${p.type} from=${p.from}`);
      const type = p.type;
      const data = p.data as Record<string, unknown> | undefined;

      // ── Callee accepted → Caller verifies token, locks peer, sends offer ──
      if (type === 'accepted' && myRoleRef.current === 'caller') {
        // Guard: only process if still waiting for acceptance and offer not yet sent
        if (phaseRef.current !== 'outgoing_ring') {
          log('[E2EE][SIGNAL]', `accepted dropped: phase=${phaseRef.current} (not outgoing_ring)`);
          return;
        }
        if (offerSentRef.current) {
          log('[E2EE][SIGNAL]', 'accepted dropped: offer already sent (duplicate accepted)');
          return;
        }
        const echoed = (data as Record<string, unknown>)?.acceptToken;
        if (echoed !== acceptTokenRef.current) {
          logWarn('[E2EE][SIGNAL]', `accepted: token mismatch — dropped`);
          return;
        }
        const targetId = (data as Record<string, unknown>)?.targetUserId;
        if (targetId !== currentUserId) {
          logWarn('[E2EE][SIGNAL]', `accepted: targetUserId mismatch — dropped`);
          return;
        }
        log('[E2EE][SIGNAL]', `accepted: token OK — locking peer=${p.from}`);
        lockedPeerRef.current = p.from;
        offerSentRef.current = true;
        setPhase('connecting');
        await doSendOffer();
      }

      // ── Offer received by callee ──
      else if (type === 'offer' && myRoleRef.current === 'callee') {
        if (!validateSDP(data?.sdp, 'offer')) { logWarn('[E2EE][SIGNAL]', 'offer: invalid sdp'); return; }
        if (typeof data?.publicKey !== 'string') { logWarn('[E2EE][SIGNAL]', 'offer: missing publicKey'); return; }
        if (typeof data?.salt !== 'string') { logWarn('[E2EE][SIGNAL]', 'offer: missing salt'); return; }
        const saltBytes = hexToBytes(data.salt as string);
        if (!saltBytes || saltBytes.length !== 16) { logWarn('[E2EE][SIGNAL]', 'offer: invalid salt'); return; }
        const pc = pcRef.current;
        if (!pc) { logWarn('[E2EE][SIGNAL]', 'offer: no pc'); return; }
        if (pc.signalingState !== 'stable') { logWarn('[E2EE][SIGNAL]', `offer: wrong signalingState=${pc.signalingState}`); return; }
        try {
          log('[E2EE][PC]', 'setRemoteDescription offer');
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          await flushICEQueue(pc);
          log('[E2EE][PC]', 'createAnswer');
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          log('[E2EE][PC]', 'setLocalDescription answer');
          await doSetupKeys(data.publicKey as string, saltBytes);
          ch.send({
            type: 'broadcast', event: 'e2ee-signal',
            payload: { type: 'answer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current } },
          });
          log('[E2EE][SIGNAL]', 'answer sent');
        } catch (e) {
          logError('[E2EE][ERROR]', 'offer handling:', e);
          doFullCleanup('key_exchange');
        }
      }

      // ── Answer received by caller ──
      else if (type === 'answer' && myRoleRef.current === 'caller') {
        if (!validateSDP(data?.sdp, 'answer')) { logWarn('[E2EE][SIGNAL]', 'answer: invalid sdp'); return; }
        if (typeof data?.publicKey !== 'string') { logWarn('[E2EE][SIGNAL]', 'answer: missing publicKey'); return; }
        if (!saltRef.current) { logWarn('[E2EE][SIGNAL]', 'answer: no salt'); return; }
        const pc = pcRef.current;
        if (!pc) { logWarn('[E2EE][SIGNAL]', 'answer: no pc'); return; }
        if (pc.signalingState !== 'have-local-offer') { logWarn('[E2EE][SIGNAL]', `answer: wrong signalingState=${pc.signalingState}`); return; }
        try {
          log('[E2EE][PC]', 'setRemoteDescription answer');
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          await flushICEQueue(pc);
          await doSetupKeys(data.publicKey as string, saltRef.current);
        } catch (e) {
          logError('[E2EE][ERROR]', 'answer handling:', e);
          doFullCleanup('key_exchange');
        }
      }

      // ── ICE candidate ──
      else if (type === 'ice') {
        const candidate = data?.candidate;
        if (!validateIceCandidate(candidate)) {
          logWarn('[E2EE][ICE]', 'invalid ICE candidate payload — dropped');
          return;
        }
        const pc = pcRef.current;
        if (!pc) return;
        if (iceCandidateQueue.current.length >= ICE_QUEUE_MAX) {
          logWarn('[E2EE][ICE]', `ICE queue full (max=${ICE_QUEUE_MAX}) — dropping candidate`);
          return;
        }
        if (pc.remoteDescription) {
          log('[E2EE][ICE]', 'addIceCandidate (direct)');
          await pc.addIceCandidate(new RTCIceCandidate(candidate))
            .catch(e => logWarn('[E2EE][ICE]', 'addIceCandidate failed:', e));
        } else {
          log('[E2EE][ICE]', `queuing candidate (no remoteDesc yet) queueLen=${iceCandidateQueue.current.length + 1}`);
          iceCandidateQueue.current.push(candidate);
        }
      }

      // ── Hangup ──
      else if (type === 'hangup') {
        log('[E2EE][SIGNAL]', 'peer hung up');
        doHangup(false);
        toast('مخاطب تماس را قطع کرد');
      }

      // ── Rejected ──
      else if (type === 'rejected') {
        log('[E2EE][SIGNAL]', 'peer rejected call');
        doHangup(false);
        toast('مخاطب تماس را رد کرد');
      }
    });

    // NOTE: caller must call waitForSubscribed(ch) after this returns.
    // Do NOT call ch.subscribe() here — that would double-subscribe when
    // startCall/acceptCall await waitForSubscribed on the same channel.
    return ch;
  };

  // ── Start outgoing call ───────────────────────────────────────────────────
  const startCall = useCallback(async (target: UserProfile) => {
    log('[E2EE][CALL]', `startCall targetUserId=${target.user_id} myPeerId=${myPeerIdRef.current}`);
    log('[E2EE][CALL]', `browser transformsSupported=${SUPPORTS_TRANSFORMS} workerReady=${!!workerRef.current}`);

    if (!SUPPORTS_TRANSFORMS || !workerRef.current) {
      toast.error('مرورگر از RTCRtpScriptTransform پشتیبانی نمی‌کند');
      setE2eeStatus('unsupported');
      return;
    }

    try {
      setTargetUser(target);
      myRoleRef.current = 'caller';
      offerSentRef.current = false;

      // Invalidate cached RTCConfiguration so any admin changes take effect immediately
      invalidateRTCConfigCache();

      const sessionId = uuidv4();
      sessionIdRef.current = sessionId;
      setSessionCode(sessionId.slice(0, 8).toUpperCase());

      // 128-bit token — callee must echo for peer lock
      acceptTokenRef.current = randomHex(16);

      log('[E2EE][KEY]', 'generating ECDH key pair');
      ecdhKeyPairRef.current = await generateECDHKeyPair();
      myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);
      log('[E2EE][KEY]', 'ECDH key pair generated, public key exported');

      const stream = await startLocalStream();
      if (!stream) { doFullCleanup(); return; }

      // Subscribe to session channel before ringing to avoid missing 'accepted'
      const ch = openSessionChannel(sessionId);
      await waitForSubscribed(ch);
      log('[E2EE][SIGNAL]', 'session channel subscribed');

      await buildPC();
      log('[E2EE][PC]', 'PeerConnection built');

      // Mark session active only after minimum viable setup succeeds
      sessionActiveRef.current = true;

      const calleeInbox = supabase.channel(`e2ee-inbox-${target.user_id}`, {
        config: { broadcast: { self: false } },
      });
      await waitForSubscribed(calleeInbox);
      calleeInbox.send({
        type: 'broadcast', event: 'e2ee-ring',
        payload: {
          from: myPeerIdRef.current, sessionId, targetUserId: target.user_id,
          callerName: currentUserName, callerId: currentUserId,
          acceptToken: acceptTokenRef.current,
          expiresAt: Date.now() + INVITE_TTL_MS,
        },
      });
      setTimeout(() => supabase.removeChannel(calleeInbox), 3000);
      log('[E2EE][SIGNAL]', `ring sent to inbox-${target.user_id}`);

      setPhase('outgoing_ring');

      // Invite expiry: only cancel if still waiting for acceptance (not yet connected)
      const capturedSessionId = sessionId;
      setTimeout(() => {
        if (sessionIdRef.current === capturedSessionId && phaseRef.current === 'outgoing_ring') {
          log('[E2EE][CALL]', 'invite expired — still in outgoing_ring');
          doFullCleanup('invite_expired');
        }
      }, INVITE_TTL_MS);
    } catch (e) {
      logError('[E2EE][ERROR]', 'startCall failed:', e);
      toast.error('خطا در شروع تماس');
      doFullCleanup('key_exchange');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, currentUserName, doFullCleanup, doHangup]);

  // ── Accept incoming call ──────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const ic = incomingCall;
    if (!ic) return;
    log('[E2EE][CALL]', `acceptCall sessionId=${ic.sessionId} from=${ic.from}`);

    if (Date.now() > ic.expiresAt) {
      setIncomingCall(null);
      setPhase('idle');
      toast.error('دعوت به تماس منقضی شده');
      return;
    }
    if (!SUPPORTS_TRANSFORMS || !workerRef.current) {
      toast.error('مرورگر از تماس امن پشتیبانی نمی‌کند');
      return;
    }

    try {
      myRoleRef.current    = 'callee';
      sessionIdRef.current = ic.sessionId;
      lockedPeerRef.current = ic.from;
      offerSentRef.current = false;

      // Invalidate cached RTCConfiguration so any admin changes take effect immediately
      invalidateRTCConfigCache();

      log('[E2EE][KEY]', 'generating ECDH key pair (callee)');
      ecdhKeyPairRef.current = await generateECDHKeyPair();
      myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);
      log('[E2EE][KEY]', 'ECDH key pair generated (callee)');

      const stream = await startLocalStream();
      if (!stream) { doFullCleanup(); setIncomingCall(null); return; }

      const ch = openSessionChannel(ic.sessionId);
      await waitForSubscribed(ch);
      log('[E2EE][SIGNAL]', 'session channel subscribed (callee)');

      await buildPC();
      log('[E2EE][PC]', 'PeerConnection built (callee)');

      // Mark session active after minimum viable setup
      sessionActiveRef.current = true;

      ch.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: {
          type: 'accepted', from: myPeerIdRef.current, session: ic.sessionId,
          data: { acceptToken: ic.acceptToken, targetUserId: ic.callerId },
        },
      });
      log('[E2EE][SIGNAL]', 'accepted sent with token echo');

      setIncomingCall(null);
      setTargetUser({ user_id: ic.callerId, full_name: ic.callerName, email: null });
      setPhase('connecting');
    } catch (e) {
      logError('[E2EE][ERROR]', 'acceptCall failed:', e);
      toast.error('خطا در پذیرش تماس');
      doFullCleanup('key_exchange');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall, doFullCleanup]);

  // ── Reject incoming call ──────────────────────────────────────────────────
  const rejectCall = useCallback(() => {
    const ic = incomingCall;
    if (!ic) return;
    log('[E2EE][CALL]', `rejectCall sessionId=${ic.sessionId}`);
    setIncomingCall(null);
    setPhase('idle');
    // Send rejected signal asynchronously — UI already moved to idle
    const ch = supabase.channel(`e2ee-sess-${ic.sessionId}`, { config: { broadcast: { self: false } } });
    waitForSubscribed(ch)
      .then(() => {
        ch.send({ type: 'broadcast', event: 'e2ee-signal', payload: { type: 'rejected', from: myPeerIdRef.current, session: ic.sessionId, data: {} } });
        log('[E2EE][SIGNAL]', 'rejected signal sent');
      })
      .catch(err => logWarn('[E2EE][SIGNAL]', 'reject channel subscribe failed:', err))
      .finally(() => setTimeout(() => supabase.removeChannel(ch), 1500));
  }, [incomingCall]);

  // ── Media controls ────────────────────────────────────────────────────────
  const toggleMute  = () => { localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = isMuted; }); setIsMuted(v => !v); };
  const toggleVideo = () => { localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = isVideoOff; }); setIsVideoOff(v => !v); };

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => { doFullCleanup(); }, [doFullCleanup]);

  // ── Render helpers ────────────────────────────────────────────────────────

  const e2eeBadge = () => {
    if (e2eeStatus === 'active_verified')   return { icon: <ShieldCheck className="w-3.5 h-3.5" />, label: 'E2EE تأییدشده',         cls: 'bg-emerald-900/80 text-emerald-300' };
    if (e2eeStatus === 'active_unverified') return { icon: <ShieldAlert  className="w-3.5 h-3.5" />, label: 'E2EE — هویت تأییدنشده',  cls: 'bg-amber-900/80 text-amber-300' };
    if (e2eeStatus === 'error')             return { icon: <ShieldAlert  className="w-3.5 h-3.5" />, label: 'خطای رمزنگاری',          cls: 'bg-red-900/80 text-red-300' };
    return { icon: <Loader className="w-3.5 h-3.5 animate-spin" />, label: 'در انتظار کلید رمزنگاری...', cls: 'bg-gray-800/80 text-gray-300' };
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">بازگشت</button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">تماس با رمزنگاری سرتاسری</h2>
          </div>
        </div>
        {!SUPPORTS_TRANSFORMS && (
          <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-full flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" /> مرورگر ناسازگار — تماس رمزشده غیرممکن
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">

        {/* ── Browser unsupported ─────────────────────────────────────────── */}
        {!SUPPORTS_TRANSFORMS && (
          <div className="max-w-md mx-auto mt-6 p-5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2">
            <p className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2"><ShieldAlert className="w-5 h-5" /> مرورگر ناسازگار</p>
            <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
              مرورگر شما از <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">RTCRtpScriptTransform</code> پشتیبانی نمی‌کند.
              این قابلیت در Chrome 94+ و Firefox 117+ موجود است.
              تماس بدون رمزنگاری فریم در این صفحه <strong>شروع نمی‌شود</strong>.
            </p>
          </div>
        )}

        {/* ── Incoming ring ───────────────────────────────────────────────── */}
        {phase === 'incoming_ring' && incomingCall && (
          <div className="flex flex-col items-center justify-center py-16 gap-6">
            <div className="w-24 h-24 rounded-full bg-emerald-900/30 flex items-center justify-center animate-pulse">
              <PhoneIncoming className="w-12 h-12 text-emerald-400" />
            </div>
            <div className="text-center">
              <p className="text-white text-xl font-bold">{incomingCall.callerName}</p>
              <p className="text-gray-400 text-sm mt-1">تماس با قابلیت رمزنگاری سرتاسری</p>
              <p className="text-gray-500 text-xs mt-1">
                پس از اتصال، Safety Number را برای اطمینان از عدم MITM بررسی کنید.
              </p>
            </div>
            <div className="flex gap-5">
              <button onClick={rejectCall} className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center shadow-lg transition-colors"><PhoneOff className="w-7 h-7 text-white" /></button>
              <button onClick={acceptCall} className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center shadow-lg transition-colors"><Phone    className="w-7 h-7 text-white" /></button>
            </div>
          </div>
        )}

        {/* ── Outgoing ring ───────────────────────────────────────────────── */}
        {phase === 'outgoing_ring' && (
          <div className="flex flex-col items-center justify-center py-16 gap-5 bg-gray-900 rounded-2xl">
            <Loader className="w-10 h-10 text-emerald-400 animate-spin" />
            <div className="text-center">
              <p className="text-white text-lg font-semibold">در حال تماس با {targetUser?.full_name || targetUser?.email || 'مخاطب'}...</p>
              <p className="text-gray-400 text-xs mt-1">در انتظار پاسخ</p>
            </div>
            {sessionCode && (
              <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-xl">
                <span className="text-gray-300 text-xs">کد جلسه:</span>
                <span className="text-gray-100 text-sm font-mono tracking-widest">{sessionCode}</span>
              </div>
            )}
            <button onClick={() => doHangup()} className="px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm transition-colors flex items-center gap-2">
              <PhoneOff className="w-4 h-4" /> لغو تماس
            </button>
          </div>
        )}

        {/* ── Active call ─────────────────────────────────────────────────── */}
        {(phase === 'connecting' || phase === 'connected') && (
          <div className="relative h-[460px] sm:h-[540px] bg-gray-950 rounded-2xl overflow-hidden">
            {/* Remote video */}
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />

            {/* Connecting overlay */}
            {phase === 'connecting' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/80">
                <Loader className="w-8 h-8 text-emerald-400 animate-spin" />
                <span className="text-white text-sm">در حال اتصال...</span>
              </div>
            )}

            {/* Local PiP */}
            <div className="absolute bottom-20 right-3 w-28 h-20 sm:w-36 sm:h-24 rounded-xl overflow-hidden border-2 border-white/20 shadow-xl bg-gray-900">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>

            {/* E2EE badge */}
            {phase === 'connected' && (() => {
              const b = e2eeBadge();
              return (
                <button onClick={() => setShowSafety(true)} className={`absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${b.cls}`}>
                  {b.icon} {b.label}
                </button>
              );
            })()}

            {/* Peer name */}
            {targetUser && (
              <div className="absolute top-3 right-3 text-white/70 text-sm font-medium drop-shadow-sm">
                {targetUser.full_name || targetUser.email || 'مخاطب'}
              </div>
            )}

            {/* Controls */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
              <button onClick={toggleMute}  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isMuted    ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`}>{isMuted    ? <MicOff  className="w-5 h-5 text-white" /> : <Mic   className="w-5 h-5 text-white" />}</button>
              <button onClick={() => doHangup()} className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors"><PhoneOff className="w-6 h-6 text-white" /></button>
              <button onClick={toggleVideo} className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`}>{isVideoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}</button>
            </div>
          </div>
        )}

        {/* ── Safety Number modal ─────────────────────────────────────────── */}
        {showSafety && safetyNums && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm space-y-4" dir="rtl">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
                <h3 className="font-bold text-white">Safety Number جلسه</h3>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                این کد را از طریق کانالی مستقل (تلفن یا ملاقات حضوری) با مخاطب مقایسه کنید.
                اگر یکسان بود، هیچ MITM در تبادل کلید وجود نداشته است.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {safetyNums.map((g, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg px-3 py-2 text-center font-mono text-sm tracking-widest text-gray-200">{g}</div>
                ))}
              </div>
              <p className="text-xs text-amber-400 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                این کد فقط برای این جلسه معتبر است و هر بار تغییر می‌کند.
                Metadata تماس (IP، مدت، codec) توسط E2EE محافظت نمی‌شود.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { safetyVerifiedRef.current = true; setE2eeStatus('active_verified'); setShowSafety(false); }}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1"
                >
                  <Check className="w-4 h-4" /> مطابقت دارد
                </button>
                <button onClick={() => setShowSafety(false)} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-xl text-sm transition-colors">بستن</button>
              </div>
            </div>
          </div>
        )}

        {/* ── Ended / Failed ──────────────────────────────────────────────── */}
        {(phase === 'ended' || phase === 'failed') && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              {phase === 'failed' ? <ShieldAlert className="w-8 h-8 text-red-400" /> : <PhoneOff className="w-8 h-8 text-gray-400" />}
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-800 dark:text-white">
                {phase === 'failed' ? 'تماس ناموفق بود' : 'تماس پایان یافت'}
              </p>
              {phase === 'failed' && failReason && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {{ ice_failed: 'خطای شبکه ICE', key_exchange: 'خطای تبادل کلید رمزنگاری', no_transforms: 'مرورگر ناسازگار', peer_disconnected: 'مخاطب قطع شد', invite_expired: 'دعوت منقضی شد' }[failReason] ?? failReason}
                </p>
              )}
            </div>
            <button onClick={() => { setPhase('idle'); setFailReason(null); }}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors">
              <RefreshCw className="w-4 h-4" /> تماس جدید
            </button>
          </div>
        )}

        {/* ── Idle ───────────────────────────────────────────────────────── */}
        {phase === 'idle' && SUPPORTS_TRANSFORMS && (
          <div className="max-w-xl mx-auto space-y-5">
            <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">رمزنگاری سرتاسری (E2EE)</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
                  محتوای صوت و تصویر با <strong>AES-GCM-256</strong> رمز می‌شود. کلید رمزگشایی در اختیار سرور نیست — رمزگشایی فقط در مرورگر مخاطب انجام می‌شود.
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                  Metadata تماس (IP، مدت، codec، زمان‌بندی بسته‌ها) توسط E2EE محافظت نمی‌شود.
                  برای اطمینان از عدم MITM در تبادل کلید، Safety Number را پس از اتصال تأیید کنید.
                </p>
              </div>
            </div>

            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <Users className="w-4 h-4" /> تماس با کاربر
              </h3>
              <div className="relative">
                <input
                  type="text" value={userSearch} onChange={e => setUserSearch(e.target.value)}
                  placeholder="جستجوی نام یا ایمیل..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {searching && <Loader className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />}
              </div>
              {users.length > 0 && (
                <ul className="divide-y divide-gray-100 dark:divide-gray-700 max-h-48 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700">
                  {users.map(u => (
                    <li key={u.user_id}>
                      <button
                        onClick={() => startCall(u)}
                        className="w-full text-right px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center text-emerald-700 dark:text-emerald-400 text-sm font-bold shrink-0">
                          {(u.full_name || u.email || '?')[0].toUpperCase()}
                        </div>
                        <div className="min-w-0 text-right">
                          <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email || ''}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-1.5">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> Safety Number چیست؟</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 leading-relaxed">
                پس از اتصال، یک کد ۳۲ کاراکتری نشان داده می‌شود. اگر همین کد در مرورگر مخاطب نیز نمایش داده شود، تبادل کلید بدون دخالت واسطه انجام شده است.
                این مقایسه باید از طریق کانالی مستقل از این برنامه انجام شود.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


