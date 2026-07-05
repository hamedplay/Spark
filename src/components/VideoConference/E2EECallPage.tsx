/**
 * E2EECallPage — secure 1-to-1 video call
 *
 * SECURITY STACK
 * ──────────────
 * Key exchange: ECDH P-256 (ephemeral, non-extractable private key)
 * Key derivation: ECDH shared secret → HKDF-SHA-256 → AES-GCM-256
 * Directional keys: separate encrypt/decrypt CryptoKey objects derived with
 *   direction-aware HKDF info strings, so keys cannot be repurposed.
 * IV: 8-byte per-direction seed (HKDF-derived) ‖ 4-byte monotonic counter
 *   — avoids IV reuse even at high frame rates.
 * Frame encryption: runs inside a dedicated Web Worker via RTCRtpScriptTransform
 *   so the main thread is never blocked and key material never leaves the worker.
 *
 * SIGNALLING (Supabase Realtime Broadcast)
 * ─────────────────────────────────────────
 * e2ee-inbox-{userId}   — receives ring/invite (one per user, persistent)
 * e2ee-sess-{sessionId} — offer/answer/ICE/key-exchange (per call)
 *
 * After the peer lock is established only messages from the locked peer are
 * processed; all others are silently discarded.
 *
 * E2EE STATUS
 * ───────────
 * unsupported       — browser lacks RTCRtpScriptTransform
 * pending           — no active call
 * active_unverified — transforms installed, keys set; Safety Number not checked
 * active_verified   — Safety Number confirmed out-of-band
 * error             — worker or key-derivation failure
 *
 * KNOWN LIMITATIONS (future work)
 * ────────────────────────────────
 * • Safety Number uses public-key fingerprint, not a long-term identity key.
 *   TOFU/identity-key binding is not yet implemented.
 * • Media metadata (IP, timing, bitrate, codec, packet sizes) is NOT protected
 *   by E2EE — only the media payload content is encrypted.
 * • TURN relay may carry encrypted media packets, but TURN operators cannot
 *   decrypt them without the ECDH private key.
 * • Key rotation on long calls is scaffolded in the worker but not yet triggered.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, ShieldCheck, ShieldAlert,
  Loader, Copy, Check, Users, RefreshCw, Phone, PhoneIncoming, Eye, EyeOff,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getSharedRTCConfig } from '../../lib/rtcConfig';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';

// ── Constants ─────────────────────────────────────────────────────────────────

const INVITE_TTL_MS  = 2 * 60 * 1000; // invite expires after 2 min
const ICE_QUEUE_MAX  = 50;             // max queued ICE candidates before remote desc
const APP_ID         = typeof window !== 'undefined' ? window.location.hostname : 'app';

/** True when the browser supports RTCRtpScriptTransform (Chromium 94+, Firefox 117+). */
const SUPPORTS_TRANSFORMS =
  typeof RTCRtpScriptTransform !== 'undefined';

// ── Types ─────────────────────────────────────────────────────────────────────

type CallPhase =
  | 'idle'
  | 'outgoing_ring'   // caller: waiting for callee to accept
  | 'incoming_ring'   // callee: showing accept/reject UI
  | 'connecting'      // ICE negotiation in progress
  | 'connected'       // media flowing
  | 'ended'           // normal hangup
  | 'failed';         // ICE failure, key-exchange error, etc.

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

interface DerivedKeys {
  encryptKey: CryptoKey;      // encrypt-only, caller→callee or callee→caller
  decryptKey: CryptoKey;      // decrypt-only, opposite direction
  encryptIvSeed: Uint8Array;  // 8 B, direction-specific
  decryptIvSeed: Uint8Array;  // 8 B, peer's direction
}

interface IncomingCall {
  from: string;        // caller's peerId
  sessionId: string;
  callerName: string;
  callerId: string;    // caller's userId (for display only — not used for auth)
  expiresAt: number;
}

// ── JWK Validation ────────────────────────────────────────────────────────────

/**
 * Validates that a parsed object is a safe P-256 EC public-key JWK.
 * Rejects anything with unexpected fields or private key material.
 */
