import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { getSharedRTCConfig, invalidateRTCConfigCache } from '../../../lib/rtcConfig';
import { startDiagnostics, stopDiagnostics } from '../../../lib/webrtcDiagnostics';
import type { PeerDiagnostics } from '../../../lib/webrtcDiagnostics';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { getPendingE2EERing, setPendingE2EERing } from '../../../lib/globalE2EERing';

import {
  INVITE_TTL_MS, ICE_QUEUE_MAX, SUPPORTS_TRANSFORMS, E2EE_DEBUG,
  log, logWarn, logError,
} from './types';
import type {
  CallPhase, E2EEStatus, FailReason, UserProfile, DerivedKeys, IncomingCall,
} from './types';
import {
  generateECDHKeyPair, exportPublicKey, importPublicKey,
  deriveSessionKeys, computeSafetyNumber, bytesToHex, hexToBytes, randomHex,
} from './crypto';
import type { PortRecord } from './transforms';
import {
  ensureWorkerReady, attachSenderTransform, attachReceiverTransform, pushKeyToPortRecord,
} from './transforms';
import {
  validateIceCandidate, validateSDP, validateSignalPayload, waitForSubscribed,
} from './signaling';

export interface UseE2EECallReturn {
  // State
  phase: CallPhase;
  e2eeStatus: E2EEStatus;
  isMuted: boolean;
  isVideoOff: boolean;
  isRemoteMuted: boolean;
  isScreenSharing: boolean;
  isSwitchingCamera: boolean;
  isStartingScreenShare: boolean;
  targetUser: UserProfile | null;
  incomingCall: IncomingCall | null;
  safetyNums: string[] | null;
  showSafety: boolean;
  sessionCode: string;
  failReason: FailReason;
  userSearch: string;
  users: UserProfile[];
  searching: boolean;
  connDiag: PeerDiagnostics | null;
  isOffline: boolean;
  videoDevices: MediaDeviceInfo[];
  // Refs
  localVideoRef: React.RefObject<HTMLVideoElement>;
  remoteVideoRef: React.RefObject<HTMLVideoElement>;
  safetyVerifiedRef: React.RefObject<boolean>;
  // Stream refs — for event-driven consumer code (read-only)
  localStreamRef: React.RefObject<MediaStream | null>;
  remoteStreamRef: React.RefObject<MediaStream | null>;
  // Actions
  startCall: (target: UserProfile) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  doHangup: (sendSignal?: boolean) => void;
  toggleMute: () => void;
  toggleVideo: () => void;
  toggleScreenShare: () => Promise<void>;
  switchCamera: () => Promise<void>;
  verifySafety: () => void;
  // Setters exposed to views
  setUserSearch: React.Dispatch<React.SetStateAction<string>>;
  setShowSafety: React.Dispatch<React.SetStateAction<boolean>>;
  setIsRemoteMuted: React.Dispatch<React.SetStateAction<boolean>>;
  setPhase: React.Dispatch<React.SetStateAction<CallPhase>>;
  setFailReason: React.Dispatch<React.SetStateAction<FailReason>>;
}

