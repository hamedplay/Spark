/**
 * E2EECallPage — secure 1-to-1 video call using WebRTC Encoded Transforms.
 *
 * Encryption stack:
 *   ECDH (P-256)  →  HKDF-SHA-256  →  AES-GCM-256
 *
 * Every audio/video frame is encrypted inside a dedicated Web Worker
 * (`/e2ee-worker.js`) via RTCRtpScriptTransform so the main thread is never
 * blocked.  Key exchange happens over Supabase Realtime Broadcast (the same
 * channel already used for WebRTC signalling).
 *
 * Future migration path: replace the RTCRtpScriptTransform pipeline with an
 * SFrameTransform once the standard lands in all target browsers — the key
 * derivation and signalling layers are unchanged.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, ShieldCheck,
  Loader, Copy, Check, Users, RefreshCw,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getSharedRTCConfig } from '../../lib/rtcConfig';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';

// ── Types ─────────────────────────────────────────────────────────────────────

interface UserProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
}

type CallPhase =
  | 'idle'        // no call — showing invite UI
  | 'waiting'     // local peer created session, waiting for remote
  | 'calling'     // received a session invite, ringing UI
  | 'connecting'  // ICE in progress
  | 'connected'   // fully established + E2EE active
  | 'failed'      // ICE failed or key exchange timed out
  | 'ended';      // call terminated normally

// ── ECDH / AES-GCM helpers ────────────────────────────────────────────────────

/** Generate an ephemeral ECDH P-256 key pair. */
async function generateECDHKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false, // private key non-extractable
    ['deriveKey'],
  );
}

/** Export a public key as base64 JSON Web Key. */
async function exportPublicKey(pub: CryptoKey): Promise<string> {
  const jwk = await crypto.subtle.exportKey('jwk', pub);
  return JSON.stringify(jwk);
}