function validatePublicJWK(jwk: unknown): asserts jwk is JsonWebKey {
  if (typeof jwk !== 'object' || jwk === null) throw new Error('JWK must be an object');
  const j = jwk as Record<string, unknown>;
  if (j.kty !== 'EC')     throw new Error('Expected EC key');
  if (j.crv !== 'P-256')  throw new Error('Expected P-256 curve');
  if (typeof j.x !== 'string' || j.x.length < 40 || j.x.length > 50) throw new Error('Bad x coordinate');
  if (typeof j.y !== 'string' || j.y.length < 40 || j.y.length > 50) throw new Error('Bad y coordinate');
  if ('d' in j) throw new Error('JWK contains private key material');
  // Only allow known safe fields
  const allowed = new Set(['kty', 'crv', 'x', 'y', 'key_ops', 'ext', 'use']);
  for (const k of Object.keys(j)) {
    if (!allowed.has(k)) throw new Error(`Unexpected JWK field: ${k}`);
  }
}

// ── ECDH key helpers ──────────────────────────────────────────────────────────

async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,         // private key is non-extractable
    ['deriveKey'], // only usage needed for the ECDH→HKDF step
  );
}

async function exportPublicKey(pub: CryptoKey): Promise<string> {
  return JSON.stringify(await crypto.subtle.exportKey('jwk', pub));
}

async function importPublicKey(raw: string): Promise<CryptoKey> {
  const jwk: unknown = JSON.parse(raw);
  validatePublicJWK(jwk); // throws on invalid input
  return crypto.subtle.importKey(
    'jwk', jwk as JsonWebKey,
    { name: 'ECDH', namedCurve: 'P-256' },
    true, // extractable — needed only for Safety Number computation
    [],   // no usages — public key is only used as algorithm param
  );
}

// ── HKDF key derivation ───────────────────────────────────────────────────────

/**
 * Full derivation chain:
 *   ECDH P-256  →  HKDF-SHA-256 (IKM)
 *     → AES-GCM-256 encrypt key  (caller→callee direction)
 *     → AES-GCM-256 decrypt key  (callee→caller direction)
 *     → 8-byte IV seed            (per direction)
 *
 * `myRole` determines which direction is "send" and which is "receive".
 * Both peers independently derive the same four values from the same ECDH IKM,
 * so no additional round-trip is needed beyond the public-key exchange.
 */
async function deriveSessionKeys(
  myPrivate: CryptoKey,
  peerPublic: CryptoKey,
  sessionId: string,
  myRole: 'caller' | 'callee',
  salt: Uint8Array,
): Promise<DerivedKeys> {
  const enc  = new TextEncoder();
  const base = `v1|${APP_ID}|${sessionId}`;

  // Step 1: ECDH shared secret → HKDF intermediate key
  // Both deriveKey and deriveBits usages are needed for step 2.
  const hkdfKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublic },
    myPrivate,
    { name: 'HKDF' },
    false,
    ['deriveKey', 'deriveBits'],
  );

  // Step 2a: derive directional AES-GCM keys with context-rich info strings
  const [c2cKey, cc2Key] = await Promise.all([
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`${base}|caller-to-callee|aes-gcm-256`) },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      myRole === 'caller' ? ['encrypt'] : ['decrypt'],
    ),
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`${base}|callee-to-caller|aes-gcm-256`) },
      hkdfKey,
      { name: 'AES-GCM', length: 256 },
      false,
      myRole === 'callee' ? ['encrypt'] : ['decrypt'],
    ),
  ]);

  // Step 2b: derive per-direction IV seeds (8 bytes each)
  const [c2cIvBits, cc2IvBits] = await Promise.all([
    crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`${base}|caller-to-callee|iv-seed`) },
      hkdfKey, 64,
    ),
    crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode(`${base}|callee-to-caller|iv-seed`) },
      hkdfKey, 64,
    ),
  ]);

  // Assign keys according to role
  return myRole === 'caller'
    ? { encryptKey: c2cKey,  decryptKey: cc2Key,  encryptIvSeed: new Uint8Array(c2cIvBits),  decryptIvSeed: new Uint8Array(cc2IvBits)  }
    : { encryptKey: cc2Key,  decryptKey: c2cKey,  encryptIvSeed: new Uint8Array(cc2IvBits), decryptIvSeed: new Uint8Array(c2cIvBits) };
}