export function useE2EECall(
  currentUserId: string,
  currentUserName: string,
): UseE2EECallReturn {
  // ── State ──────────────────────────────────────────────────────────────
  const [phase,               setPhase]               = useState<CallPhase>('idle');
  const [e2eeStatus,          setE2eeStatus]          = useState<E2EEStatus>(SUPPORTS_TRANSFORMS ? 'pending' : 'unsupported');
  const [isMuted,             setIsMuted]             = useState(false);
  const [isVideoOff,          setIsVideoOff]          = useState(false);
  const [isRemoteMuted,       setIsRemoteMuted]       = useState(false);
  const [isScreenSharing,     setIsScreenSharing]     = useState(false);
  const [isSwitchingCamera,   setIsSwitchingCamera]   = useState(false);
  const [isStartingScreenShare, setIsStartingScreenShare] = useState(false);
  const [remoteStreamTick,    setRemoteStreamTick]    = useState(0);
  const [targetUser,          setTargetUser]          = useState<UserProfile | null>(null);
  const [incomingCall,        setIncomingCall]        = useState<IncomingCall | null>(null);
  const [safetyNums,          setSafetyNums]          = useState<string[] | null>(null);
  const [showSafety,          setShowSafety]          = useState(false);
  const [sessionCode,         setSessionCode]         = useState('');
  const [failReason,          setFailReason]          = useState<FailReason>(null);
  const [userSearch,          setUserSearch]          = useState('');
  const [users,               setUsers]               = useState<UserProfile[]>([]);
  const [searching,           setSearching]           = useState(false);
  const [connDiag,            setConnDiag]            = useState<PeerDiagnostics | null>(null);
  const [isOffline,           setIsOffline]           = useState(!navigator.onLine);
  const [videoDevices,        setVideoDevices]        = useState<MediaDeviceInfo[]>([]);

  // ── Refs ───────────────────────────────────────────────────────────────
  const localVideoRef      = useRef<HTMLVideoElement>(null);
  const remoteVideoRef     = useRef<HTMLVideoElement>(null);
  const localStreamRef     = useRef<MediaStream | null>(null);
  const pcRef              = useRef<RTCPeerConnection | null>(null);
  const workerRef          = useRef<Worker | null>(null);
  const inboxChannelRef    = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const sessionChannelRef  = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const ecdhKeyPairRef     = useRef<CryptoKeyPair | null>(null);
  const myPeerIdRef        = useRef(uuidv4());
  const sessionIdRef       = useRef('');
  const lockedPeerRef      = useRef<string | null>(null);
  const iceCandidateQueue  = useRef<RTCIceCandidateInit[]>([]);
  const portRecordsRef     = useRef<PortRecord[]>([]);
  const activeKeysRef      = useRef<DerivedKeys | null>(null);
  const myRoleRef          = useRef<'caller' | 'callee'>('caller');
  const myPublicJWKRef     = useRef('');
  const saltRef            = useRef<Uint8Array | null>(null);
  const sessionActiveRef   = useRef(false);
  const acceptTokenRef     = useRef<string>('');
  const safetyVerifiedRef  = useRef(false);
  const phaseRef           = useRef<CallPhase>('idle');
  const remoteStreamRef    = useRef<MediaStream | null>(null);
  const offerSentRef       = useRef(false);
  const cleaningUpRef      = useRef(false);
  const screenStreamRef    = useRef<MediaStream | null>(null);
  const isScreenSharingRef = useRef(false);
  const lastKeyFingerprintRef = useRef<string>('');
  const autoAcceptRef      = useRef(false);
  // Stored camera track so screen-share can restore it without re-acquiring
  const cameraTrackRef     = useRef<MediaStreamTrack | null>(null);
  // Current facing mode for mobile camera switching
  const currentFacingModeRef = useRef<'user' | 'environment'>('user');
  // Lock refs to prevent concurrent async media operations
  const isSwitchingCameraRef    = useRef(false);
  const isScreenShareOpRef      = useRef(false);

  // ── Keep phaseRef in sync ──────────────────────────────────────────────
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── Local video mount ──────────────────────────────────────────────────
  useEffect(() => {
    if ((phase === 'connecting' || phase === 'connected') && localVideoRef.current) {
      const stream = localStreamRef.current;
      if (stream && localVideoRef.current.srcObject !== stream) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.play().catch(() => {});
        log('[E2EE][MEDIA]', 'localVideoRef.srcObject attached on phase mount');
      }
    }
  }, [phase]);

  // ── Remote video mount / tick ──────────────────────────────────────────
  useEffect(() => {
    if ((phase === 'connecting' || phase === 'connected') && remoteVideoRef.current) {
      const stream = remoteStreamRef.current;
      if (stream && remoteVideoRef.current.srcObject !== stream) {
        remoteVideoRef.current.srcObject = stream;
        remoteVideoRef.current.play().catch(() => {});
        log('[E2EE][MEDIA]', 'remoteVideoRef.srcObject re-attached on phase/tick mount');
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, remoteStreamTick]);

  // ── Remote video diagnostics ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'connected') return;
    const check = setInterval(() => {
      const v = remoteVideoRef.current;
      if (!v) return;
      log('[E2EE][UI]', `remote video — readyState=${v.readyState} ${v.videoWidth}×${v.videoHeight} paused=${v.paused} srcObject=${!!v.srcObject}`);
      if (v.videoWidth > 0) clearInterval(check);
    }, 1000);
    return () => clearInterval(check);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Connection timeout ─────────────────────────────────────────────────
  const connTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (phase === 'connecting') {
      connTimeoutRef.current = setTimeout(() => {
        if (phaseRef.current === 'connecting') {
          logError('[E2EE][ERROR]', 'connection timed out after 30s');
          toast.error('اتصال برقرار نشد — لطفاً شرایط شبکه را بررسی کنید');
          doFullCleanup('ice_failed');
        }
      }, 30_000);
    } else {
      if (connTimeoutRef.current) {
        clearTimeout(connTimeoutRef.current);
        connTimeoutRef.current = null;
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Network online/offline ─────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      log('[E2EE][NET]', 'network back online');
      const pc = pcRef.current;
      if (pc && myRoleRef.current === 'caller' && (phaseRef.current === 'connected' || phaseRef.current === 'connecting')) {
        log('[E2EE][NET]', 'triggering ICE restart after reconnect');
        if (pc.signalingState === 'stable') {
          pc.createOffer({ iceRestart: true })
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
              sessionChannelRef.current?.send({
                type: 'broadcast', event: 'e2ee-signal',
                payload: { type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: saltRef.current ? bytesToHex(saltRef.current) : '' } },
              });
            })
            .catch(err => logError('[E2EE][NET]', 'network-triggered ICE restart failed:', err));
        }
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
      log('[E2EE][NET]', 'network offline');
      if (phaseRef.current === 'connected' || phaseRef.current === 'connecting') {
        toast('اتصال اینترنت قطع شد — در حال انتظار...', { icon: '⚠️' });
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── User search ────────────────────────────────────────────────────────
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

  // ── Worker init ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS) return;
    log('[E2EE][CALL]', 'creating e2ee-worker');
    try {
      const w = new Worker('/e2ee-worker.js');
      w.addEventListener('error', e => {
        logError('[E2EE][ERROR]', 'worker error:', e.message);
        workerRef.current = null;
        setE2eeStatus('error');
        toast.error('خطای Worker رمزنگاری — تماس قطع شد');
        doFullCleanup('ice_failed');
      });
      w.addEventListener('message', e => {
        const { type, level, tag, msg } = e.data || {};
        if (type === 'log' && (level === 'error' || E2EE_DEBUG)) {
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

  // ── Inbox channel ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS || !currentUserId) return;
    const ch = supabase.channel(`e2ee-inbox-${currentUserId}`, {
      config: { broadcast: { self: false } },
    });
    inboxChannelRef.current = ch;

    ch.on('broadcast', { event: 'e2ee-ring' }, ({ payload }) => {
      if (!payload || typeof payload !== 'object') return;
      const p = payload as Record<string, unknown>;

      if (p.targetUserId !== currentUserId) return;
      if (typeof p.from !== 'string'        || p.from.length > 200)       return;
      if (typeof p.sessionId !== 'string'   || p.sessionId.length > 100)  return;
      if (typeof p.callerName !== 'string'  || p.callerName.length > 200) return;
      if (typeof p.callerId !== 'string'    || p.callerId.length > 200)   return;
      if (typeof p.acceptToken !== 'string' || p.acceptToken.length !== 32) return;
      if (typeof p.expiresAt !== 'number') return;
      if (Date.now() > (p.expiresAt as number)) return;

      log('[E2EE][SIGNAL]', `incoming ring from=${p.from} sessionId=${p.sessionId}`);

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

  // ── Consume pending E2EE ring from GlobalCallContext ───────────────────────
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS) return;
    const ring = getPendingE2EERing();
    if (!ring || Date.now() > ring.expiresAt || sessionActiveRef.current) return;
    setPendingE2EERing(null);
    autoAcceptRef.current = !!ring.autoAccept;
    setIncomingCall({
      from:        ring.from,
      sessionId:   ring.sessionId,
      callerName:  ring.callerName,
      callerId:    ring.callerId,
      expiresAt:   ring.expiresAt,
      acceptToken: ring.acceptToken,
    });
    setPhase('incoming_ring');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Enumerate video devices ─────────────────────────────────────────────
  useEffect(() => {
    const enumerate = async () => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        setVideoDevices(devices.filter(d => d.kind === 'videoinput'));
      } catch { /* permissions not yet granted */ }
    };
    enumerate();
    navigator.mediaDevices.addEventListener('devicechange', enumerate);
    return () => navigator.mediaDevices.removeEventListener('devicechange', enumerate);
  }, []);

  // ── Cleanup ────────────────────────────────────────────────────────────

  const doFullCleanup = useCallback((reason?: FailReason) => {
    if (cleaningUpRef.current) return;
    cleaningUpRef.current = true;
    log('[E2EE][CALL]', `cleanup reason=${reason ?? 'none'}`);
    sessionActiveRef.current = false;
    offerSentRef.current = false;
    isSwitchingCameraRef.current = false;
    isScreenShareOpRef.current = false;

    workerRef.current?.postMessage({ type: 'clear' });

    if (sessionIdRef.current) stopDiagnostics(sessionIdRef.current);
    setConnDiag(null);

    pcRef.current?.close();
    pcRef.current = null;

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    cameraTrackRef.current = null;
    currentFacingModeRef.current = 'user';

    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    isScreenSharingRef.current = false;

    remoteStreamRef.current = null;
    if (localVideoRef.current)  localVideoRef.current.srcObject  = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;

    portRecordsRef.current.forEach(pr => { try { pr.port.close(); } catch { /* already closed */ } });
    portRecordsRef.current = [];
    transformWaitersRef.current = [];

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
    lastKeyFingerprintRef.current = '';

    setSafetyNums(null);
    setShowSafety(false);
    safetyVerifiedRef.current = false;
    setE2eeStatus(SUPPORTS_TRANSFORMS ? 'pending' : 'unsupported');
    setTargetUser(null);
    setIncomingCall(null);
    setSessionCode('');
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setIsSwitchingCamera(false);
    setIsStartingScreenShare(false);

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
    }
    doFullCleanup();
    setPhase('ended');
  }, [doFullCleanup]);

  // ── Media helpers ──────────────────────────────────────────────────────

  const startLocalStream = async (): Promise<MediaStream | null> => {
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          ...(isMobile && { sampleRate: 16000 }),
        },
        video: isMobile ? {
          facingMode: 'user',
          width:  { ideal: 360, max: 480 },
          height: { ideal: 640, max: 720 },
          frameRate: { ideal: 20, max: 30 },
        } : {
          facingMode: 'user',
          width:  { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 720 },
          frameRate: { ideal: 30, max: 30 },
        },
      });

      if (s.getAudioTracks().length === 0) {
        toast.error('دسترسی به میکروفون ممکن نیست');
        s.getTracks().forEach(t => t.stop());
        return null;
      }
      if (s.getVideoTracks().length === 0) {
        toast.error('دسترسی به دوربین ممکن نیست');
        s.getTracks().forEach(t => t.stop());
        return null;
      }

      localStreamRef.current = s;
      // Store camera track and read actual facing mode from track settings
      const firstVideoTrack = s.getVideoTracks()[0] ?? null;
      cameraTrackRef.current = firstVideoTrack;
      const actualFacing = firstVideoTrack?.getSettings().facingMode;
      currentFacingModeRef.current =
        actualFacing === 'environment' ? 'environment' : 'user';

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = s;
        localVideoRef.current.play().catch(() => {});
      }

      if (E2EE_DEBUG) {
        console.info('[E2EE][MEDIA] local stream tracks', s.getTracks().map(t => ({
          kind: t.kind, enabled: t.enabled, muted: t.muted,
          readyState: t.readyState, label: t.label,
        })));
      }

      return s;
    } catch (e) {
      logError('[E2EE][ERROR]', 'getUserMedia failed:', e);
      toast.error('دسترسی به دوربین یا میکروفون داده نشد');
      return null;
    }
  };

  const flushICEQueue = async (pc: RTCPeerConnection) => {
    const queued = iceCandidateQueue.current.splice(0);
    for (const c of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(e =>
        logWarn('[E2EE][ICE]', 'addIceCandidate (queued) failed:', e)
      );
    }
  };

  // ── Required-transform barrier ─────────────────────────────────────────
  // Resolves only when all 4 transforms (sender/audio, sender/video,
  // receiver/audio, receiver/video) exist AND each has reached 'key-ready'.
  // Called from doSetupKeys — which now waits for the barrier before marking
  // the call active_unverified.
  const transformWaitersRef = useRef<Array<() => void>>([]);

  // Called every time a new PortRecord is pushed to portRecordsRef so waiters
  // can re-check whether the required set is complete.
  const notifyTransformWaiters = () => {
    const waiters = transformWaitersRef.current.splice(0);
    for (const w of waiters) w();
  };

  const requiredRoles: Array<{ role: 'sender' | 'receiver'; kind: 'audio' | 'video' }> = [
    { role: 'sender',   kind: 'audio' },
    { role: 'sender',   kind: 'video' },
    { role: 'receiver', kind: 'audio' },
    { role: 'receiver', kind: 'video' },
  ];

  const allRequiredKeyReady = (): boolean => {
    const records = portRecordsRef.current;
    return requiredRoles.every(req =>
      records.some(pr => pr.role === req.role && pr.kind === req.kind && pr.state === 'key-ready')
    );
  };

  const awaitRequiredTransforms = (timeoutMs = 15_000): Promise<void> => {
    return new Promise((resolve, reject) => {
      if (allRequiredKeyReady()) { resolve(); return; }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        const states = portRecordsRef.current.map(
          pr => `${pr.role}/${pr.kind}=${pr.state}`
        ).join(', ');
        logError('[E2EE][BARRIER]', `timeout waiting for all transforms. Records: [${states}]`);
        reject(new Error(`transform barrier timeout — not all transforms key-ready. [${states}]`));
      }, timeoutMs);

      const check = () => {
        if (settled) return;
        if (allRequiredKeyReady()) {
          settled = true;
          clearTimeout(timer);
          log('[E2EE][BARRIER]', 'all 4 required transforms are key-ready');
          resolve();
        } else {
          transformWaitersRef.current.push(check);
        }
      };
      transformWaitersRef.current.push(check);
    });
  };


  // Throws if any port fails to install its key — caller must handle the error.
  const pushKeysToAllPorts = useCallback(async (keys: DerivedKeys) => {
    const records = [...portRecordsRef.current];
    const results = await Promise.allSettled(
      records.map(async pr => {
        await pushKeyToPortRecord(pr, keys);
        // Each successful key push may satisfy the barrier — wake waiters
        notifyTransformWaiters();
      })
    );
    if (E2EE_DEBUG) {
      console.info('[E2EE][KEY] pushed keys to ports', {
        count: records.length,
        results: results.map(r => r.status),
      });
    }
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      const reasons = failed.map(f => String(f.reason)).join('; ');
      throw new Error(`key push failed for ${failed.length}/${records.length} port(s): ${reasons}`);
    }
  }, []);

  const doSetupKeys = async (peerPublicJWK: string, salt: Uint8Array) => {
    if (!ecdhKeyPairRef.current) return;
    const fingerprint = `${peerPublicJWK}|${bytesToHex(salt)}`;
    if (fingerprint === lastKeyFingerprintRef.current) {
      log('[E2EE][KEY]', 'doSetupKeys: same inputs — skipping re-derivation');
      return;
    }
    lastKeyFingerprintRef.current = fingerprint;
    try {
      const peerPub = await importPublicKey(peerPublicJWK);
      const keys = await deriveSessionKeys(
        ecdhKeyPairRef.current.privateKey, peerPub,
        sessionIdRef.current, myRoleRef.current, salt,
      );
      activeKeysRef.current = keys;

      // Push to all ports that exist right now (sender ports, plus any early
      // receiver ports from ontrack if it fired before doSetupKeys).
      await pushKeysToAllPorts(keys);

      // Block here until all 4 required transforms (sender/audio, sender/video,
      // receiver/audio, receiver/video) have confirmed their keys. This is the
      // required-transform barrier: if ontrack fires after this point, those
      // receiver ports will push keys themselves and call notifyTransformWaiters.
      await awaitRequiredTransforms(15_000);

      const nums = await computeSafetyNumber(myPublicJWKRef.current, peerPublicJWK, sessionIdRef.current);
      setSafetyNums(nums);
      setE2eeStatus('active_unverified');
    } catch (e) {
      logError('[E2EE][ERROR]', 'key setup failed:', e);
      toast.error('خطا در رمزنگاری — تماس لغو شد');
      doFullCleanup('key_exchange');
    }
  };

  // ── One-way media diagnostics ──────────────────────────────────────────
  const diagnoseOneWayMedia = async (pc: RTCPeerConnection) => {
    if (!E2EE_DEBUG) return;
    try {
      const stats = await pc.getStats();
      const senderStats: string[] = [];
      const receiverStats: string[] = [];
      stats.forEach(s => {
        if (s.type === 'outbound-rtp') {
          senderStats.push(`kind=${s.kind} bytesSent=${s.bytesSent} packetsSent=${s.packetsSent}`);
        } else if (s.type === 'inbound-rtp') {
          receiverStats.push(`kind=${s.kind} bytesReceived=${s.bytesReceived} packetsReceived=${s.packetsReceived}`);
        }
      });

      const records = portRecordsRef.current;
      const portStates = records.map(pr => `${pr.role}/${pr.kind}=${pr.state}`).join(', ');

      const hasSenderAudio   = records.some(pr => pr.role === 'sender'   && pr.kind === 'audio');
      const hasSenderVideo   = records.some(pr => pr.role === 'sender'   && pr.kind === 'video');
      const hasReceiverAudio = records.some(pr => pr.role === 'receiver' && pr.kind === 'audio');
      const hasReceiverVideo = records.some(pr => pr.role === 'receiver' && pr.kind === 'video');

      const allSendReady = records.filter(pr => pr.role === 'sender').every(pr => pr.state === 'key-ready');
      const allRecvReady = records.filter(pr => pr.role === 'receiver').every(pr => pr.state === 'key-ready');

      let diagnosis = '';
      if (!hasReceiverAudio || !hasReceiverVideo) {
        diagnosis = 'A — receiver transforms missing (ontrack has not fired for all tracks)';
      } else if (!allRecvReady && allSendReady) {
        diagnosis = 'B — receiver transforms exist but keys not installed (barrier race)';
      } else if (!allSendReady && allRecvReady) {
        diagnosis = 'C — sender key not installed (local encryption broken)';
      } else if (!hasSenderAudio || !hasSenderVideo) {
        diagnosis = 'D — sender transforms missing (attachSenderTransform skipped a track)';
      } else if (allSendReady && allRecvReady) {
        diagnosis = 'E — all transforms key-ready; issue may be ICE/network or SDP direction';
      } else {
        diagnosis = 'F — mixed state; check portStates';
      }

      console.group('[E2EE][DIAG] one-way media diagnosis');
      console.log('diagnosis:', diagnosis);
      console.log('portStates:', portStates);
      console.log('senderStats:', senderStats);
      console.log('receiverStats:', receiverStats);
      console.log('hasSender:', { audio: hasSenderAudio, video: hasSenderVideo });
      console.log('hasReceiver:', { audio: hasReceiverAudio, video: hasReceiverVideo });
      console.groupEnd();
    } catch (err) {
      logError('[E2EE][DIAG]', 'diagnoseOneWayMedia failed:', err);
    }
  };

  // ── SDP direction logging (E2EE_DEBUG only) ────────────────────────────
  const logSDPDirections = (sdp: string | undefined, label: string) => {
    if (!E2EE_DEBUG || !sdp) return;
    const lines = sdp.split('\n');
    let mediaSection = '';
    const sections: string[] = [];
    for (const line of lines) {
      if (line.startsWith('m=')) {
        mediaSection = line.trim();
      } else if (mediaSection && /^a=(sendrecv|sendonly|recvonly|inactive)/.test(line)) {
        const dir = line.trim().replace('a=', '');
        sections.push(`${mediaSection.split(' ')[0].replace('m=', '')}:${dir}`);
        mediaSection = '';
      }
    }
    log('[E2EE][SDP]', `${label} directions: [${sections.join(', ')}]`);
  };

  // ── Handle remote track ────────────────────────────────────────────────
  // Registered synchronously as pc.ontrack so the PortRecord is pushed before
  // any awaits. Notifies the required-transform barrier after key push so
  // awaitRequiredTransforms() can unblock.
  const handleRemoteTrack = async (e: RTCTrackEvent) => {
    log('[E2EE][PC]', `ontrack kind=${e.track.kind} id=${e.track.id}`);

    if (workerRef.current) {
      const pr = attachReceiverTransform(e.receiver, workerRef.current, E2EE_DEBUG);
      if (pr) {
        // Register synchronously — before any awaits — so pushKeysToAllPorts
        // called from doSetupKeys will find this record.
        portRecordsRef.current.push(pr);
        notifyTransformWaiters();

        if (activeKeysRef.current) {
          // Keys already derived — install them now (keys arrived before ontrack)
          try {
            await pushKeyToPortRecord(pr, activeKeysRef.current);
            // Notify barrier again after key is installed
            notifyTransformWaiters();
          } catch (err) {
            logError('[E2EE][ERROR]', `key push failed for receiver transform (${pr.kind}):`, err);
            toast.error('رمزنگاری دریافت فعال نشد — تماس لغو شد');
            doFullCleanup('key_exchange');
            return;
          }
        }
        // If activeKeysRef.current is null: keys haven't been derived yet.
        // doSetupKeys will call pushKeysToAllPorts which includes this pr,
        // then after pushKey completes it will call notifyTransformWaiters.
      }
    }

    let remoteStream: MediaStream;
    if (e.streams && e.streams[0]) {
      remoteStream = e.streams[0];
      remoteStreamRef.current = remoteStream;
    } else {
      if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
      remoteStream = remoteStreamRef.current;
      if (!remoteStream.getTracks().some(t => t.id === e.track.id)) {
        remoteStream.addTrack(e.track);
      }
    }

    const remoteEl = remoteVideoRef.current;
    if (remoteEl) {
      if (remoteEl.srcObject !== remoteStream) {
        remoteEl.srcObject = remoteStream;
        log('[E2EE][MEDIA]', `srcObject set trackCount=${remoteStream.getTracks().length}`);
      }
      const tryPlay = () => {
        remoteEl.play().catch(err => {
          if ((err as DOMException).name === 'NotAllowedError') {
            const resume = () => {
              remoteEl.play().catch(() => {});
              document.removeEventListener('click', resume);
              document.removeEventListener('touchstart', resume);
            };
            document.addEventListener('click', resume, { once: true });
            document.addEventListener('touchstart', resume, { once: true });
          } else {
            log('[E2EE][MEDIA]', `remote play() error: ${err}`);
          }
        });
      };
      tryPlay();
      const diagStream = remoteStream;
      setTimeout(() => {
        const v = remoteVideoRef.current;
        if (!v) return;
        log('[E2EE][MEDIA]', `diag: readyState=${v.readyState} ${v.videoWidth}×${v.videoHeight} paused=${v.paused}`);
        if (v.videoWidth === 0 && diagStream.getVideoTracks().length > 0) tryPlay();
      }, 2000);
    } else {
      logWarn('[E2EE][MEDIA]', 'remoteVideoRef not mounted — triggering tick');
      setRemoteStreamTick(v => v + 1);
    }
  };

  // ── PeerConnection ─────────────────────────────────────────────────────

  const buildPC = async (): Promise<RTCPeerConnection | null> => {
    const cfg = await getSharedRTCConfig();
    log('[E2EE][PC]', `new RTCPeerConnection iceServers=${(cfg.iceServers as RTCIceServer[])?.length ?? 0}`);
    const pc = new RTCPeerConnection(cfg);
    pcRef.current = pc;

    const stream = localStreamRef.current;
    if (stream) {
      for (const t of stream.getTracks()) {
        pc.addTrack(t, stream);
      }
    }

    if (E2EE_DEBUG) {
      console.info('[E2EE][PC] senders after addTrack', pc.getSenders().map(s => ({
        hasTrack: !!s.track,
        kind: s.track?.kind,
        readyState: s.track?.readyState,
      })));
    }

    if (workerRef.current) {
      for (const sender of pc.getSenders()) {
        if (!sender.track) continue;
        const pr = attachSenderTransform(sender, workerRef.current, E2EE_DEBUG);
        if (pr) {
          portRecordsRef.current.push(pr);
          if (activeKeysRef.current) {
            try {
              await pushKeyToPortRecord(pr, activeKeysRef.current);
            } catch (e) {
              logError('[E2EE][ERROR]', 'pushKey failed for sender — aborting:', e);
              setE2eeStatus('error');
              toast.error('رمزنگاری فعال نشد — تماس لغو شد');
              doFullCleanup('key_exchange');
              return null;
            }
          }
        } else {
          // Transform failed to attach — abort to avoid sending cleartext
          setE2eeStatus('error');
          toast.error('رمزنگاری فعال نشد — تماس لغو شد');
          doFullCleanup('key_exchange');
          return null;
        }
      }
    }

    pc.ontrack = (e) => { void handleRemoteTrack(e); };

    pc.onicecandidate = e => {
      if (!e.candidate || !sessionChannelRef.current) return;
      sessionChannelRef.current.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: { type: 'ice', from: myPeerIdRef.current, session: sessionIdRef.current, data: { candidate: e.candidate.toJSON() } },
      });
    };

    pc.onicecandidateerror = (e: Event) => {
      const ev = e as RTCPeerConnectionIceErrorEvent;
      const url = ev.url ?? '';
      if (!/^turns?:/i.test(url)) return;
      logError('[E2EE][ICE]', `TURN error code=${ev.errorCode} url=${url}`);
      if (ev.errorCode === 701) toast.error('احراز هویت سرور TURN شکست خورد');
      else if (ev.errorCode === 702) toast.error('سرور TURN در دسترس نیست');
    };

    pc.onicegatheringstatechange = () => {
      log('[E2EE][ICE]', `iceGatheringState=${pc.iceGatheringState}`);
    };

    let iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let iceRestartAttempts = 0;
    const MAX_ICE_RESTARTS = 3;

    const sendRestartOffer = () => {
      if (pc.signalingState !== 'stable') return;
      pc.createOffer({ iceRestart: true })
        .then(offer => pc.setLocalDescription(offer).then(() => offer))
        .then(() => {
          sessionChannelRef.current?.send({
            type: 'broadcast', event: 'e2ee-signal',
            payload: { type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: saltRef.current ? bytesToHex(saltRef.current) : '' } },
          });
        })
        .catch(err => { logError('[E2EE][ICE]', 'ICE restart failed:', err); doFullCleanup('peer_disconnected'); });
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      log('[E2EE][ICE]', `iceConnectionState=${s}`);

      if (s === 'connected' || s === 'completed') {
        if (iceDisconnectTimer) { clearTimeout(iceDisconnectTimer); iceDisconnectTimer = null; }
        iceRestartAttempts = 0;
      }

      if (s === 'disconnected') {
        if (iceDisconnectTimer) clearTimeout(iceDisconnectTimer);
        if (myRoleRef.current !== 'caller') return;
        if (iceRestartAttempts >= MAX_ICE_RESTARTS) { doFullCleanup('ice_failed'); return; }
        const delay = Math.min(5000 * Math.pow(2, iceRestartAttempts), 30_000);
        iceDisconnectTimer = setTimeout(() => {
          iceDisconnectTimer = null;
          if (pc.iceConnectionState !== 'disconnected') return;
          iceRestartAttempts++;
          sendRestartOffer();
        }, delay);
      }

      if (s === 'failed') {
        if (iceDisconnectTimer) { clearTimeout(iceDisconnectTimer); iceDisconnectTimer = null; }
        if (myRoleRef.current === 'caller' && iceRestartAttempts < MAX_ICE_RESTARTS) {
          iceRestartAttempts++;
          sendRestartOffer();
        } else {
          doFullCleanup('ice_failed');
        }
      }
    };

    pc.onsignalingstatechange = () => { log('[E2EE][PC]', `signalingState=${pc.signalingState}`); };
    pc.onnegotiationneeded   = () => { log('[E2EE][PC]', 'negotiationneeded'); };

    pc.onconnectionstatechange = () => {
      log('[E2EE][PC]', `connectionState=${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        setPhase('connected');
        startDiagnostics(pc, sessionIdRef.current, (diag) => {
          setConnDiag(diag);
          if (diag.rttMs !== null && diag.rttMs > 400) logWarn('[E2EE][QOS]', `high RTT: ${diag.rttMs}ms`);
        }, 5000);
        if (E2EE_DEBUG) {
          setTimeout(() => { void diagnoseOneWayMedia(pc); }, 4000);
        }
      } else if (pc.connectionState === 'failed') {
        stopDiagnostics(sessionIdRef.current);
        doFullCleanup('ice_failed');
      } else if (pc.connectionState === 'closed') {
        stopDiagnostics(sessionIdRef.current);
      }
    };

    return pc;
  };

  // ── Offer / Session channel ────────────────────────────────────────────

  const doSendOffer = async () => {
    const pc = pcRef.current;
    const ch = sessionChannelRef.current;
    if (!pc || !ch) return;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltRef.current = salt;
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    logSDPDirections(pc.localDescription?.sdp, 'caller:local-offer');
    ch.send({
      type: 'broadcast', event: 'e2ee-signal',
      payload: {
        type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current,
        data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: bytesToHex(salt) },
      },
    });
  };

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

      if (type === 'accepted' && myRoleRef.current === 'caller') {
        if (phaseRef.current !== 'outgoing_ring') return;
        if (offerSentRef.current) return;
        if ((data as Record<string, unknown>)?.acceptToken !== acceptTokenRef.current) return;
        if ((data as Record<string, unknown>)?.targetUserId !== currentUserId) return;
        lockedPeerRef.current = p.from;
        offerSentRef.current = true;
        setPhase('connecting');
        await doSendOffer();
      }

      else if (type === 'offer' && myRoleRef.current === 'callee') {
        if (!validateSDP(data?.sdp, 'offer')) return;
        if (typeof data?.publicKey !== 'string') return;
        if (typeof data?.salt !== 'string') return;
        const saltBytes = hexToBytes(data.salt as string);
        if (!saltBytes || saltBytes.length !== 16) return;
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'stable') return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          logSDPDirections((data.sdp as RTCSessionDescriptionInit)?.sdp, 'callee:remote-offer');
          await flushICEQueue(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          logSDPDirections(pc.localDescription?.sdp, 'callee:local-answer');
          await doSetupKeys(data.publicKey as string, saltBytes);
          ch.send({
            type: 'broadcast', event: 'e2ee-signal',
            payload: { type: 'answer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current } },
          });
        } catch (e) {
          logError('[E2EE][ERROR]', 'offer handling:', e);
          doFullCleanup('key_exchange');
        }
      }

      else if (type === 'answer' && myRoleRef.current === 'caller') {
        if (!validateSDP(data?.sdp, 'answer')) return;
        if (typeof data?.publicKey !== 'string') return;
        if (!saltRef.current) return;
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'have-local-offer') return;
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          logSDPDirections((data.sdp as RTCSessionDescriptionInit)?.sdp, 'caller:remote-answer');
          await flushICEQueue(pc);
          await doSetupKeys(data.publicKey as string, saltRef.current);
        } catch (e) {
          logError('[E2EE][ERROR]', 'answer handling:', e);
          doFullCleanup('key_exchange');
        }
      }

      else if (type === 'ice') {
        const candidate = data?.candidate;
        if (!validateIceCandidate(candidate)) return;
        const pc = pcRef.current;
        if (!pc) return;
        if (iceCandidateQueue.current.length >= ICE_QUEUE_MAX) return;
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => logWarn('[E2EE][ICE]', 'addIceCandidate failed:', e));
        } else {
          iceCandidateQueue.current.push(candidate);
        }
      }

      else if (type === 'hangup') {
        doHangup(false);
        toast('مخاطب تماس را قطع کرد');
      }

      else if (type === 'rejected') {
        doHangup(false);
        toast('مخاطب تماس را رد کرد');
      }
    });

    return ch;
  };

  // ── Call flow ──────────────────────────────────────────────────────────

  const startCall = useCallback(async (target: UserProfile) => {
    if (!SUPPORTS_TRANSFORMS || !workerRef.current) {
      toast.error('مرورگر از RTCRtpScriptTransform پشتیبانی نمی‌کند');
      setE2eeStatus('unsupported');
      return;
    }
    try {
      await ensureWorkerReady(workerRef.current);
      setTargetUser(target);
      myRoleRef.current = 'caller';
      offerSentRef.current = false;
      invalidateRTCConfigCache();

      const sessionId = uuidv4();
      sessionIdRef.current = sessionId;
      setSessionCode(sessionId.slice(0, 8).toUpperCase());
      acceptTokenRef.current = randomHex(16);

      ecdhKeyPairRef.current = await generateECDHKeyPair();
      myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);

      const stream = await startLocalStream();
      if (!stream) { doFullCleanup(); return; }

      const ch = openSessionChannel(sessionId);
      await waitForSubscribed(ch);

      const pc = await buildPC();
      if (!pc) return;

      sessionActiveRef.current = true;

      const calleeInbox = supabase.channel(`e2ee-inbox-${target.user_id}`, {
        config: { broadcast: { self: false } },
      });
      const calleeGlobalInbox = supabase.channel(`e2ee-global-inbox-${target.user_id}`, {
        config: { broadcast: { self: false } },
      });
      const ringPayload = {
        from: myPeerIdRef.current, sessionId, targetUserId: target.user_id,
        callerName: currentUserName, callerId: currentUserId,
        acceptToken: acceptTokenRef.current,
        expiresAt: Date.now() + INVITE_TTL_MS,
      };
      await waitForSubscribed(calleeInbox);
      calleeInbox.send({ type: 'broadcast', event: 'e2ee-ring', payload: ringPayload });
      await waitForSubscribed(calleeGlobalInbox);
      calleeGlobalInbox.send({ type: 'broadcast', event: 'e2ee-ring', payload: ringPayload });
      setTimeout(() => {
        supabase.removeChannel(calleeInbox);
        supabase.removeChannel(calleeGlobalInbox);
      }, 3000);

      setPhase('outgoing_ring');

      const capturedSessionId = sessionId;
      setTimeout(() => {
        if (sessionIdRef.current === capturedSessionId && phaseRef.current === 'outgoing_ring') {
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
    try {
      await ensureWorkerReady(workerRef.current);
      myRoleRef.current    = 'callee';
      sessionIdRef.current = ic.sessionId;
      lockedPeerRef.current = ic.from;
      offerSentRef.current = false;
      invalidateRTCConfigCache();

      ecdhKeyPairRef.current = await generateECDHKeyPair();
      myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);

      const stream = await startLocalStream();
      if (!stream) { doFullCleanup(); setIncomingCall(null); return; }

      const ch = openSessionChannel(ic.sessionId);
      await waitForSubscribed(ch);

      const pc = await buildPC();
      if (!pc) { setIncomingCall(null); return; }

      sessionActiveRef.current = true;

      ch.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: {
          type: 'accepted', from: myPeerIdRef.current, session: ic.sessionId,
          data: { acceptToken: ic.acceptToken, targetUserId: ic.callerId },
        },
      });

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

  // ── Auto-accept when arriving from global overlay ──────────────────────
  useEffect(() => {
    if (phase === 'incoming_ring' && incomingCall && autoAcceptRef.current) {
      autoAcceptRef.current = false;
      acceptCall();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, incomingCall, acceptCall]);

  const rejectCall = useCallback(() => {
    const ic = incomingCall;
    if (!ic) return;
    setIncomingCall(null);
    setPhase('idle');
    const ch = supabase.channel(`e2ee-sess-${ic.sessionId}`, { config: { broadcast: { self: false } } });
    waitForSubscribed(ch)
      .then(() => {
        ch.send({ type: 'broadcast', event: 'e2ee-signal', payload: { type: 'rejected', from: myPeerIdRef.current, session: ic.sessionId, data: {} } });
      })
      .catch(err => logWarn('[E2EE][SIGNAL]', 'reject channel subscribe failed:', err))
      .finally(() => setTimeout(() => supabase.removeChannel(ch), 1500));
  }, [incomingCall]);

  // ── Media controls ─────────────────────────────────────────────────────

  const toggleMute  = () => { localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = isMuted; }); setIsMuted(v => !v); };
  const toggleVideo = () => { localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = isVideoOff; }); setIsVideoOff(v => !v); };

  const stopScreenShare = useCallback(async () => {
    if (isScreenShareOpRef.current) return;
    isScreenShareOpRef.current = true;

    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
    const restoreTrack = cameraTrackRef.current;

    if (sender) {
      try {
        if (restoreTrack && restoreTrack.readyState === 'live') {
          await sender.replaceTrack(restoreTrack);
        } else {
          // Re-acquire camera if the original track ended
          const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
          const camStream = await navigator.mediaDevices.getUserMedia({
            video: isMobile
              ? { facingMode: currentFacingModeRef.current }
              : { facingMode: 'user' },
            audio: false,
          });
          const camTrack = camStream.getVideoTracks()[0];
          if (camTrack) {
            cameraTrackRef.current = camTrack;
            await sender.replaceTrack(camTrack);
            if (localStreamRef.current) {
              localStreamRef.current.getVideoTracks().forEach(t => { t.stop(); localStreamRef.current!.removeTrack(t); });
              localStreamRef.current.addTrack(camTrack);
            }
          }
        }
      } catch (err) {
        logError('[E2EE][MEDIA]', 'restore camera track failed:', err);
        toast.error('بازگشت به دوربین ناموفق بود');
      }
    }

    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
    }

    isScreenSharingRef.current = false;
    isScreenShareOpRef.current = false;
    setIsScreenSharing(false);
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenShareOpRef.current) return;
    if (isScreenSharingRef.current) { await stopScreenShare(); return; }

    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      toast.error('اشتراک‌گذاری صفحه در این دستگاه پشتیبانی نمی‌شود');
      return;
    }

    const pc = pcRef.current;
    const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) {
      toast.error('فرستنده ویدیو پیدا نشد');
      return;
    }

    isScreenShareOpRef.current = true;
    setIsStartingScreenShare(true);

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = displayStream;
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error('No screen video track');

      await sender.replaceTrack(screenTrack);

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = new MediaStream([screenTrack]);
      }

      screenTrack.addEventListener('ended', () => { void stopScreenShare(); }, { once: true });

      isScreenSharingRef.current = true;
      isScreenShareOpRef.current = false;
      setIsScreenSharing(true);
    } catch (err: unknown) {
      isScreenShareOpRef.current = false;
      // NotAllowedError from user cancel — do not show toast
      if (!(err instanceof Error) || err.name !== 'NotAllowedError') {
        toast.error('اشتراک‌گذاری صفحه شروع نشد');
      }
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    } finally {
      setIsStartingScreenShare(false);
    }
  }, [stopScreenShare]);

  const verifySafety = useCallback(() => {
    if (!myPublicJWKRef.current || !activeKeysRef.current) {
      logError('[E2EE][SAFETY]', 'verifySafety called before keys are established');
      return;
    }
    safetyVerifiedRef.current = true;
    setE2eeStatus('active_verified');
    setShowSafety(false);
  }, []);

  // ── Switch camera ──────────────────────────────────────────────────────
  const switchCamera = useCallback(async () => {
    // Prevent concurrent calls
    if (isSwitchingCameraRef.current) return;
    // Disable while screen sharing — semantics are ambiguous
    if (isScreenSharingRef.current) {
      toast('ابتدا اشتراک‌گذاری صفحه را متوقف کنید');
      return;
    }

    const currentStream = localStreamRef.current;
    if (!currentStream) return;

    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    // Refresh device list — permissions may have been granted since mount
    let devices = videoDevices;
    if (devices.length === 0) {
      try {
        const all = await navigator.mediaDevices.enumerateDevices();
        devices = all.filter(d => d.kind === 'videoinput');
        setVideoDevices(devices);
      } catch { /* ignore */ }
    }

    const currentTrack = currentStream.getVideoTracks()[0];
    let videoConstraints: MediaTrackConstraints;

    if (devices.length >= 2) {
      const currentDeviceId = currentTrack?.getSettings().deviceId;
      const currentIndex = devices.findIndex(d => d.deviceId === currentDeviceId);
      const nextDevice = devices[(currentIndex + 1) % devices.length];
      videoConstraints = { deviceId: { exact: nextDevice.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } };
    } else if (isMobile) {
      // Toggle facingMode on mobile — common on iOS where only one device is enumerated
      const nextFacing = currentFacingModeRef.current === 'user' ? 'environment' : 'user';
      videoConstraints = { facingMode: { exact: nextFacing }, width: { ideal: 640 }, height: { ideal: 480 } };
    } else {
      toast('دوربین دیگری در دسترس نیست');
      return;
    }

    isSwitchingCameraRef.current = true;
    setIsSwitchingCamera(true);

    let newStream: MediaStream | null = null;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) throw new Error('No video track from new camera');

      // Replace in peer connection BEFORE stopping old track
      const pc = pcRef.current;
      const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);

      // Only now stop and remove old track
      currentTrack?.stop();
      currentStream.getVideoTracks().forEach(t => { if (t !== newTrack) currentStream.removeTrack(t); });
      currentStream.addTrack(newTrack);

      // Update stored camera track reference
      // Sync facingMode from actual track settings, not from assumption
      cameraTrackRef.current = newTrack;
      const newFacing = newTrack.getSettings().facingMode;
      currentFacingModeRef.current =
        newFacing === 'environment' ? 'environment' : 'user';

      // Sync localVideoRef
      if (localVideoRef.current) localVideoRef.current.srcObject = currentStream;
    } catch (err) {
      logError('[E2EE][MEDIA]', 'switchCamera failed:', err);
      // Clean up new stream on failure — do NOT affect active call stream
      newStream?.getTracks().forEach(t => t.stop());

      const errName = (err instanceof Error) ? err.name : '';
      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') {
        toast.error('دوربین دیگری در دسترس نیست');
      } else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') {
        toast.error('دسترسی به دوربین یا میکروفون داده نشد');
      } else if (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError') {
        toast.error('دوربین دیگری در دسترس نیست');
      } else {
        toast.error('تغییر دوربین انجام نشد');
      }
    } finally {
      isSwitchingCameraRef.current = false;
      setIsSwitchingCamera(false);
    }
  }, [videoDevices]);

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => () => { doFullCleanup(); }, [doFullCleanup]);

  return {
    phase, e2eeStatus, isMuted, isVideoOff, isRemoteMuted, isScreenSharing,
    isSwitchingCamera, isStartingScreenShare,
    targetUser, incomingCall, safetyNums, showSafety, sessionCode, failReason,
    userSearch, users, searching, connDiag, isOffline, videoDevices,
    localVideoRef, remoteVideoRef, safetyVerifiedRef,
    localStreamRef, remoteStreamRef,
    startCall, acceptCall, rejectCall, doHangup,
    toggleMute, toggleVideo, toggleScreenShare, switchCamera, verifySafety,
    setUserSearch, setShowSafety, setIsRemoteMuted, setPhase, setFailReason,
  };
}