/** Import a peer's exported public key. */
async function importPublicKey(raw: string): Promise<CryptoKey> {
  const jwk: JsonWebKey = JSON.parse(raw);
  return crypto.subtle.importKey('jwk', jwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
}

/**
 * Derive a shared AES-GCM-256 key via ECDH + HKDF-SHA-256.
 * Both peers produce the same key without it ever leaving the browser.
 */
async function deriveAESKey(
  myPrivate: CryptoKey,
  peerPublic: CryptoKey,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const ecdhShared = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: peerPublic },
    myPrivate,
    { name: 'HKDF' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: new TextEncoder().encode('E2EE-AES-GCM-256'),
    },
    ecdhShared,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

// ── RTCRtpScriptTransform wiring ──────────────────────────────────────────────

/**
 * Attach E2EE transforms to all senders/receivers on a PeerConnection.
 * Returns a map of MessagePorts (one per track id) that accept `set-key` messages.
 *
 * Falls back gracefully if `RTCRtpScriptTransform` is not available in the browser.
 */
function attachTransforms(
  pc: RTCPeerConnection,
  worker: Worker,
): { senderPorts: Map<string, MessagePort>; receiverPorts: MessagePort[] } {
  const senderPorts = new Map<string, MessagePort>();
  const receiverPorts: MessagePort[] = [];

  if (typeof RTCRtpScriptTransform === 'undefined') {
    console.warn('[E2EE] RTCRtpScriptTransform not available — running unencrypted');
    return { senderPorts, receiverPorts };
  }

  for (const sender of pc.getSenders()) {
    if (!sender.track) continue;
    const { port1, port2 } = new MessageChannel();
    sender.transform = new RTCRtpScriptTransform(worker, { role: 'sender', port: port2 }, [port2]);
    senderPorts.set(sender.track.id, port1);
  }

  return { senderPorts, receiverPorts };
}

/** Attach receiver transforms after `ontrack`. Returns the new MessagePort. */
function attachReceiverTransform(
  receiver: RTCRtpReceiver,
  worker: Worker,
): MessagePort | null {
  if (typeof RTCRtpScriptTransform === 'undefined') return null;
  const { port1, port2 } = new MessageChannel();
  receiver.transform = new RTCRtpScriptTransform(worker, { role: 'receiver', port: port2 }, [port2]);
  return port1;
}

/** Push a CryptoKey to a worker via its MessagePort. */
function sendKeyToWorker(port: MessagePort, key: CryptoKey) {
  port.postMessage({ type: 'set-key', key }, []);
  port.start();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  currentUserId: string;
  currentUserName: string;
  onBack: () => void;
}

export function E2EECallPage({ currentUserId, currentUserName, onBack }: Props) {
  // ── UI state ──────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [e2eeActive, setE2eeActive] = useState(false);
  const [sessionCode, setSessionCode] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [searching, setSearching] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [targetUser, setTargetUser] = useState<UserProfile | null>(null);
  const [peerId, setPeerId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const localVideoRef  = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef  = useRef<MediaStream | null>(null);
  const pcRef           = useRef<RTCPeerConnection | null>(null);
  const channelRef      = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const workerRef       = useRef<Worker | null>(null);
  const myPeerIdRef     = useRef<string>(uuidv4());
  const senderPortsRef  = useRef<Map<string, MessagePort>>(new Map());
  const receiverPortsRef = useRef<MessagePort[]>([]);
  const ecdhKeyPairRef  = useRef<CryptoKeyPair | null>(null);
  const sessionIdRef    = useRef<string>('');
  const iceCandidateQueueRef = useRef<RTCIceCandidateInit[]>([]);

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

  // ── Worker init (once) ────────────────────────────────────────────────────
  useEffect(() => {
    try {
      const w = new Worker('/e2ee-worker.js');
      workerRef.current = w;
    } catch (e) {
      console.warn('[E2EE] Worker load failed:', e);
    }
    return () => { workerRef.current?.terminate(); };
  }, []);

  // ── Local media ───────────────────────────────────────────────────────────
  const startLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch {
      toast.error('دسترسی به دوربین/میکروفون ممکن نیست');
      return null;
    }
  }, []);

  // ── Build RTCPeerConnection ────────────────────────────────────────────────
  const buildPC = useCallback(async (): Promise<RTCPeerConnection> => {
    const rtcCfg = await getSharedRTCConfig();
    const pc = new RTCPeerConnection(rtcCfg);
    pcRef.current = pc;

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => {
        pc.addTrack(t, localStreamRef.current!);
      });
    }

    // Attach sender transforms AFTER addTrack
    if (workerRef.current) {
      const { senderPorts } = attachTransforms(pc, workerRef.current);
      senderPortsRef.current = senderPorts;
    }

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = stream;
      }
      // Attach receiver transform
      if (workerRef.current) {
        const port = attachReceiverTransform(e.receiver, workerRef.current);
        if (port) receiverPortsRef.current.push(port);
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        channelRef.current?.send({
          type: 'broadcast',
          event: 'e2ee-signal',
          payload: {
            from: myPeerIdRef.current,
            session: sessionIdRef.current,
            type: 'ice',
            data: { candidate: e.candidate.toJSON() },
          },
        });
      }
    };

    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') setPhase('connected');
      if (s === 'failed' || s === 'closed') {
        setPhase('failed');
        hangup(false);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'checking') setPhase('connecting');
    };

    return pc;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── ECDH key exchange ──────────────────────────────────────────────────────
  const doKeyExchange = useCallback(async (exportedPeerPublicKey: string, saltHex: string) => {
    if (!ecdhKeyPairRef.current) return;
    try {
      const salt = new Uint8Array(saltHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
      const peerPublic = await importPublicKey(exportedPeerPublicKey);
      const aesKey = await deriveAESKey(ecdhKeyPairRef.current.privateKey, peerPublic, salt);

      // Push the same shared key to all sender ports
      senderPortsRef.current.forEach(port => sendKeyToWorker(port, aesKey));
      // Push to receiver ports
      receiverPortsRef.current.forEach(port => sendKeyToWorker(port, aesKey));

      setE2eeActive(true);
    } catch (e) {
      console.error('[E2EE] key derivation failed', e);
      toast.error('خطا در تبادل کلید رمزنگاری');
    }
  }, []);

  // ── Flush ICE queue ────────────────────────────────────────────────────────
  const flushICE = useCallback(async (pc: RTCPeerConnection) => {
    for (const c of iceCandidateQueueRef.current) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
    iceCandidateQueueRef.current = [];
  }, []);

  // ── Signalling channel ─────────────────────────────────────────────────────
  const openSignalChannel = useCallback((sessionId: string) => {
    const ch = supabase.channel(`e2ee-${sessionId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = ch;

    ch.on('broadcast', { event: 'e2ee-signal' }, async ({ payload }) => {
      if (payload.from === myPeerIdRef.current) return;
      if (payload.session !== sessionIdRef.current) return;

      const { type, data } = payload;

      if (type === 'offer') {
        const pc = pcRef.current ?? await buildPC();
        if (pc.signalingState !== 'stable') return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushICE(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        channelRef.current?.send({
          type: 'broadcast',
          event: 'e2ee-signal',
          payload: {
            from: myPeerIdRef.current,
            session: sessionIdRef.current,
            type: 'answer',
            data: { sdp: pc.localDescription },
          },
        });
        // Now exchange keys — send our public key
        const exported = await exportPublicKey(ecdhKeyPairRef.current!.publicKey);
        channelRef.current?.send({
          type: 'broadcast',
          event: 'e2ee-signal',
          payload: {
            from: myPeerIdRef.current,
            session: sessionIdRef.current,
            type: 'key-exchange',
            data: { publicKey: exported, salt: data.salt },
          },
        });
        // We also derive with the offerer's key
        await doKeyExchange(data.publicKey, data.salt);
        setPhase('connecting');

      } else if (type === 'answer') {
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        await flushICE(pc);

      } else if (type === 'ice') {
        const pc = pcRef.current;
        if (!pc) return;
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
        } else {
          iceCandidateQueueRef.current.push(data.candidate);
        }

      } else if (type === 'key-exchange') {
        // Answerer sent their public key back
        await doKeyExchange(data.publicKey, data.salt);

      } else if (type === 'hangup') {
        setPhase('ended');
        hangup(false);
        toast('مخاطب تماس را قطع کرد');

      } else if (type === 'ring') {
        setPeerId(payload.from);
        setPhase('calling');
        setTargetUser({ user_id: data.callerId, full_name: data.callerName, email: null });
      }
    });

    ch.subscribe();
    return ch;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildPC, doKeyExchange, flushICE]);

  // ── Initiate call ─────────────────────────────────────────────────────────
  const startCall = useCallback(async (target: UserProfile) => {
    setTargetUser(target);
    const sessionId = uuidv4().replace(/-/g, '').slice(0, 12).toUpperCase();
    sessionIdRef.current = sessionId;
    setSessionCode(sessionId);
    setPhase('waiting');

    // Generate ECDH key pair and salt
    ecdhKeyPairRef.current = await generateECDHKeyPair();
    const saltBytes = crypto.getRandomValues(new Uint8Array(16));
    const saltHex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');

    const stream = await startLocalStream();
    if (!stream) { setPhase('idle'); return; }

    const ch = openSignalChannel(sessionId);

    // Brief delay so the channel is subscribed before sending offer
    await new Promise(r => setTimeout(r, 800));

    const pc = await buildPC();

    // Notify remote (ring)
    ch.send({
      type: 'broadcast',
      event: 'e2ee-signal',
      payload: {
        from: myPeerIdRef.current,
        session: sessionId,
        type: 'ring',
        data: { callerId: currentUserId, callerName: currentUserName, targetUserId: target.user_id, sessionId },
      },
    });

    // Create and send offer with our public key + salt embedded
    const exportedKey = await exportPublicKey(ecdhKeyPairRef.current.publicKey);
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);

    ch.send({
      type: 'broadcast',
      event: 'e2ee-signal',
      payload: {
        from: myPeerIdRef.current,
        session: sessionId,
        type: 'offer',
        data: { sdp: pc.localDescription, publicKey: exportedKey, salt: saltHex },
      },
    });
  }, [startLocalStream, buildPC, openSignalChannel, currentUserId, currentUserName]);

  // ── Join by code ──────────────────────────────────────────────────────────
  const joinByCode = useCallback(async () => {
    if (!joinCode.trim()) return;
    const sessionId = joinCode.trim().toUpperCase();
    sessionIdRef.current = sessionId;
    ecdhKeyPairRef.current = await generateECDHKeyPair();
    const stream = await startLocalStream();
    if (!stream) return;
    openSignalChannel(sessionId);
    setPhase('waiting');
    toast('در انتظار تماس‌گیرنده...');
  }, [joinCode, startLocalStream, openSignalChannel]);

  // ── Hangup ────────────────────────────────────────────────────────────────
  const hangup = useCallback((sendSignal = true) => {
    if (sendSignal && channelRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'e2ee-signal',
        payload: {
          from: myPeerIdRef.current,
          session: sessionIdRef.current,
          type: 'hangup',
          data: {},
        },
      });
    }
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    senderPortsRef.current.clear();
    receiverPortsRef.current = [];
    iceCandidateQueueRef.current = [];
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    setE2eeActive(false);
    setPhase('ended');
  }, []);

  // Cleanup on unmount
  useEffect(() => () => { hangup(false); }, [hangup]);

  // ── Controls ──────────────────────────────────────────────────────────────
  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = isMuted; });
    setIsMuted(v => !v);
  };

  const toggleVideo = () => {
    localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = isVideoOff; });
    setIsVideoOff(v => !v);
  };

  const copyCode = () => {
    navigator.clipboard.writeText(sessionCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  };

  const supportsE2EE = typeof RTCRtpScriptTransform !== 'undefined';

  // ── Render ─────────────────────────────────────────────────────────────────
  const renderCallUI = () => (
    <div className="relative flex flex-col h-full bg-gray-950 rounded-2xl overflow-hidden">
      {/* Remote video */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="w-full h-full object-cover"
      />

      {/* Local video PIP */}
      <div className="absolute bottom-24 right-4 w-28 h-20 sm:w-36 sm:h-24 rounded-xl overflow-hidden border-2 border-white/20 shadow-lg bg-gray-900">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover"
        />
      </div>

      {/* Status overlay */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2">
        {phase === 'connecting' && (
          <span className="px-3 py-1 rounded-full bg-black/60 text-white text-xs flex items-center gap-1.5">
            <Loader className="w-3 h-3 animate-spin" /> در حال اتصال...
          </span>
        )}
        {phase === 'connected' && (
          <span className={`px-3 py-1 rounded-full text-xs flex items-center gap-1.5 font-medium ${
            e2eeActive
              ? 'bg-emerald-900/80 text-emerald-300'
              : 'bg-amber-900/80 text-amber-300'
          }`}>
            <ShieldCheck className="w-3.5 h-3.5" />
            {e2eeActive ? 'رمزنگاری سرتاسری فعال' : 'در حال فعال‌سازی E2EE...'}
          </span>
        )}
      </div>

      {/* Peer name */}
      {targetUser && (
        <div className="absolute top-4 left-4 text-white/80 text-sm font-medium drop-shadow">
          {targetUser.full_name || targetUser.email || 'مخاطب'}
        </div>
      )}

      {/* Controls bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
        <button
          onClick={toggleMute}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
            isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'
          }`}
        >
          {isMuted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
        </button>
        <button
          onClick={() => { hangup(); }}
          className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors"
        >
          <PhoneOff className="w-6 h-6 text-white" />
        </button>
        <button
          onClick={toggleVideo}
          className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
            isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'
          }`}
        >
          {isVideoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            بازگشت
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">تماس تصویری امن (E2EE)</h2>
          </div>
        </div>
        {!supportsE2EE && (
          <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2.5 py-1 rounded-full">
            مرورگر از Encoded Transforms پشتیبانی نمی‌کند — بدون رمزنگاری
          </span>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-4">
        {/* Active call */}
        {(phase === 'connecting' || phase === 'connected' || phase === 'calling' || phase === 'waiting') && (
          <div className="h-[480px] sm:h-[560px]">
            {phase === 'calling' ? (
              <div className="flex flex-col items-center justify-center h-full gap-6 bg-gray-900 rounded-2xl">
                <div className="w-20 h-20 rounded-full bg-emerald-900/40 flex items-center justify-center animate-pulse">
                  <Video className="w-10 h-10 text-emerald-400" />
                </div>
                <div className="text-center">
                  <p className="text-white text-lg font-semibold">
                    {targetUser?.full_name || 'مخاطب'} تماس می‌گیرد
                  </p>
                  <p className="text-gray-400 text-sm mt-1">تماس ایمن E2EE</p>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => { hangup(); }}
                    className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center"
                  >
                    <PhoneOff className="w-6 h-6 text-white" />
                  </button>
                </div>
              </div>
            ) : phase === 'waiting' ? (
              <div className="flex flex-col items-center justify-center h-full gap-5 bg-gray-900 rounded-2xl">
                <Loader className="w-10 h-10 text-emerald-400 animate-spin" />
                <p className="text-white text-base">در انتظار اتصال...</p>
                {sessionCode && (
                  <div className="flex items-center gap-2 bg-gray-800 px-4 py-2 rounded-xl">
                    <span className="text-gray-300 text-sm font-mono tracking-widest">{sessionCode}</span>
                    <button onClick={copyCode} className="text-gray-400 hover:text-white transition-colors">
                      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                )}
                <p className="text-gray-500 text-xs">این کد را به مخاطب بدهید</p>
                <button
                  onClick={() => { hangup(); }}
                  className="mt-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm transition-colors"
                >
                  لغو
                </button>
              </div>
            ) : (
              renderCallUI()
            )}
          </div>
        )}

        {/* Ended / failed */}
        {(phase === 'ended' || phase === 'failed') && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              <PhoneOff className="w-8 h-8 text-gray-400" />
            </div>
            <p className="text-gray-600 dark:text-gray-400 text-sm">
              {phase === 'failed' ? 'اتصال ناموفق بود' : 'تماس پایان یافت'}
            </p>
            <button
              onClick={() => setPhase('idle')}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> تماس جدید
            </button>
          </div>
        )}

        {/* Idle — invite UI */}
        {phase === 'idle' && (
          <div className="max-w-xl mx-auto space-y-6">
            {/* E2EE info banner */}
            <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
              <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">رمزنگاری سرتاسری (E2EE)</p>
                <p className="text-xs text-emerald-700 dark:text-emerald-400 mt-0.5 leading-relaxed">
                  هر فریم صوتی و تصویری با AES-GCM-256 رمز می‌شود. کلید از ECDH P-256 مشترک و HKDF-SHA-256 مشتق می‌شود.
                  هیچ داده‌ای به سرور منتقل نمی‌شود — رمزگشایی فقط در مرورگر مخاطب انجام می‌شود.
                </p>
              </div>
            </div>

            {/* Search and call */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
                <Users className="w-4 h-4" /> تماس با کاربر
              </h3>
              <div className="relative">
                <input
                  type="text"
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="جستجوی نام یا ایمیل..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                {searching && (
                  <Loader className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-gray-400" />
                )}
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
                        <div className="text-right min-w-0">
                          <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email || ''}</p>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Join by code */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">پیوستن با کد جلسه</h3>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={joinCode}
                  onChange={e => setJoinCode(e.target.value.toUpperCase())}
                  placeholder="کد ۱۲ رقمی..."
                  maxLength={12}
                  className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono tracking-widest"
                />
                <button
                  onClick={joinByCode}
                  disabled={!joinCode.trim()}
                  className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-sm font-medium transition-colors"
                >
                  پیوستن
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