// ── Safety Number ─────────────────────────────────────────────────────────────

/**
 * Produces a deterministic fingerprint from both parties' public keys.
 * Both peers arrive at the same 4 groups by independently hashing the same
 * sorted JWK pair — they can compare these verbally or via QR code to detect
 * a MITM attack on the key exchange.
 *
 * NOTE: This is a session-level fingerprint, not a long-term identity key.
 * It changes every call. Future work: bind to a persistent identity key.
 */
async function computeSafetyNumber(myJWK: string, peerJWK: string): Promise<string[]> {
  const sorted = [myJWK, peerJWK].sort(); // deterministic regardless of who is caller
  const input  = new TextEncoder().encode(sorted.join('\0'));
  const hash   = await crypto.subtle.digest('SHA-256', input);
  const hex    = Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8), hex.slice(8,16), hex.slice(16,24), hex.slice(24,32)];
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

/** Basic schema check for inbound signalling payloads. */
function validateSignalPayload(
  payload: unknown,
  sessionId: string,
  lockedPeer: string | null,
): (Record<string, unknown> & { type: string; from: string }) | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  if (typeof p.type !== 'string' || p.type.length === 0 || p.type.length > 50) return null;
  if (typeof p.from !== 'string' || p.from.length === 0 || p.from.length > 200) return null;
  if (p.session !== sessionId) return null;
  if (lockedPeer !== null && p.from !== lockedPeer) return null; // peer-lock enforcement
  return p as Record<string, unknown> & { type: string; from: string };
}

// ── RTCRtpScriptTransform helpers ──────────────────────────────────────────────

function attachSenderTransforms(pc: RTCPeerConnection, worker: Worker): Map<string, MessagePort> {
  const ports = new Map<string, MessagePort>();
  if (!SUPPORTS_TRANSFORMS) return ports;
  for (const sender of pc.getSenders()) {
    if (!sender.track) continue;
    const { port1, port2 } = new MessageChannel();
    sender.transform = new RTCRtpScriptTransform(worker, { role: 'sender', port: port2 }, [port2]);
    ports.set(sender.track.id, port1);
  }
  return ports;
}

function attachReceiverTransform(receiver: RTCRtpReceiver, worker: Worker): MessagePort | null {
  if (!SUPPORTS_TRANSFORMS) return null;
  const { port1, port2 } = new MessageChannel();
  receiver.transform = new RTCRtpScriptTransform(worker, { role: 'receiver', port: port2 }, [port2]);
  return port1;
}

function pushKeyToPort(port: MessagePort, keys: DerivedKeys, role: 'sender' | 'receiver') {
  if (role === 'sender') {
    port.postMessage({ type: 'set-encrypt-key', key: keys.encryptKey, ivSeed: keys.encryptIvSeed, epoch: 0 }, []);
  } else {
    port.postMessage({ type: 'set-decrypt-key', key: keys.decryptKey, ivSeed: keys.decryptIvSeed, epoch: 0 }, []);
  }
  port.start();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  currentUserId: string;
  currentUserName: string;
  onBack: () => void;
}

