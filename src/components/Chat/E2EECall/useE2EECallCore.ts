import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { useOrgUsers } from '../../../lib/useOrgUsers';
import { getAuthenticatedRTCConfig } from '../../../lib/authenticatedRtcConfig';
import { startDiagnostics, stopDiagnostics } from '../../../lib/webrtcDiagnostics';
import type { PeerDiagnostics } from '../../../lib/webrtcDiagnostics';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';
import { getPendingE2EERing, setPendingE2EERing, subscribeE2EERing } from '../../../lib/globalE2EERing';
import { SUPPORTS_TRANSFORMS, E2EE_DEBUG, log, logWarn, logError } from './types';
import type { CallPhase, E2EEStatus, FailReason, UserProfile, DerivedKeys, IncomingCall } from './types';
import { importPublicKey, deriveSessionKeys, computeSafetyNumber, bytesToHex } from './crypto';
import type { PortRecord } from './transforms';
import { attachSenderTransform, attachReceiverTransform, pushKeyToPortRecord } from './transforms';
import { subscribeChannelOrThrow, safeRemoveChannel } from './signaling';
import type { ChannelPurpose } from './signaling';
import { isCallDebugEnabled, dbgInfo, dbgWarn, dbgError, debugStoreSetSession } from './callDebugStore';
import type { MediaHealthClassification } from './callDebugStore';
import { useE2EERtpDiagnostics } from './useE2EERtpDiagnostics';
import { useE2EELifecycleHelpers } from './useE2EELifecycleHelpers';
import { useE2EESessionChannel } from './useE2EESessionChannel';
import { useE2EECallFlow } from './useE2EECallFlow';
import { useE2EEMediaControls } from './useE2EEMediaControls';

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
  mediaHealth: MediaHealthClassification[];
  // Refs
  localVideoRef: React.RefObject<HTMLVideoElement>;
  remoteVideoRef: React.RefObject<HTMLVideoElement>;
  safetyVerifiedRef: React.RefObject<boolean>;
  // Stream refs — for event-driven consumer code (read-only)
  localStreamRef: React.RefObject<MediaStream | null>;
  remoteStreamRef: React.RefObject<MediaStream | null>;
  // Debug
  portRecordsRef: React.RefObject<PortRecord[]>;
  pcRef: React.RefObject<RTCPeerConnection | null>;
  myRoleRef: React.RefObject<'caller' | 'callee'>;
  sessionIdRef: React.RefObject<string>;
  peerConnectionIdRef: React.RefObject<string>;
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
  runSelfTest: () => Promise<MediaHealthClassification[]>;
  // Callback for ActiveCallView to notify when remote video element remounts
  onRemoteElementMount: (el: HTMLVideoElement | null) => void;
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
  const [mediaHealth,         setMediaHealth]         = useState<MediaHealthClassification[]>([]);

  // ── Org-scoped user directory (replaces direct profiles query) ──────────
  const { allUsers: orgUsers, loading: orgUsersLoading } = useOrgUsers(currentUserId);

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
  const cameraTrackRef     = useRef<MediaStreamTrack | null>(null);
  const currentFacingModeRef = useRef<'user' | 'environment'>('user');
  const isSwitchingCameraRef    = useRef(false);
  const isScreenShareOpRef      = useRef(false);

  // ── Generation token — invalidates all stale async operations ─────────
  // Incremented on every new call start and on cleanup.
  // Any async operation captures its generation and checks before mutating state.
  const callGenerationRef = useRef(0);

  // ── Peer Connection identity ───────────────────────────────────────────
  // A unique id per RTCPeerConnection instance, included in debug events.
  const peerConnectionIdRef = useRef('');

  // ── Presented frame counter — updated by ActiveCallView via callback ───
  const presentedFrameCountRef = useRef<number>(0);

  // ── Required-transform barrier ─────────────────────────────────────────
  const transformWaitersRef = useRef<Array<() => void>>([]);

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
        dbgError('transform', 'transform-barrier-timeout', { states, timeoutMs });
        logError('[E2EE][BARRIER]', `timeout waiting for all transforms. Records: [${states}]`);
        reject(new Error(`transform barrier timeout. [${states}]`));
      }, timeoutMs);

      const check = () => {
        if (settled) return;
        if (allRequiredKeyReady()) {
          settled = true;
          clearTimeout(timer);
          dbgInfo('transform', 'transform-barrier-passed');
          log('[E2EE][BARRIER]', 'all 4 required transforms are key-ready');
          resolve();
        } else {
          transformWaitersRef.current.push(check);
        }
      };
      transformWaitersRef.current.push(check);
    });
  };

  const {
    collectRTPSnapshot, startRTPSnapshots, stopRTPSnapshots
  } = useE2EERtpDiagnostics({
    localStreamRef, pcRef, portRecordsRef, presentedFrameCountRef, remoteVideoRef, setMediaHealth
  });

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
    if (phase === 'connecting' || phase === 'connected') {
      bindRemoteStreamToElement('phase-mount');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, remoteStreamTick]);

  // ── Connection timeout ─────────────────────────────────────────────────
  const connTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (phase === 'connecting') {
      connTimeoutRef.current = setTimeout(() => {
        if (phaseRef.current === 'connecting') {
          logError('[E2EE][ERROR]', 'connection timed out after 30s');
          dbgError('lifecycle', 'connection-timeout');
          toast.error('اتصال برقرار نشد — لطفاً شرایط شبکه را بررسی کنید');
          doFullCleanup('ice_failed');
        }
      }, 30_000);
    } else {
      if (connTimeoutRef.current) { clearTimeout(connTimeoutRef.current); connTimeoutRef.current = null; }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Network online/offline ─────────────────────────────────────────────
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      dbgInfo('lifecycle', 'network-online');
      const pc = pcRef.current;
      if (pc && myRoleRef.current === 'caller' && (phaseRef.current === 'connected' || phaseRef.current === 'connecting')) {
        if (pc.signalingState === 'stable') {
          pc.createOffer({ iceRestart: true })
            .then(offer => pc.setLocalDescription(offer))
            .then(() => {
              sessionChannelRef.current?.send({
                type: 'broadcast', event: 'e2ee-signal',
                payload: { type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: saltRef.current ? bytesToHex(saltRef.current) : '' } },
              });
            })
            .catch(err => { dbgError('ice', 'ice-restart-on-reconnect-failed', { error: String(err) }); logError('[E2EE][NET]', 'network-triggered ICE restart failed:', err); });
        }
      }
    };
    const handleOffline = () => {
      setIsOffline(true);
      dbgWarn('lifecycle', 'network-offline');
      if (phaseRef.current === 'connected' || phaseRef.current === 'connecting') {
        toast('اتصال اینترنت قطع شد — در حال انتظار...', { icon: '⚠️' });
      }
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => { window.removeEventListener('online', handleOnline); window.removeEventListener('offline', handleOffline); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── User search (scoped to same organization via useOrgUsers) ──────────
  useEffect(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) { setUsers([]); return; }
    setSearching(true);
    try {
      const filtered = orgUsers
        .filter(u => u.user_id !== currentUserId)
        .filter(u => {
          if ((u.full_name || '').toLowerCase().includes(q)) return true;
          if ((u.position || '').toLowerCase().includes(q)) return true;
          if ((u.position_title || '').toLowerCase().includes(q)) return true;
          if ((u.unit_name || '').toLowerCase().includes(q)) return true;
          return u.assignments.some(a =>
            (a.positionTitle || '').toLowerCase().includes(q) ||
            (a.unitName || '').toLowerCase().includes(q)
          );
        })
        .slice(0, 20)
        .map(u => ({
          user_id: u.user_id,
          full_name: u.full_name,
          email: null as string | null,
          avatar_url: u.avatar_url,
        }));
      setUsers(filtered as unknown as UserProfile[]);
    } catch { toast.error('خطا در جستجو'); }
    finally { setSearching(false); }
  }, [userSearch, currentUserId, orgUsers]);

  // ── Worker init ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS) return;
    dbgInfo('worker', 'worker-creating');
    try {
      const w = new Worker('/e2ee-worker.js');
      w.addEventListener('error', e => {
        logError('[E2EE][ERROR]', 'worker error:', e.message);
        dbgError('worker', 'worker-error', { message: e.message });
        workerRef.current = null;
        setE2eeStatus('error');
        toast.error('خطای Worker رمزنگاری — تماس قطع شد');
        doFullCleanup('ice_failed');
      });
      w.addEventListener('message', e => {
        const { type, level, tag, msg } = e.data || {};
        if (type === 'log') {
          if (level === 'error') dbgError('worker', msg ?? tag, { tag, level });
          else if (level === 'warn') dbgWarn('worker', msg ?? tag, { tag, level });
          else if (isCallDebugEnabled()) dbgInfo('worker', msg ?? tag, { tag, level });
          if (level === 'error' || E2EE_DEBUG) {
            const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
            fn(`[worker]${tag}`, msg);
          }
        }
        if (type === 'counter-exhausted') {
          dbgError('worker', 'counter-exhausted');
          logError('[E2EE][WORKER]', 'counter exhausted — ending call');
          toast.error('رمزنگاری: شمارنده پر شد — تماس قطع می‌شود');
          doHangup(true);
        }
        if (type === 'encrypt-error' || type === 'decrypt-error') {
          dbgError('worker', type, { message: e.data.message });
          logError('[E2EE][WORKER]', `${type}:`, e.data.message);
        }
      });
      workerRef.current = w;
      dbgInfo('worker', 'worker-created');
    } catch (e) {
      logError('[E2EE][ERROR]', 'worker load failed:', e);
      dbgError('worker', 'worker-load-failed', { error: String(e) });
      setE2eeStatus('error');
    }
    return () => { workerRef.current?.terminate(); workerRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Inbox channel ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS || !currentUserId) return;
    const ch = supabase.channel(`e2ee-inbox-${currentUserId}`, { config: { broadcast: { self: false } } });
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

      dbgInfo('signaling', 'ring-received', { from: (p.from as string).slice(0, 8), sessionId: (p.sessionId as string).slice(0, 8) });

      if (sessionActiveRef.current) {
        // Busy-reject: subscribe safely before sending — only send on SUBSCRIBED
        const rejChId = uuidv4();
        const rejCh = supabase.channel(`e2ee-sess-${p.sessionId}`, { config: { broadcast: { self: false } } });
        const rejSessionId = p.sessionId as string;
        subscribeChannelOrThrow(rejCh, {
          attemptId:    rejChId,
          purpose:      'busy-reject-temp' as ChannelPurpose,
          generation:   callGenerationRef.current,
          sessionId:    rejSessionId,
          channelId:    rejChId,
          topicSummary: `e2ee-sess-${rejSessionId.slice(0, 8)}`,
          startedAt:    Date.now(),
        }).then(() => {
          rejCh.send({ type: 'broadcast', event: 'e2ee-signal', payload: { type: 'rejected', from: myPeerIdRef.current, session: rejSessionId, data: {} } });
          return safeRemoveChannel(rejCh, rejChId, 1500);
        }).catch(() => {
          void safeRemoveChannel(rejCh, rejChId);
        });
        return;
      }

      setIncomingCall({
        from: p.from as string, sessionId: p.sessionId as string, callerName: p.callerName as string,
        callerId: p.callerId as string, expiresAt: p.expiresAt as number, acceptToken: p.acceptToken as string,
      });
      setPhase('incoming_ring');
    });

    ch.subscribe(status => { dbgInfo('signaling', 'inbox-channel-status', { status }); });
    return () => { supabase.removeChannel(ch); inboxChannelRef.current = null; };
  }, [currentUserId]);

  // ── Consume pending E2EE ring ──────────────────────────────────────────
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS) return;
    const ring = getPendingE2EERing();
    if (!ring || Date.now() > ring.expiresAt || sessionActiveRef.current) return;
    setPendingE2EERing(null);
    autoAcceptRef.current = !!ring.autoAccept;
    setIncomingCall({ from: ring.from, sessionId: ring.sessionId, callerName: ring.callerName, callerId: ring.callerId, expiresAt: ring.expiresAt, acceptToken: ring.acceptToken });
    setPhase('incoming_ring');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the global overlay is accepted while this page is already mounted,
  // consume the autoAccept transition immediately instead of waiting for a remount.
  useEffect(() => {
    if (!SUPPORTS_TRANSFORMS) return;
    return subscribeE2EERing((ring) => {
      if (!ring?.autoAccept || Date.now() > ring.expiresAt || sessionActiveRef.current) return;
      setPendingE2EERing(null);
      autoAcceptRef.current = true;
      setIncomingCall({ from: ring.from, sessionId: ring.sessionId, callerName: ring.callerName, callerId: ring.callerId, expiresAt: ring.expiresAt, acceptToken: ring.acceptToken });
      setPhase('incoming_ring');
    });
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

  // ── Bind remote stream to video element ───────────────────────────────
  // Single canonical function for all remote stream→element attachment.
  // Ensures muted=false, calls play(), and logs the reason for binding.
  const bindRemoteStreamToElement = useCallback((reason: string) => {
    const el     = remoteVideoRef.current;
    const stream = remoteStreamRef.current;
    if (!el) {
      dbgWarn('media', 'bind-remote-stream-no-element', { reason });
      return;
    }
    if (!stream) {
      dbgWarn('media', 'bind-remote-stream-no-stream', { reason });
      return;
    }
    if (el.srcObject === stream) {
      dbgInfo('media', 'bind-remote-stream-already-bound', { reason });
      // Still ensure muted=false and playing
      el.muted = false;
      if (el.paused) el.play().catch(() => {});
      return;
    }
    el.srcObject = stream;
    el.muted = false; // NEVER mute remote video
    dbgInfo('media', 'bind-remote-stream-attached', {
      reason,
      trackCount: stream.getTracks().length,
      tracks: stream.getTracks().map(t => ({ kind: t.kind, readyState: t.readyState, enabled: t.enabled })),
    });
    el.play().then(() => {
      dbgInfo('media', 'bind-remote-stream-play-success', { reason });
    }).catch(err => {
      if ((err as DOMException).name === 'NotAllowedError') {
        dbgWarn('media', 'bind-remote-stream-autoplay-blocked', { reason });
        const resume = () => {
          el.muted = false;
          el.play().catch(() => {});
          document.removeEventListener('click', resume);
          document.removeEventListener('touchstart', resume);
        };
        document.addEventListener('click', resume, { once: true });
        document.addEventListener('touchstart', resume, { once: true });
      } else {
        dbgWarn('media', 'bind-remote-stream-play-error', { reason, error: String(err) });
      }
    });
  }, []);

  // ── Callback for ActiveCallView: remote element mounted/remounted ──────
  // Fires when React mounts or remounts the remote video DOM element.
  // Re-binds the remote stream to the new element without any generation changes.
  const onRemoteElementMount = useCallback((el: HTMLVideoElement | null) => {
    (remoteVideoRef as React.MutableRefObject<HTMLVideoElement | null>).current = el;
    if (!el) return;
    const stream = remoteStreamRef.current;
    if (!stream) return;
    dbgInfo('media', 'remote-element-remount-rebind', {
      elementId: el.getAttribute('data-call-media') ?? 'unknown',
      hasSrcObject: el.srcObject !== null,
    });
    el.srcObject = stream;
    el.muted = false;
    el.play().catch(() => {});
    presentedFrameCountRef.current = 0;
  }, []);

  const {
    auditTransceiverDirections, doFullCleanup, doHangup, flushICEQueue, logSDPDirections, startLocalStream
  } = useE2EELifecycleHelpers({
    acceptTokenRef, activeKeysRef, callGenerationRef, cameraTrackRef, cleaningUpRef, currentFacingModeRef,
    ecdhKeyPairRef, iceCandidateQueue, isScreenShareOpRef, isScreenSharingRef, isSwitchingCameraRef, lastKeyFingerprintRef,
    localStreamRef, localVideoRef, lockedPeerRef, myPeerIdRef, myPublicJWKRef, offerSentRef,
    pcRef, peerConnectionIdRef, portRecordsRef, presentedFrameCountRef, remoteStreamRef, remoteVideoRef,
    safetyVerifiedRef, saltRef, screenStreamRef, sessionActiveRef, sessionChannelRef, sessionIdRef,
    setConnDiag, setE2eeStatus, setFailReason, setIncomingCall, setIsMuted, setIsScreenSharing,
    setIsStartingScreenShare, setIsSwitchingCamera, setIsVideoOff, setMediaHealth, setPhase, setSafetyNums,
    setSessionCode, setShowSafety, setTargetUser, stopRTPSnapshots, transformWaitersRef, workerRef
  });

  // ── Push keys to all active port records ───────────────────────────────
  const pushKeysToAllPorts = useCallback(async (keys: DerivedKeys) => {
    const records = [...portRecordsRef.current];
    dbgInfo('e2ee', 'push-keys-to-all-ports', { count: records.length, roles: records.map(r => `${r.role}/${r.kind}`) });
    const results = await Promise.allSettled(
      records.map(async pr => {
        await pushKeyToPortRecord(pr, keys);
        notifyTransformWaiters();
      })
    );
    const failed = results.filter(r => r.status === 'rejected') as PromiseRejectedResult[];
    if (failed.length > 0) {
      const reasons = failed.map(f => String(f.reason)).join('; ');
      dbgError('e2ee', 'push-keys-failed', { failCount: failed.length, total: records.length });
      throw new Error(`key push failed for ${failed.length}/${records.length} port(s): ${reasons}`);
    }
  }, []);

  // ── Key setup ──────────────────────────────────────────────────────────
  const doSetupKeys = async (
    peerPublicJWK: string,
    salt: Uint8Array,
    capturedGeneration: number,
  ) => {
    if (!ecdhKeyPairRef.current) return;
    if (capturedGeneration !== callGenerationRef.current) {
      dbgWarn('crypto', 'setup-keys-stale', { capturedGeneration });
      return;
    }
    const fingerprint = `${peerPublicJWK}|${bytesToHex(salt)}`;
    if (fingerprint === lastKeyFingerprintRef.current) {
      dbgInfo('crypto', 'setup-keys-skipped-same-inputs');
      return;
    }
    lastKeyFingerprintRef.current = fingerprint;
    dbgInfo('crypto', 'key-derivation-starting', { role: myRoleRef.current });
    try {
      const peerPub = await importPublicKey(peerPublicJWK);

      if (capturedGeneration !== callGenerationRef.current) {
        dbgWarn('crypto', 'setup-keys-stale-post-import', { capturedGeneration });
        return;
      }

      const keys = await deriveSessionKeys(
        ecdhKeyPairRef.current.privateKey, peerPub,
        sessionIdRef.current, myRoleRef.current, salt,
      );

      if (capturedGeneration !== callGenerationRef.current) {
        dbgWarn('crypto', 'setup-keys-stale-post-derive', { capturedGeneration });
        return;
      }

      activeKeysRef.current = keys;
      dbgInfo('crypto', 'key-derivation-complete', { role: myRoleRef.current });

      await pushKeysToAllPorts(keys);

      if (capturedGeneration !== callGenerationRef.current) {
        dbgWarn('crypto', 'setup-keys-stale-post-push', { capturedGeneration });
        return;
      }

      dbgInfo('transform', 'awaiting-required-transforms');
      await awaitRequiredTransforms(15_000);

      if (capturedGeneration !== callGenerationRef.current) {
        dbgWarn('crypto', 'setup-keys-stale-post-barrier', { capturedGeneration });
        return;
      }

      const nums = await computeSafetyNumber(myPublicJWKRef.current, peerPublicJWK, sessionIdRef.current);
      setSafetyNums(nums);
      setE2eeStatus('active_unverified');
      dbgInfo('e2ee', 'e2ee-active-unverified', { role: myRoleRef.current });
    } catch (e) {
      logError('[E2EE][ERROR]', 'key setup failed:', e);
      dbgError('crypto', 'key-setup-failed', { error: String(e) });
      toast.error('خطا در رمزنگاری — تماس لغو شد');
      doFullCleanup('key_exchange');
    }
  };

  // ── Handle remote track ────────────────────────────────────────────────
  const handleRemoteTrack = async (
    e: RTCTrackEvent,
    capturedGeneration: number,
    capturedSessionId: string,
    capturedPCId: string,
  ) => {
    // Generation/session guard
    if (capturedGeneration !== callGenerationRef.current || capturedSessionId !== sessionIdRef.current) {
      dbgWarn('signaling', 'stale-signal-ignored', { event: 'ontrack', capturedGeneration, currentGeneration: callGenerationRef.current });
      return;
    }

    dbgInfo('media', 'remote-track-received', { kind: e.track.kind, trackId: e.track.id.slice(0, 8) });

    // Build/maintain canonical remote MediaStream BEFORE any await
    const remoteStream = remoteStreamRef.current ?? new MediaStream();
    if (!remoteStream.getTracks().some(t => t.id === e.track.id)) {
      remoteStream.addTrack(e.track);
    }
    remoteStreamRef.current = remoteStream;
    dbgInfo('media', 'remote-track-added-to-stream', {
      kind: e.track.kind,
      trackCount: remoteStream.getTracks().length,
    });

    // Attach to video element using canonical bind function (synchronously before awaits)
    const remoteEl = remoteVideoRef.current;
    if (remoteEl) {
      bindRemoteStreamToElement(`ontrack-${e.track.kind}`);
    }

    // Register transform SYNCHRONOUSLY before first await
    let pr: PortRecord | null = null;
    if (workerRef.current) {
      pr = attachReceiverTransform(e.receiver, workerRef.current, E2EE_DEBUG);
      if (pr) {
        portRecordsRef.current.push(pr);
        notifyTransformWaiters(); // wake existence waiters immediately
        dbgInfo('transform', 'receiver-transform-registered', {
          kind: pr.kind, portId: pr.id.slice(0, 8), state: pr.state,
        });
      } else {
        dbgError('transform', 'receiver-transform-attach-failed', { kind: e.track.kind });
      }
    }

    // Now play (async, after synchronous bookkeeping)
    if (remoteEl) {
      // bindRemoteStreamToElement already called play(); schedule a retry
      // check in case the first decoded frames arrive after the initial play().
      const diagStream = remoteStream;
      setTimeout(() => {
        const v = remoteVideoRef.current;
        if (!v) return;
        if (v.paused || (v.videoWidth === 0 && diagStream.getVideoTracks().length > 0)) {
          bindRemoteStreamToElement(`ontrack-retry-${e.track.kind}`);
        }
      }, 2000);
    } else {
      dbgWarn('media', 'remote-video-ref-not-mounted', { kind: e.track.kind });
      setRemoteStreamTick(v => v + 1);
    }

    // Install keys if already derived (async part — after synchronous bookkeeping)
    if (pr && activeKeysRef.current) {
      const keysSnapshot = activeKeysRef.current;
      try {
        await pushKeyToPortRecord(pr, keysSnapshot);

        if (capturedGeneration !== callGenerationRef.current) {
          dbgWarn('transform', 'receiver-key-push-stale', { kind: pr.kind });
          return;
        }

        notifyTransformWaiters();
        dbgInfo('transform', 'receiver-key-installed', { kind: pr.kind, state: pr.state });
      } catch (err) {
        logError('[E2EE][ERROR]', `key push failed for receiver transform (${pr.kind}):`, err);
        dbgError('transform', 'receiver-key-push-failed', { kind: pr.kind, error: String(err) });
        toast.error('رمزنگاری دریافت فعال نشد — تماس لغو شد');
        doFullCleanup('key_exchange');
      }
    }
  };

  // ── One-way media diagnostics ──────────────────────────────────────────
  const diagnoseOneWayMedia = async (pc: RTCPeerConnection) => {
    try {
      const stats = await pc.getStats();
      const senderStats: string[] = [];
      const receiverStats: string[] = [];
      stats.forEach(s => {
        if (s.type === 'outbound-rtp') senderStats.push(`kind=${(s as RTCOutboundRtpStreamStats).kind} bytesSent=${(s as RTCOutboundRtpStreamStats).bytesSent}`);
        if (s.type === 'inbound-rtp')  receiverStats.push(`kind=${(s as RTCInboundRtpStreamStats).kind} bytesReceived=${(s as RTCInboundRtpStreamStats).bytesReceived}`);
      });
      const records = portRecordsRef.current;
      const portStates = records.map(pr => `${pr.role}/${pr.kind}=${pr.state}`).join(', ');
      dbgInfo('rtp', 'one-way-media-diagnosis', {
        senderStats,
        receiverStats,
        portStates,
        transceivers: pc.getTransceivers().map(t => ({ mid: t.mid, dir: t.direction, curr: t.currentDirection })),
      });
    } catch (err) {
      dbgError('rtp', 'diagnosis-failed', { error: String(err) });
    }
  };

  // ── PeerConnection ─────────────────────────────────────────────────────
  const buildPC = async (capturedGeneration: number, capturedSessionId: string): Promise<RTCPeerConnection | null> => {
    // Generation + session guard: never build a stale PC
    if (capturedGeneration !== callGenerationRef.current) {
      dbgWarn('peer-connection', 'build-pc-stale-generation', { capturedGeneration });
      return null;
    }
    if (capturedSessionId !== sessionIdRef.current) {
      dbgWarn('peer-connection', 'build-pc-stale-session', { capturedSessionId });
      return null;
    }
    // Reuse only if the existing PC is for the same generation+session and not closed
    if (pcRef.current) {
      const existing = pcRef.current;
      if (existing.connectionState !== 'closed' && existing.connectionState !== 'failed') {
        dbgWarn('peer-connection', 'build-pc-reusing-existing');
        return existing;
      }
      // Stale/closed PC — close it and create a fresh one
      dbgWarn('peer-connection', 'build-pc-stale-pc-closing');
      existing.close();
      pcRef.current = null;
      peerConnectionIdRef.current = '';
    }

    const cfg = await getAuthenticatedRTCConfig();
    const pcId = uuidv4();
    peerConnectionIdRef.current = pcId;
    debugStoreSetSession({ peerConnectionId: pcId });

    dbgInfo('peer-connection', 'pc-creating', { pcId: pcId.slice(0, 8) });
    const pc = new RTCPeerConnection(cfg);
    pcRef.current = pc;

    // Assert local stream exists before addTrack
    const stream = localStreamRef.current;
    if (!stream) {
      dbgError('media', 'local-stream-missing-before-addtrack');
      doFullCleanup('key_exchange');
      return null;
    }

    const audioTracks = stream.getAudioTracks();
    const videoTracks = stream.getVideoTracks();
    if (audioTracks.length === 0) {
      dbgError('media', 'no-audio-track-before-addtrack');
      toast.error('میکروفون در دسترس نیست');
      doFullCleanup('key_exchange');
      return null;
    }
    if (videoTracks.length === 0) {
      dbgError('media', 'no-video-track-before-addtrack');
      toast.error('دوربین در دسترس نیست');
      doFullCleanup('key_exchange');
      return null;
    }

    for (const t of stream.getTracks()) {
      pc.addTrack(t, stream);
      dbgInfo('media', 'add-track', { kind: t.kind, enabled: t.enabled, readyState: t.readyState });
    }

    // Verify senders after addTrack
    const senders = pc.getSenders();
    const hasAudioSender = senders.some(s => s.track?.kind === 'audio');
    const hasVideoSender = senders.some(s => s.track?.kind === 'video');
    dbgInfo('media', 'senders-after-addtrack', {
      total: senders.length, hasAudioSender, hasVideoSender,
      senders: senders.map(s => ({ kind: s.track?.kind, readyState: s.track?.readyState, enabled: s.track?.enabled })),
    });

    if (!hasAudioSender || !hasVideoSender) {
      dbgError('media', 'sender-missing-after-addtrack', { hasAudioSender, hasVideoSender });
    }

    if (workerRef.current) {
      for (const sender of pc.getSenders()) {
        if (!sender.track) continue;
        const pr = attachSenderTransform(sender, workerRef.current, E2EE_DEBUG);
        if (pr) {
          portRecordsRef.current.push(pr);
          dbgInfo('transform', 'sender-transform-registered', { kind: pr.kind, portId: pr.id.slice(0, 8) });
          if (activeKeysRef.current) {
            try {
              await pushKeyToPortRecord(pr, activeKeysRef.current);
              notifyTransformWaiters();
            } catch (e) {
              logError('[E2EE][ERROR]', 'pushKey failed for sender — aborting:', e);
              dbgError('transform', 'sender-key-push-failed', { kind: pr.kind, error: String(e) });
              setE2eeStatus('error');
              toast.error('رمزنگاری فعال نشد — تماس لغو شد');
              doFullCleanup('key_exchange');
              return null;
            }
          }
        } else {
          dbgError('transform', 'sender-transform-attach-failed', { kind: sender.track.kind });
          setE2eeStatus('error');
          toast.error('رمزنگاری فعال نشد — تماس لغو شد');
          doFullCleanup('key_exchange');
          return null;
        }
      }
    }

    const capturedPCId = pcId;

    pc.ontrack = (e) => {
      void handleRemoteTrack(e, capturedGeneration, capturedSessionId, capturedPCId).catch(err => {
        dbgError('media', 'ontrack-handler-failed', { kind: e.track?.kind, error: String(err) });
        doFullCleanup('key_exchange');
      });
    };

    pc.onicecandidate = e => {
      if (!e.candidate || !sessionChannelRef.current) return;
      dbgInfo('ice', 'ice-candidate-sent', { type: e.candidate.type });
      sessionChannelRef.current.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: { type: 'ice', from: myPeerIdRef.current, session: sessionIdRef.current, data: { candidate: e.candidate.toJSON() } },
      });
    };

    pc.onicecandidateerror = (e: Event) => {
      const ev = e as RTCPeerConnectionIceErrorEvent;
      const url = ev.url ?? '';
      if (!/^turns?:/i.test(url)) return;
      dbgError('ice', 'ice-candidate-error', { errorCode: ev.errorCode, url });
      logError('[E2EE][ICE]', `TURN error code=${ev.errorCode} url=${url}`);
      if (ev.errorCode === 701) toast.error('احراز هویت سرور TURN شکست خورد');
      else if (ev.errorCode === 702) toast.error('سرور TURN در دسترس نیست');
    };

    pc.onicegatheringstatechange = () => {
      dbgInfo('ice', 'ice-gathering-state', { state: pc.iceGatheringState });
    };

    let iceDisconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let iceRestartAttempts = 0;
    const MAX_ICE_RESTARTS = 3;

    const sendRestartOffer = () => {
      if (pc.signalingState !== 'stable') return;
      dbgInfo('ice', 'ice-restart-offer-sending', { attempt: iceRestartAttempts });
      pc.createOffer({ iceRestart: true })
        .then(offer => pc.setLocalDescription(offer).then(() => offer))
        .then(() => {
          sessionChannelRef.current?.send({
            type: 'broadcast', event: 'e2ee-signal',
            payload: { type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: saltRef.current ? bytesToHex(saltRef.current) : '' } },
          });
        })
        .catch(err => { dbgError('ice', 'ice-restart-failed', { error: String(err) }); doFullCleanup('peer_disconnected'); });
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      dbgInfo('ice', 'ice-connection-state', { state: s });
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
        if (myRoleRef.current === 'caller' && iceRestartAttempts < MAX_ICE_RESTARTS) { iceRestartAttempts++; sendRestartOffer(); }
        else { doFullCleanup('ice_failed'); }
      }
    };

    pc.onsignalingstatechange = () => {
      dbgInfo('peer-connection', 'signaling-state', { state: pc.signalingState });
    };

    pc.onconnectionstatechange = () => {
      const cs = pc.connectionState;
      dbgInfo('peer-connection', 'connection-state', { state: cs, pcId: capturedPCId.slice(0, 8) });
      if (cs === 'connected') {
        setPhase('connected');
        auditTransceiverDirections(pc, 'connected');
        startDiagnostics(pc, sessionIdRef.current, (diag) => {
          setConnDiag(diag);
          if (diag.rttMs !== null && diag.rttMs > 400) logWarn('[E2EE][QOS]', `high RTT: ${diag.rttMs}ms`);
        }, 5000);
        startRTPSnapshots();
        if (isCallDebugEnabled()) {
          setTimeout(() => { void diagnoseOneWayMedia(pc); }, 4000);
        }
      } else if (cs === 'failed') {
        stopDiagnostics(sessionIdRef.current);
        dbgError('peer-connection', 'connection-failed');
        doFullCleanup('ice_failed');
      } else if (cs === 'closed') {
        stopDiagnostics(sessionIdRef.current);
        dbgInfo('peer-connection', 'connection-closed');
      }
    };

    dbgInfo('peer-connection', 'pc-created', { pcId: capturedPCId.slice(0, 8) });
    return pc;
  };

  const {
    openSessionChannel
  } = useE2EESessionChannel({
    acceptTokenRef, auditTransceiverDirections, callGenerationRef, currentUserId, doFullCleanup, doHangup,
    doSetupKeys, flushICEQueue, iceCandidateQueue, lockedPeerRef, logSDPDirections, myPeerIdRef,
    myPublicJWKRef, myRoleRef, offerSentRef, pcRef, peerConnectionIdRef, phaseRef,
    saltRef, sessionChannelRef, sessionIdRef, setPhase
  });

  const {
    acceptCall, rejectCall, startCall
  } = useE2EECallFlow({
    acceptTokenRef, autoAcceptRef, buildPC, callGenerationRef, currentUserId, currentUserName,
    doFullCleanup, doHangup, ecdhKeyPairRef, incomingCall, lockedPeerRef, myPeerIdRef,
    myPublicJWKRef, myRoleRef, offerSentRef, openSessionChannel, phase, phaseRef,
    sessionActiveRef, sessionIdRef, setE2eeStatus, setIncomingCall, setPhase, setSessionCode,
    setTargetUser, startLocalStream, workerRef
  });

  const {
    runSelfTest, switchCamera, toggleMute, toggleScreenShare, toggleVideo, verifySafety
  } = useE2EEMediaControls({
    activeKeysRef, cameraTrackRef, collectRTPSnapshot, currentFacingModeRef, isMuted, isScreenShareOpRef,
    isScreenSharingRef, isSwitchingCameraRef, isVideoOff, localStreamRef, localVideoRef, myPublicJWKRef,
    pcRef, presentedFrameCountRef, remoteVideoRef, safetyVerifiedRef, screenStreamRef, setE2eeStatus,
    setIsMuted, setIsScreenSharing, setIsStartingScreenShare, setIsSwitchingCamera, setIsVideoOff, setShowSafety,
    setVideoDevices, videoDevices
  });

  // ── Cleanup on unmount ─────────────────────────────────────────────────
  useEffect(() => () => { doFullCleanup(); }, [doFullCleanup]);

  return {
    phase, e2eeStatus, isMuted, isVideoOff, isRemoteMuted, isScreenSharing,
    isSwitchingCamera, isStartingScreenShare,
    targetUser, incomingCall, safetyNums, showSafety, sessionCode, failReason,
    userSearch, users, searching, connDiag, isOffline, videoDevices, mediaHealth,
    localVideoRef, remoteVideoRef, safetyVerifiedRef,
    localStreamRef, remoteStreamRef,
    portRecordsRef, pcRef, myRoleRef, sessionIdRef, peerConnectionIdRef,
    startCall, acceptCall, rejectCall, doHangup,
    toggleMute, toggleVideo, toggleScreenShare, switchCamera, verifySafety, runSelfTest,
    onRemoteElementMount,
    setUserSearch, setShowSafety, setIsRemoteMuted, setPhase, setFailReason,
  };
}