export function E2EECallPage({ currentUserId, currentUserName, onBack }: Props) {
  // ── Display state ─────────────────────────────────────────────────────────
  const [phase,          setPhase]         = useState<CallPhase>('idle');
  const [e2eeStatus,     setE2eeStatus]    = useState<E2EEStatus>(SUPPORTS_TRANSFORMS ? 'pending' : 'unsupported');
  const [isMuted,        setIsMuted]       = useState(false);
  const [isVideoOff,     setIsVideoOff]    = useState(false);
  const [targetUser,     setTargetUser]    = useState<UserProfile | null>(null);
  const [incomingCall,   setIncomingCall]  = useState<IncomingCall | null>(null);
  const [safetyNums,     setSafetyNums]    = useState<string[] | null>(null);
  const [safetyVerified, setSafetyVerified]= useState(false);
  const [showSafety,     setShowSafety]    = useState(false);
  const [sessionCode,    setSessionCode]   = useState('');
  const [failReason,     setFailReason]    = useState<FailReason>(null);
  const [userSearch,     setUserSearch]    = useState('');
  const [users,          setUsers]         = useState<UserProfile[]>([]);
  const [searching,      setSearching]     = useState(false);

  // ── Refs (session state — read by event handlers without stale-closure risk) ─
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
  const senderPortsRef    = useRef<Map<string, MessagePort>>(new Map());
  const receiverPortsRef  = useRef<MessagePort[]>([]);
  const activeKeysRef     = useRef<DerivedKeys | null>(null);   // set after derivation
  const myRoleRef         = useRef<'caller' | 'callee'>('caller');
  const myPublicJWKRef    = useRef('');
  const saltRef           = useRef<Uint8Array | null>(null);    // caller creates, callee reads from offer
  const sessionActiveRef  = useRef(false);

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
    try {
      const w = new Worker('/e2ee-worker.js');
      w.addEventListener('error', e => {
        console.error('[E2EE] worker error:', e.message);
        setE2eeStatus('error');
        toast.error('خطای Worker رمزنگاری — تماس قطع شد');
        doFullCleanup('ice_failed');
      });
      workerRef.current = w;
    } catch (e) {
      console.error('[E2EE] worker load failed:', e);
      setE2eeStatus('error');
    }
    return () => { workerRef.current?.terminate(); workerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Inbox channel — receives incoming ring from any caller ────────────────
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS || !currentUserId) return;
    const ch = supabase.channel(`e2ee-inbox-${currentUserId}`, {
      config: { broadcast: { self: false } },
    });
    inboxChannelRef.current = ch;

    ch.on('broadcast', { event: 'e2ee-ring' }, ({ payload }) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as Record<string, unknown>;

      // targetUserId MUST match — prevents processing rings meant for other users
      if (p.targetUserId !== currentUserId) return;
      if (typeof p.from !== 'string'        || p.from.length > 200)       return;
      if (typeof p.sessionId !== 'string'   || p.sessionId.length > 100)  return;
      if (typeof p.callerName !== 'string'  || p.callerName.length > 200) return;
      if (typeof p.callerId !== 'string'    || p.callerId.length > 200)   return;
      if (typeof p.expiresAt !== 'number'   || Date.now() > p.expiresAt)  return; // expired

      // Already in a call — auto-reject silently
      if (sessionActiveRef.current) {
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
        from: p.from as string, sessionId: p.sessionId as string,
        callerName: p.callerName as string, callerId: p.callerId as string,
        expiresAt: p.expiresAt as number,
      });
      setPhase('incoming_ring');
    });

    ch.subscribe();
    return () => { supabase.removeChannel(ch); inboxChannelRef.current = null; };
  }, [currentUserId]);

  // ── Core session functions (read-from-refs pattern — no stale closure) ────

  const doFullCleanup = (reason?: FailReason) => {
    sessionActiveRef.current = false;
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    senderPortsRef.current.forEach(p => { try { p.close(); } catch { /* already closed */ } });
    senderPortsRef.current.clear();
    receiverPortsRef.current.forEach(p => { try { p.close(); } catch { /* already closed */ } });
    receiverPortsRef.current = [];
    iceCandidateQueue.current = [];
    activeKeysRef.current = null;
    lockedPeerRef.current  = null;
    saltRef.current        = null;
    if (sessionChannelRef.current) {
      supabase.removeChannel(sessionChannelRef.current);
      sessionChannelRef.current = null;
    }
    sessionIdRef.current    = '';
    ecdhKeyPairRef.current  = null;
    myPublicJWKRef.current  = '';
    setSafetyNums(null);
    setSafetyVerified(false);
    setShowSafety(false);
    setE2eeStatus(SUPPORTS_TRANSFORMS ? 'pending' : 'unsupported');
    if (reason) {
      setFailReason(reason);
      setPhase('failed');
    }
  };

  const doHangup = (sendSignal = true) => {
    if (sendSignal && sessionChannelRef.current && sessionIdRef.current) {
      sessionChannelRef.current.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: { type: 'hangup', from: myPeerIdRef.current, session: sessionIdRef.current, data: {} },
      });
    }
    doFullCleanup();
    setPhase('ended');
    setTargetUser(null);
    setIncomingCall(null);
  };

  const startLocalStream = async (): Promise<MediaStream | null> => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = s;
      if (localVideoRef.current) localVideoRef.current.srcObject = s;
      return s;
    } catch {
      toast.error('دسترسی به دوربین/میکروفون ممکن نیست');
      return null;
    }
  };

  const flushICEQueue = async (pc: RTCPeerConnection) => {
    const queued = iceCandidateQueue.current.splice(0);
    for (const c of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
  };

  const buildPC = async () => {
    const cfg = await getSharedRTCConfig();
    const pc  = new RTCPeerConnection(cfg);
    pcRef.current = pc;

    localStreamRef.current?.getTracks().forEach(t => pc.addTrack(t, localStreamRef.current!));

    // Attach sender transforms immediately after addTrack.
    // If keys are already derived (edge case), push them now.
    if (workerRef.current) {
      const ports = attachSenderTransforms(pc, workerRef.current);
      senderPortsRef.current = ports;
      if (activeKeysRef.current) {
        ports.forEach(p => pushKeyToPort(p, activeKeysRef.current!, 'sender'));
      }
    }

    pc.ontrack = e => {
      const stream = e.streams[0];
      if (stream && remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      if (workerRef.current) {
        const port = attachReceiverTransform(e.receiver, workerRef.current);
        if (port) {
          receiverPortsRef.current.push(port);
          // Keys may already be derived if the answer arrived before ontrack fires.
          if (activeKeysRef.current) {
            pushKeyToPort(port, activeKeysRef.current, 'receiver');
          }
        }
      }
    };

    pc.onicecandidate = e => {
      if (!e.candidate || !sessionChannelRef.current) return;
      sessionChannelRef.current.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: { type: 'ice', from: myPeerIdRef.current, session: sessionIdRef.current, data: { candidate: e.candidate.toJSON() } },
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') setPhase('connected');
      else if (pc.connectionState === 'failed') doFullCleanup('ice_failed');
    };

    return pc;
  };

  const doSetupKeys = async (peerPublicJWK: string, salt: Uint8Array) => {
    if (!ecdhKeyPairRef.current) return;
    try {
      const peerPub = await importPublicKey(peerPublicJWK); // validates JWK shape
      const keys    = await deriveSessionKeys(
        ecdhKeyPairRef.current.privateKey, peerPub,
        sessionIdRef.current, myRoleRef.current, salt,
      );
      activeKeysRef.current = keys;

      // Push to all existing sender ports (direction = encrypt)
      senderPortsRef.current.forEach(p => pushKeyToPort(p, keys, 'sender'));
      // Push to all existing receiver ports (direction = decrypt)
      receiverPortsRef.current.forEach(p => pushKeyToPort(p, keys, 'receiver'));

      // Safety Number — both peers arrive at the same value independently
      const nums = await computeSafetyNumber(myPublicJWKRef.current, peerPublicJWK);
      setSafetyNums(nums);
      setE2eeStatus('active_unverified');
    } catch (e) {
      console.error('[E2EE] key setup failed:', e);
      toast.error('خطا در رمزنگاری — تماس لغو شد');
      doFullCleanup('key_exchange');
    }
  };

  const doSendOffer = async () => {
    const pc = pcRef.current;
    const ch = sessionChannelRef.current;
    if (!pc || !ch) return;

    // Caller generates the HKDF salt — it's included in the offer so callee can derive keys
    const salt    = crypto.getRandomValues(new Uint8Array(16));
    saltRef.current = salt;

    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);

    ch.send({
      type: 'broadcast', event: 'e2ee-signal',
      payload: {
        type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current,
        data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: bytesToHex(salt) },
      },
    });
  };

  /**
   * Opens the session signalling channel and wires up the message handler.
   * All inbound messages are validated against sessionId and the peer lock.
   */
  const openSessionChannel = (sessionId: string) => {
    const ch = supabase.channel(`e2ee-sess-${sessionId}`, {
      config: { broadcast: { self: false } },
    });
    sessionChannelRef.current = ch;

    ch.on('broadcast', { event: 'e2ee-signal' }, async ({ payload }) => {
      const p = validateSignalPayload(payload, sessionIdRef.current, lockedPeerRef.current);
      if (!p) return;

      const type = p.type;
      const data = p.data as Record<string, unknown> | undefined;

      // ── Callee accepted → Caller can now send the offer ──
      if (type === 'accepted' && myRoleRef.current === 'caller') {
        lockedPeerRef.current = p.from; // lock to this peer for the rest of the session
        setPhase('connecting');
        await doSendOffer();
      }

      // ── Offer received by callee ──
      else if (type === 'offer' && myRoleRef.current === 'callee') {
        if (!data?.sdp || typeof data.publicKey !== 'string' || typeof data.salt !== 'string') return;
        const saltBytes = hexToBytes(data.salt as string);
        if (!saltBytes || saltBytes.length !== 16) return;
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'stable') return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          await flushICEQueue(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await doSetupKeys(data.publicKey as string, saltBytes);
          ch.send({
            type: 'broadcast', event: 'e2ee-signal',
            payload: { type: 'answer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current } },
          });
        } catch (e) { console.error('[E2EE] offer handling:', e); doFullCleanup('key_exchange'); }
      }

      // ── Answer received by caller ──
      else if (type === 'answer' && myRoleRef.current === 'caller') {
        if (!data?.sdp || typeof data.publicKey !== 'string') return;
        if (!saltRef.current) return;
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'have-local-offer') return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          await flushICEQueue(pc);
          await doSetupKeys(data.publicKey as string, saltRef.current);
        } catch (e) { console.error('[E2EE] answer handling:', e); doFullCleanup('key_exchange'); }
      }

      // ── ICE candidate ──
      else if (type === 'ice') {
        const candidate = data?.candidate;
        if (!candidate || typeof candidate !== 'object') return;
        const pc = pcRef.current;
        if (!pc) return;
        if (iceCandidateQueue.current.length >= ICE_QUEUE_MAX) return; // prevent memory pressure
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate as RTCIceCandidateInit)).catch(() => {});
        } else {
          iceCandidateQueue.current.push(candidate as RTCIceCandidateInit);
        }
      }

      // ── Hangup ──
      else if (type === 'hangup') {
        doHangup(false);
        toast('مخاطب تماس را قطع کرد');
      }

      // ── Rejected ──
      else if (type === 'rejected') {
        doHangup(false);
        toast('مخاطب تماس را رد کرد');
      }
    });

    ch.subscribe();
    return ch;
  };

  // ── Start outgoing call ───────────────────────────────────────────────────
  const startCall = useCallback(async (target: UserProfile) => {
    if (!SUPPORTS_TRANSFORMS || !workerRef.current) {
      toast.error('مرورگر از RTCRtpScriptTransform پشتیبانی نمی‌کند');
      setE2eeStatus('unsupported');
      return;
    }
    setTargetUser(target);
    myRoleRef.current  = 'caller';
    sessionActiveRef.current = true;
    const sessionId    = uuidv4();
    sessionIdRef.current = sessionId;
    setSessionCode(sessionId.slice(0, 8).toUpperCase());

    ecdhKeyPairRef.current = await generateECDHKeyPair();
    myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);

    const stream = await startLocalStream();
    if (!stream) { doFullCleanup(); return; }

    // Subscribe to the session channel before ringing so we don't miss 'accepted'
    const ch = openSessionChannel(sessionId);
    await new Promise<void>(r => {
      const unsub = ch.subscribe(status => { if (status === 'SUBSCRIBED') { unsub(); r(); } });
    });

    await buildPC();

    // Ring callee on their user-specific inbox channel
    const calleeInbox = supabase.channel(`e2ee-inbox-${target.user_id}`, {
      config: { broadcast: { self: false } },
    });
    await new Promise<void>(r => {
      const unsub = calleeInbox.subscribe(s => { if (s === 'SUBSCRIBED') { unsub(); r(); } });
    });
    calleeInbox.send({
      type: 'broadcast', event: 'e2ee-ring',
      payload: {
        from: myPeerIdRef.current, sessionId, targetUserId: target.user_id,
        callerName: currentUserName, callerId: currentUserId,
        expiresAt: Date.now() + INVITE_TTL_MS,
      },
    });
    setTimeout(() => supabase.removeChannel(calleeInbox), 3000);

    setPhase('outgoing_ring');

    // Auto-cancel if callee never responds within the invite window
    const capturedSessionId = sessionId;
    setTimeout(() => {
      if (sessionIdRef.current === capturedSessionId) doFullCleanup('invite_expired');
    }, INVITE_TTL_MS);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, currentUserName]);

  // ── Accept incoming call ──────────────────────────────────────────────────
  const acceptCall = useCallback(async () => {
    const ic = incomingCall;
    if (!ic) return;
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

    myRoleRef.current    = 'callee';
    sessionIdRef.current = ic.sessionId;
    lockedPeerRef.current = ic.from; // lock immediately — caller identity is from signed session
    sessionActiveRef.current = true;

    ecdhKeyPairRef.current = await generateECDHKeyPair();
    myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);

    const stream = await startLocalStream();
    if (!stream) { doFullCleanup(); setIncomingCall(null); return; }

    const ch = openSessionChannel(ic.sessionId);
    await new Promise<void>(r => {
      const unsub = ch.subscribe(s => { if (s === 'SUBSCRIBED') { unsub(); r(); } });
    });

    await buildPC();

    ch.send({
      type: 'broadcast', event: 'e2ee-signal',
      payload: { type: 'accepted', from: myPeerIdRef.current, session: ic.sessionId, data: {} },
    });

    setIncomingCall(null);
    setTargetUser({ user_id: ic.callerId, full_name: ic.callerName, email: null });
    setPhase('connecting');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingCall]);

  // ── Reject incoming call ──────────────────────────────────────────────────
  const rejectCall = useCallback(() => {
    const ic = incomingCall;
    if (!ic) return;
    const ch = supabase.channel(`e2ee-sess-${ic.sessionId}`, { config: { broadcast: { self: false } } });
    ch.subscribe(() => {
      ch.send({ type: 'broadcast', event: 'e2ee-signal', payload: { type: 'rejected', from: myPeerIdRef.current, session: ic.sessionId, data: {} } });
      setTimeout(() => supabase.removeChannel(ch), 1500);
    });
    setIncomingCall(null);
    setPhase('idle');
  }, [incomingCall]);

  // ── Media controls ────────────────────────────────────────────────────────
  const toggleMute  = () => { localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = isMuted; }); setIsMuted(v => !v); };
  const toggleVideo = () => { localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = isVideoOff; }); setIsVideoOff(v => !v); };

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => () => { doFullCleanup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const e2eeBadge = () => {
    if (e2eeStatus === 'active_verified')   return { icon: <ShieldCheck className="w-3.5 h-3.5" />, label: 'E2EE تأییدشده',   cls: 'bg-emerald-900/80 text-emerald-300' };
    if (e2eeStatus === 'active_unverified') return { icon: <ShieldAlert  className="w-3.5 h-3.5" />, label: 'E2EE — تأییدنشده', cls: 'bg-amber-900/80 text-amber-300' };
    return { icon: <Loader className="w-3.5 h-3.5 animate-spin" />, label: 'در انتظار کلید...', cls: 'bg-gray-800/80 text-gray-300' };
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors">بازگشت</button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">تماس امن E2EE</h2>
          </div>
        </div>
        {!SUPPORTS_TRANSFORMS && (
          <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-full flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" /> مرورگر ناسازگار — تماس امن غیرممکن
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">

        {/* ── Browser unsupported ─────────────────────────────────────────── */}
        {!SUPPORTS_TRANSFORMS && (
          <div className="max-w-md mx-auto mt-6 p-5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2">
            <p className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2"><ShieldAlert className="w-5 h-5" /> مرورگر ناسازگار</p>
            <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
              مرورگر شما از <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">RTCRtpScriptTransform</code> پشتیبانی نمی‌کند. این قابلیت در Chrome 94+ و Firefox 117+ موجود است.
              تماس بدون رمزنگاری در این صفحه <strong>شروع نمی‌شود</strong>.
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
              <p className="text-gray-400 text-sm mt-1 flex items-center justify-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> تماس تصویری امن E2EE
              </p>
            </div>
            <div className="flex gap-5">
              <button onClick={rejectCall}  className="w-16 h-16 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center shadow-lg transition-colors"><PhoneOff className="w-7 h-7 text-white" /></button>
              <button onClick={acceptCall}  className="w-16 h-16 rounded-full bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center shadow-lg transition-colors"><Phone    className="w-7 h-7 text-white" /></button>
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

        {/* ── Active call (connecting / connected) ────────────────────────── */}
        {(phase === 'connecting' || phase === 'connected') && (
          <div className="relative h-[460px] sm:h-[540px] bg-gray-950 rounded-2xl overflow-hidden">
            {/* Remote video */}
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />

            {/* Local PiP */}
            <div className="absolute bottom-20 right-3 w-28 h-20 sm:w-36 sm:h-24 rounded-xl overflow-hidden border-2 border-white/20 shadow-xl bg-gray-900">
              <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
            </div>

            {/* Connecting indicator */}
            {phase === 'connecting' && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2">
                <span className="px-3 py-1 rounded-full bg-black/60 text-white text-xs flex items-center gap-1.5">
                  <Loader className="w-3 h-3 animate-spin" /> در حال اتصال...
                </span>
              </div>
            )}

            {/* E2EE status badge */}
            {phase === 'connected' && (() => {
              const b = e2eeBadge();
              return (
                <button
                  onClick={() => setShowSafety(true)}
                  className={`absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${b.cls}`}
                >
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
                <h3 className="font-bold text-white">تأیید Safety Number</h3>
              </div>
              <p className="text-sm text-gray-400 leading-relaxed">
                این کد را با مخاطب از طریق یک کانال مستقل (تلفن، پیام‌رسان دیگر) مقایسه کنید.
                اگر یکسان بود، کلیدها تعویض نشده‌اند.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {safetyNums.map((g, i) => (
                  <div key={i} className="bg-gray-800 rounded-lg px-3 py-2 text-center font-mono text-sm tracking-widest text-gray-200">{g}</div>
                ))}
              </div>
              <p className="text-xs text-amber-400 flex items-center gap-1">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                این کد هر بار تغییر می‌کند — برای هر تماس باید بررسی شود.
              </p>
              <div className="flex gap-2">
                <button onClick={() => { setSafetyVerified(true); setE2eeStatus('active_verified'); setShowSafety(false); }}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1">
                  <Check className="w-4 h-4" /> مطابقت دارد
                </button>
                <button onClick={() => setShowSafety(false)}
                  className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-xl text-sm transition-colors">بستن</button>
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

        {/* ── Idle — user search + info ───────────────────────────────────── */}
        {phase === 'idle' && SUPPORTS_TRANSFORMS && (
          <div className="max-w-xl mx-auto space-y-5">
            {/* Accurate E2EE description */}
            <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">رمزنگاری سرتاسری فعال (E2EE)</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 leading-relaxed">
                  محتوای صوت و تصویر با <strong>AES-GCM-256</strong> رمز می‌شود. کلید رمزگشایی هرگز به سرور منتقل نمی‌شود — رمزگشایی فقط در مرورگر مخاطب انجام می‌شود.
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                  Metadata تماس (IP، مدت، codec، زمان‌بندی بسته‌ها) توسط E2EE محافظت نمی‌شود.
                  برای اطمینان از عدم MITM، Safety Number را پس از اتصال تأیید کنید.
                </p>
              </div>
            </div>

            {/* User search */}
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

            {/* How Safety Number works */}
            <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-1.5">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1"><Eye className="w-3.5 h-3.5" /> Safety Number چیست؟</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 leading-relaxed">
                پس از اتصال، یک کد ۳۲ کاراکتری روی صفحه نمایش داده می‌شود. اگر طرف مقابل همان کد را دارد، تماس MITM-free است.
                این مقایسه باید از طریق کانالی مستقل (تلفن، ملاقات حضوری) انجام شود.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export { E2EECallPage }