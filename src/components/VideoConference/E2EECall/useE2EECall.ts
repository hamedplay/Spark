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
  validateIceCandidate, validateSDP, validateSignalPayload,
  subscribeChannelOrThrow, safeRemoveChannel, clearChannelRegistry,
} from './signaling';
import type { ChannelPurpose } from './signaling';
import {
  isCallDebugEnabled, dbgInfo, dbgWarn, dbgError,
  debugStoreSetSession, debugStoreReset, debugStoreMarkEnded,
  pushRTPSnapshot, getLatestSnapshot, getRTPSnapshots,
  analyseMediaHealth,
  buildDebugReport,
} from './callDebugStore';
import type { MediaHealthClassification, RTPSnapshot } from './callDebugStore';

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

  // ── RTP snapshot loop ──────────────────────────────────────────────────
  const rtpSnapshotInProgressRef = useRef(false);
  const rtpSnapshotIntervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const stalledCountersRef       = useRef<Map<string, number>>(new Map());

  const collectRTPSnapshot = useCallback(async () => {
    const pc = pcRef.current;
    if (!pc || rtpSnapshotInProgressRef.current) return;
    rtpSnapshotInProgressRef.current = true;
    try {
      const stats = await pc.getStats();
      const transceivers = pc.getTransceivers();

      const senderStats   = new Map<string, RTCOutboundRtpStreamStats>();
      const receiverStats = new Map<string, RTCInboundRtpStreamStats>();
      let candidatePair: RTPSnapshot['candidatePair'] = null;

      stats.forEach(s => {
        if (s.type === 'outbound-rtp') senderStats.set((s as RTCOutboundRtpStreamStats).kind ?? s.id, s as RTCOutboundRtpStreamStats);
        if (s.type === 'inbound-rtp')  receiverStats.set((s as RTCInboundRtpStreamStats).kind ?? s.id, s as RTCInboundRtpStreamStats);
        if (s.type === 'candidate-pair' && (s as RTCIceCandidatePairStats).nominated) {
          const cp = s as RTCIceCandidatePairStats & { localCandidateId?: string; remoteCandidateId?: string };
          candidatePair = {
            localType:  'relay',
            remoteType: 'relay',
            localAddress: cp.localCandidateId?.slice(0, 8) ?? '',
            remoteAddress: cp.remoteCandidateId?.slice(0, 8) ?? '',
          };
        }
      });

      const snap: RTPSnapshot = {
        timestamp: Date.now(),
        pcStates: {
          connectionState:   pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          iceGatheringState:  pc.iceGatheringState,
          signalingState:     pc.signalingState,
        },
        candidatePair,
        senders: transceivers.filter(t => t.sender?.track).map((t, i) => {
          const s = senderStats.get(t.sender.track?.kind ?? '') ?? {} as Partial<RTCOutboundRtpStreamStats>;
          return {
            index: i,
            kind:  t.sender.track?.kind ?? 'unknown',
            trackEnabled: t.sender.track?.enabled ?? false,
            trackMuted:   t.sender.track?.muted ?? true,
            trackReadyState: t.sender.track?.readyState ?? 'ended',
            mid:          t.mid,
            direction:    t.direction,
            currentDirection: t.currentDirection ?? '',
            bytesSent:    (s.bytesSent   as number) ?? 0,
            packetsSent:  (s.packetsSent as number) ?? 0,
            framesEncoded: (s.framesEncoded as number) ?? 0,
            nackCount:    (s.nackCount as number) ?? 0,
            pliCount:     (s.pliCount  as number) ?? 0,
          };
        }),
        receivers: transceivers.filter(t => t.receiver?.track).map((t, i) => {
          const r = receiverStats.get(t.receiver.track?.kind ?? '') ?? {} as Partial<RTCInboundRtpStreamStats>;
          return {
            index: i,
            kind:  t.receiver.track?.kind ?? 'unknown',
            trackMuted:   t.receiver.track?.muted ?? true,
            trackReadyState: t.receiver.track?.readyState ?? 'ended',
            mid:          t.mid,
            direction:    t.direction,
            currentDirection: t.currentDirection ?? '',
            bytesReceived: (r.bytesReceived  as number) ?? 0,
            packetsReceived: (r.packetsReceived as number) ?? 0,
            packetsLost:  (r.packetsLost    as number) ?? 0,
            jitter:       (r.jitter         as number) ?? 0,
            framesReceived: (r.framesReceived as number) ?? 0,
            framesDecoded:  (r.framesDecoded  as number) ?? 0,
            audioLevel:   (r.audioLevel     as number | undefined) ?? null,
          };
        }),
        portRecordStates: portRecordsRef.current.map(pr => ({
          id:             pr.id.slice(0, 8),
          role:           pr.role,
          kind:           pr.kind,
          state:          pr.state,
          installedEpoch: pr.installedEpoch,
        })),
      };

      pushRTPSnapshot(snap);

      // Health analysis
      const snapshots = getRTPSnapshots();
      const prev = snapshots.length >= 2 ? snapshots[snapshots.length - 2] : null;
      const health = analyseMediaHealth({
        prev,
        curr: snap,
        portRecordStates: snap.portRecordStates,
        remoteVideoElement: remoteVideoRef.current,
        remoteVisibleElement: remoteVideoRef.current,
        localTracks: localStreamRef.current?.getTracks() ?? [],
        stalledCounters: stalledCountersRef.current,
        presentedFrameCount: isCallDebugEnabled() ? presentedFrameCountRef.current : null,
      });
      setMediaHealth(health);

      if (isCallDebugEnabled()) {
        const bad = health.filter(h => h.classification !== 'HEALTHY');
        if (bad.length > 0) {
          dbgWarn('rtp', 'media-health-issues', {
            issues: bad.map(h => `${h.direction}-${h.kind}:${h.classification}`),
          });
        }
      }
    } catch (err) {
      logError('[E2EE][SNAP]', 'getStats failed:', err);
    } finally {
      rtpSnapshotInProgressRef.current = false;
    }
  }, []);

  const startRTPSnapshots = useCallback(() => {
    if (rtpSnapshotIntervalRef.current) return;
    rtpSnapshotIntervalRef.current = setInterval(() => {
      void collectRTPSnapshot();
    }, 2000);
    dbgInfo('rtp', 'rtp-snapshot-loop-started');
  }, [collectRTPSnapshot]);

  const stopRTPSnapshots = useCallback(() => {
    if (rtpSnapshotIntervalRef.current) {
      clearInterval(rtpSnapshotIntervalRef.current);
      rtpSnapshotIntervalRef.current = null;
    }
    stalledCountersRef.current.clear();
    dbgInfo('rtp', 'rtp-snapshot-loop-stopped');
  }, []);

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

  // ── Cleanup ────────────────────────────────────────────────────────────
  const doFullCleanup = useCallback((reason?: FailReason) => {
    if (cleaningUpRef.current) return;
    cleaningUpRef.current = true;
    dbgInfo('lifecycle', 'cleanup-started', { reason: reason ?? 'none' });

    // Invalidate all outstanding async operations
    callGenerationRef.current++;

    sessionActiveRef.current = false;
    offerSentRef.current = false;
    isSwitchingCameraRef.current = false;
    isScreenShareOpRef.current = false;

    workerRef.current?.postMessage({ type: 'clear' });

    stopRTPSnapshots();
    if (sessionIdRef.current) stopDiagnostics(sessionIdRef.current);
    setConnDiag(null);
    setMediaHealth([]);

    pcRef.current?.close();
    pcRef.current = null;
    peerConnectionIdRef.current = '';
    dbgInfo('peer-connection', 'pc-closed-cleanup');

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    cameraTrackRef.current = null;
    currentFacingModeRef.current = 'user';

    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    isScreenSharingRef.current = false;

    remoteStreamRef.current = null;
    if (localVideoRef.current)  localVideoRef.current.srcObject  = null;
    // Guard: only clear the remote element if it still belongs to this generation.
    // After cleanup, callGenerationRef has already been incremented, so the
    // new element (if any) will get a fresh bind from onRemoteElementMount.
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    presentedFrameCountRef.current = 0;

    portRecordsRef.current.forEach(pr => {
      pr.state = 'closed';
      try { pr.port.close(); } catch { /* already closed */ }
    });
    portRecordsRef.current = [];
    transformWaitersRef.current = [];

    iceCandidateQueue.current = [];
    activeKeysRef.current = null;
    lockedPeerRef.current = null;
    saltRef.current = null;
    acceptTokenRef.current = '';

    if (sessionChannelRef.current) {
      supabase.removeChannel(sessionChannelRef.current);
      sessionChannelRef.current = null;
      dbgInfo('signaling', 'session-channel-removed');
    }
    clearChannelRegistry();
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

    // PRESERVE the debug timeline so the failure screen can show/export it.
    // Do NOT call debugStoreReset() here — that happens only at the start of a new call.
    debugStoreMarkEnded(reason ?? undefined);
    cleaningUpRef.current = false;

    if (reason) { setFailReason(reason); setPhase('failed'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRTPSnapshots]);

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
  const startLocalStream = async (capturedGeneration: number): Promise<MediaStream | null> => {
    dbgInfo('media', 'get-user-media-starting');
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(isMobile && { sampleRate: 16000 }) },
        video: isMobile ? { facingMode: 'user', width: { ideal: 360, max: 480 }, height: { ideal: 640, max: 720 }, frameRate: { ideal: 20, max: 30 } }
          : { facingMode: 'user', width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 30, max: 30 } },
      });

      if (capturedGeneration !== callGenerationRef.current) {
        s.getTracks().forEach(t => t.stop());
        dbgWarn('media', 'get-user-media-stale', { capturedGeneration });
        return null;
      }

      const audioTracks = s.getAudioTracks();
      const videoTracks = s.getVideoTracks();

      dbgInfo('media', 'get-user-media-success', {
        audioTracks: audioTracks.length,
        videoTracks: videoTracks.length,
        audioEnabled: audioTracks[0]?.enabled,
        videoEnabled: videoTracks[0]?.enabled,
        audioReadyState: audioTracks[0]?.readyState,
        videoReadyState: videoTracks[0]?.readyState,
      });

      if (audioTracks.length === 0) {
        toast.error('دسترسی به میکروفون ممکن نیست');
        dbgError('media', 'no-audio-track');
        s.getTracks().forEach(t => t.stop());
        return null;
      }
      if (videoTracks.length === 0) {
        toast.error('دسترسی به دوربین ممکن نیست');
        dbgError('media', 'no-video-track');
        s.getTracks().forEach(t => t.stop());
        return null;
      }

      localStreamRef.current = s;
      const firstVideoTrack = s.getVideoTracks()[0] ?? null;
      cameraTrackRef.current = firstVideoTrack;
      const actualFacing = firstVideoTrack?.getSettings().facingMode;
      currentFacingModeRef.current = actualFacing === 'environment' ? 'environment' : 'user';

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = s;
        localVideoRef.current.play().catch(() => {});
      }
      return s;
    } catch (e) {
      logError('[E2EE][ERROR]', 'getUserMedia failed:', e);
      dbgError('media', 'get-user-media-failed', { error: String(e) });
      toast.error('دسترسی به دوربین یا میکروفون داده نشد');
      return null;
    }
  };

  const flushICEQueue = async (pc: RTCPeerConnection, capturedPCId: string) => {
    const queued = iceCandidateQueue.current.splice(0);
    dbgInfo('ice', 'ice-queue-flush', { count: queued.length, pcId: capturedPCId.slice(0, 8) });
    for (const c of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(e =>
        logWarn('[E2EE][ICE]', 'addIceCandidate (queued) failed:', e)
      );
    }
  };

  // ── SDP direction logging ──────────────────────────────────────────────
  const logSDPDirections = (sdp: string | undefined, label: string) => {
    if (!isCallDebugEnabled() || !sdp) return;
    const lines = sdp.split('\n');
    let mediaSection = '';
    const sections: string[] = [];
    for (const line of lines) {
      if (line.startsWith('m=')) { mediaSection = line.trim(); }
      else if (mediaSection && /^a=(sendrecv|sendonly|recvonly|inactive)/.test(line)) {
        const dir = line.trim().replace('a=', '');
        sections.push(`${mediaSection.split(' ')[0].replace('m=', '')}:${dir}`);
        mediaSection = '';
      }
    }
    dbgInfo('sdp', `sdp-direction-${label}`, { directions: sections });
  };

  // ── Transceiver direction audit ────────────────────────────────────────
  const auditTransceiverDirections = (pc: RTCPeerConnection, stage: string) => {
    if (!isCallDebugEnabled()) return;
    const transceivers = pc.getTransceivers();
    for (const t of transceivers) {
      const data = {
        stage,
        mid: t.mid,
        senderKind: t.sender?.track?.kind,
        receiverKind: t.receiver?.track?.kind,
        direction: t.direction,
        currentDirection: t.currentDirection,
        stopped: t.stopped,
      };
      if (t.currentDirection && t.currentDirection !== 'sendrecv') {
        dbgWarn('peer-connection', 'transceiver-not-sendrecv', data);
      } else {
        dbgInfo('peer-connection', 'transceiver-state', data);
      }
    }
  };

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

    const cfg = await getSharedRTCConfig();
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

  // ── Offer / Session channel ────────────────────────────────────────────
  const doSendOffer = async (capturedGeneration: number) => {
    const pc = pcRef.current;
    const ch = sessionChannelRef.current;
    if (!pc || !ch) return;
    if (capturedGeneration !== callGenerationRef.current) {
      dbgWarn('signaling', 'send-offer-stale', { capturedGeneration });
      return;
    }
    const salt = crypto.getRandomValues(new Uint8Array(16));
    saltRef.current = salt;
    const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
    await pc.setLocalDescription(offer);
    logSDPDirections(pc.localDescription?.sdp, 'caller:local-offer');
    dbgInfo('signaling', 'offer-sent', { sessionId: sessionIdRef.current.slice(0, 8) });
    ch.send({
      type: 'broadcast', event: 'e2ee-signal',
      payload: {
        type: 'offer', from: myPeerIdRef.current, session: sessionIdRef.current,
        data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current, salt: bytesToHex(salt) },
      },
    });
  };

  const openSessionChannel = (sessionId: string, capturedGeneration: number) => {
    const ch = supabase.channel(`e2ee-sess-${sessionId}`, { config: { broadcast: { self: false } } });
    sessionChannelRef.current = ch;
    dbgInfo('signaling', 'session-channel-created', { sessionId: sessionId.slice(0, 8) });

    ch.on('broadcast', { event: 'e2ee-signal' }, async ({ payload }) => {
      // Generation guard: ignore signals for stale sessions
      if (capturedGeneration !== callGenerationRef.current) {
        dbgWarn('signaling', 'stale-signal-ignored', { event: 'session-signal', capturedGeneration, currentGeneration: callGenerationRef.current });
        return;
      }
      if (sessionId !== sessionIdRef.current) {
        dbgWarn('signaling', 'stale-signal-ignored', { event: 'session-id-mismatch' });
        return;
      }

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
        dbgInfo('signaling', 'call-accepted-by-callee');
        setPhase('connecting');
        await doSendOffer(capturedGeneration);
      }

      else if (type === 'offer' && myRoleRef.current === 'callee') {
        if (!validateSDP(data?.sdp, 'offer')) return;
        if (typeof data?.publicKey !== 'string') return;
        if (typeof data?.salt !== 'string') return;
        const saltBytes = hexToBytes(data.salt as string);
        if (!saltBytes || saltBytes.length !== 16) return;
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'stable') return;
        dbgInfo('signaling', 'offer-received', { signalingState: pc.signalingState });
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          logSDPDirections((data.sdp as RTCSessionDescriptionInit)?.sdp, 'callee:remote-offer');
          dbgInfo('signaling', 'remote-description-set-offer');
          await flushICEQueue(pc, peerConnectionIdRef.current);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          logSDPDirections(pc.localDescription?.sdp, 'callee:local-answer');
          dbgInfo('signaling', 'local-description-set-answer');
          auditTransceiverDirections(pc, 'callee:after-setLocalDescription');
          await doSetupKeys(data.publicKey as string, saltBytes, capturedGeneration);
          ch.send({
            type: 'broadcast', event: 'e2ee-signal',
            payload: { type: 'answer', from: myPeerIdRef.current, session: sessionIdRef.current, data: { sdp: pc.localDescription, publicKey: myPublicJWKRef.current } },
          });
          dbgInfo('signaling', 'answer-sent');
        } catch (e) {
          logError('[E2EE][ERROR]', 'offer handling:', e);
          dbgError('signaling', 'offer-handling-failed', { error: String(e) });
          doFullCleanup('key_exchange');
        }
      }

      else if (type === 'answer' && myRoleRef.current === 'caller') {
        if (!validateSDP(data?.sdp, 'answer')) return;
        if (typeof data?.publicKey !== 'string') return;
        if (!saltRef.current) return;
        const pc = pcRef.current;
        if (!pc || pc.signalingState !== 'have-local-offer') return;
        dbgInfo('signaling', 'answer-received');
        try {
          await pc.setRemoteDescription(new RTCSessionDescription(data.sdp as RTCSessionDescriptionInit));
          logSDPDirections((data.sdp as RTCSessionDescriptionInit)?.sdp, 'caller:remote-answer');
          dbgInfo('signaling', 'remote-description-set-answer');
          await flushICEQueue(pc, peerConnectionIdRef.current);
          auditTransceiverDirections(pc, 'caller:after-setRemoteDescription');
          await doSetupKeys(data.publicKey as string, saltRef.current, capturedGeneration);
        } catch (e) {
          logError('[E2EE][ERROR]', 'answer handling:', e);
          dbgError('signaling', 'answer-handling-failed', { error: String(e) });
          doFullCleanup('key_exchange');
        }
      }

      else if (type === 'ice') {
        const candidate = data?.candidate;
        if (!validateIceCandidate(candidate)) return;
        const pc = pcRef.current;
        if (!pc) return;
        if (iceCandidateQueue.current.length >= ICE_QUEUE_MAX) return;
        dbgInfo('ice', 'ice-candidate-received');
        if (pc.remoteDescription) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(e => logWarn('[E2EE][ICE]', 'addIceCandidate failed:', e));
        } else {
          iceCandidateQueue.current.push(candidate);
        }
      }

      else if (type === 'hangup') {
        dbgInfo('lifecycle', 'peer-hangup');
        doHangup(false);
        toast('مخاطب تماس را قطع کرد');
      }

      else if (type === 'rejected') {
        dbgInfo('lifecycle', 'call-rejected-by-peer');
        doHangup(false);
        toast('مخاطب تماس را رد کرد');
      }
    });

    // Do NOT call ch.subscribe() here.
    // subscribeChannelOrThrow() is the single owner of subscribe for this channel.
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
      // Increment generation for this new call
      const generation = ++callGenerationRef.current;
      debugStoreReset();
      debugStoreSetSession({ role: 'caller' });
      dbgInfo('lifecycle', 'call-starting', { targetUserId: target.user_id.slice(0, 8) });

      await ensureWorkerReady(workerRef.current);
      dbgInfo('worker', 'worker-health-check-passed');

      setTargetUser(target);
      myRoleRef.current = 'caller';
      debugStoreSetSession({ role: 'caller' });
      offerSentRef.current = false;
      invalidateRTCConfigCache();

      const sessionId = uuidv4();
      sessionIdRef.current = sessionId;
      debugStoreSetSession({ sessionId, generation });
      setSessionCode(sessionId.slice(0, 8).toUpperCase());
      acceptTokenRef.current = randomHex(16);

      ecdhKeyPairRef.current = await generateECDHKeyPair();
      myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);
      dbgInfo('crypto', 'ecdh-keypair-generated');

      if (generation !== callGenerationRef.current) return;

      const stream = await startLocalStream(generation);
      if (!stream) { doFullCleanup(); return; }

      if (generation !== callGenerationRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

      const ch = openSessionChannel(sessionId, generation);
      const sessChId = uuidv4();
      await subscribeChannelOrThrow(ch!, {
        attemptId:    sessChId,
        purpose:      'session',
        generation,
        sessionId,
        channelId:    sessChId,
        topicSummary: `e2ee-sess-${sessionId.slice(0, 8)}`,
        startedAt:    Date.now(),
      });

      if (generation !== callGenerationRef.current) return;

      const pc = await buildPC(generation, sessionId);
      if (!pc) return;

      sessionActiveRef.current = true;

      // Send ring to both the session inbox and the global inbox.
      // Two channels are needed because the callee may be subscribed to either
      // (depending on whether the page is active or in the background/PWA).
      const ringPayload = {
        from: myPeerIdRef.current, sessionId, targetUserId: target.user_id,
        callerName: currentUserName, callerId: currentUserId,
        acceptToken: acceptTokenRef.current, expiresAt: Date.now() + INVITE_TTL_MS,
      };

      const inboxId  = uuidv4();
      const globalId = uuidv4();
      const calleeInbox       = supabase.channel(`e2ee-inbox-${target.user_id}`,        { config: { broadcast: { self: false } } });
      const calleeGlobalInbox = supabase.channel(`e2ee-global-inbox-${target.user_id}`, { config: { broadcast: { self: false } } });

      // Subscribe both, then send ring on whichever succeeds
      const sendRing = (c: ReturnType<typeof supabase.channel>, cId: string, purpose: ChannelPurpose) =>
        subscribeChannelOrThrow(c, {
          attemptId: cId, purpose, generation, sessionId,
          channelId: cId, topicSummary: `ring-${target.user_id.slice(0, 8)}`, startedAt: Date.now(),
        }).then(() => {
          c.send({ type: 'broadcast', event: 'e2ee-ring', payload: ringPayload });
          return safeRemoveChannel(c, cId, 3000);
        }).catch(() => { void safeRemoveChannel(c, cId); });

      void sendRing(calleeInbox,       inboxId,  'callee-inbox');
      void sendRing(calleeGlobalInbox, globalId, 'callee-global-inbox');

      setPhase('outgoing_ring');
      dbgInfo('lifecycle', 'ring-sent', { targetUserId: target.user_id.slice(0, 8) });

      const capturedSessionId = sessionId;
      setTimeout(() => {
        if (sessionIdRef.current === capturedSessionId && phaseRef.current === 'outgoing_ring') {
          dbgWarn('lifecycle', 'invite-expired');
          doFullCleanup('invite_expired');
        }
      }, INVITE_TTL_MS);
    } catch (e) {
      logError('[E2EE][ERROR]', 'startCall failed:', e);
      dbgError('lifecycle', 'start-call-failed', { error: String(e) });
      toast.error('خطا در شروع تماس');
      doFullCleanup('key_exchange');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserId, currentUserName, doFullCleanup, doHangup]);

  const acceptCall = useCallback(async () => {
    const ic = incomingCall;
    if (!ic) return;
    if (Date.now() > ic.expiresAt) {
      setIncomingCall(null); setPhase('idle');
      toast.error('دعوت به تماس منقضی شده');
      return;
    }
    if (!SUPPORTS_TRANSFORMS || !workerRef.current) {
      toast.error('مرورگر از تماس امن پشتیبانی نمی‌کند');
      return;
    }
    try {
      const generation = ++callGenerationRef.current;
      debugStoreReset();
      debugStoreSetSession({ role: 'callee' });
      dbgInfo('lifecycle', 'call-accepting');

      await ensureWorkerReady(workerRef.current);
      dbgInfo('worker', 'worker-health-check-passed');

      myRoleRef.current = 'callee';
      debugStoreSetSession({ role: 'callee' });
      sessionIdRef.current = ic.sessionId;
      debugStoreSetSession({ sessionId: ic.sessionId, generation });
      lockedPeerRef.current = ic.from;
      offerSentRef.current = false;
      invalidateRTCConfigCache();

      ecdhKeyPairRef.current = await generateECDHKeyPair();
      myPublicJWKRef.current = await exportPublicKey(ecdhKeyPairRef.current.publicKey);
      dbgInfo('crypto', 'ecdh-keypair-generated');

      if (generation !== callGenerationRef.current) return;

      const stream = await startLocalStream(generation);
      if (!stream) { doFullCleanup(); setIncomingCall(null); return; }

      if (generation !== callGenerationRef.current) { stream.getTracks().forEach(t => t.stop()); return; }

      const ch = openSessionChannel(ic.sessionId, generation);
      const sessChId = uuidv4();
      await subscribeChannelOrThrow(ch!, {
        attemptId:    sessChId,
        purpose:      'session',
        generation,
        sessionId:    ic.sessionId,
        channelId:    sessChId,
        topicSummary: `e2ee-sess-${ic.sessionId.slice(0, 8)}`,
        startedAt:    Date.now(),
      });

      if (generation !== callGenerationRef.current) return;

      const pc = await buildPC(generation, ic.sessionId);
      if (!pc) { setIncomingCall(null); return; }

      sessionActiveRef.current = true;

      ch!.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: { type: 'accepted', from: myPeerIdRef.current, session: ic.sessionId, data: { acceptToken: ic.acceptToken, targetUserId: ic.callerId } },
      });
      dbgInfo('signaling', 'accepted-signal-sent');

      setIncomingCall(null);
      setTargetUser({ user_id: ic.callerId, full_name: ic.callerName, email: null });
      setPhase('connecting');
    } catch (e) {
      logError('[E2EE][ERROR]', 'acceptCall failed:', e);
      dbgError('lifecycle', 'accept-call-failed', { error: String(e) });
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
    const rejChId = uuidv4();
    const ch = supabase.channel(`e2ee-sess-${ic.sessionId}`, { config: { broadcast: { self: false } } });
    subscribeChannelOrThrow(ch, {
      attemptId:    rejChId,
      purpose:      'reject-temp',
      generation:   callGenerationRef.current,
      sessionId:    ic.sessionId,
      channelId:    rejChId,
      topicSummary: `e2ee-sess-${ic.sessionId.slice(0, 8)}`,
      startedAt:    Date.now(),
    }).then(() => {
      ch.send({ type: 'broadcast', event: 'e2ee-signal', payload: { type: 'rejected', from: myPeerIdRef.current, session: ic.sessionId, data: {} } });
      return safeRemoveChannel(ch, rejChId, 1500);
    }).catch(err => {
      logWarn('[E2EE][SIGNAL]', 'reject channel subscribe failed:', err);
      void safeRemoveChannel(ch, rejChId);
    });
  }, [incomingCall]);

  // ── Self-test ──────────────────────────────────────────────────────────
  const runSelfTest = useCallback(async (): Promise<MediaHealthClassification[]> => {
    const pc = pcRef.current;
    if (!pc) return [];
    dbgInfo('lifecycle', 'self-test-started');
    await collectRTPSnapshot();
    await new Promise(r => setTimeout(r, 2000));
    await collectRTPSnapshot();
    const snaps = getRTPSnapshots();
    const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
    const curr = snaps[snaps.length - 1];
    if (!curr) return [];
    const result = analyseMediaHealth({
      prev, curr,
      portRecordStates: curr.portRecordStates,
      remoteVideoElement: remoteVideoRef.current,
      remoteVisibleElement: remoteVideoRef.current,
      localTracks: localStreamRef.current?.getTracks() ?? [],
      stalledCounters: new Map(),
      presentedFrameCount: isCallDebugEnabled() ? presentedFrameCountRef.current : null,
    });
    dbgInfo('lifecycle', 'self-test-complete', {
      results: result.map(r => `${r.direction}-${r.kind}:${r.classification}`),
    });
    return result;
  }, [collectRTPSnapshot]);

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
          const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
          const camStream = await navigator.mediaDevices.getUserMedia({ video: isMobile ? { facingMode: currentFacingModeRef.current } : { facingMode: 'user' }, audio: false });
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
      } catch (err) { logError('[E2EE][MEDIA]', 'restore camera track failed:', err); toast.error('بازگشت به دوربین ناموفق بود'); }
    }
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    isScreenSharingRef.current = false;
    isScreenShareOpRef.current = false;
    setIsScreenSharing(false);
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenShareOpRef.current) return;
    if (isScreenSharingRef.current) { await stopScreenShare(); return; }
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') { toast.error('اشتراک‌گذاری صفحه در این دستگاه پشتیبانی نمی‌شود'); return; }
    const pc = pcRef.current;
    const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) { toast.error('فرستنده ویدیو پیدا نشد'); return; }
    isScreenShareOpRef.current = true;
    setIsStartingScreenShare(true);
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = displayStream;
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error('No screen video track');
      await sender.replaceTrack(screenTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = new MediaStream([screenTrack]);
      screenTrack.addEventListener('ended', () => { void stopScreenShare(); }, { once: true });
      isScreenSharingRef.current = true;
      isScreenShareOpRef.current = false;
      setIsScreenSharing(true);
    } catch (err: unknown) {
      isScreenShareOpRef.current = false;
      if (!(err instanceof Error) || err.name !== 'NotAllowedError') toast.error('اشتراک‌گذاری صفحه شروع نشد');
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    } finally { setIsStartingScreenShare(false); }
  }, [stopScreenShare]);

  const verifySafety = useCallback(() => {
    if (!myPublicJWKRef.current || !activeKeysRef.current) { logError('[E2EE][SAFETY]', 'verifySafety called before keys'); return; }
    safetyVerifiedRef.current = true;
    setE2eeStatus('active_verified');
    setShowSafety(false);
    dbgInfo('e2ee', 'safety-verified');
  }, []);

  const switchCamera = useCallback(async () => {
    if (isSwitchingCameraRef.current) return;
    if (isScreenSharingRef.current) { toast('ابتدا اشتراک‌گذاری صفحه را متوقف کنید'); return; }
    const currentStream = localStreamRef.current;
    if (!currentStream) return;
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    let devices = videoDevices;
    if (devices.length === 0) {
      try { const all = await navigator.mediaDevices.enumerateDevices(); devices = all.filter(d => d.kind === 'videoinput'); setVideoDevices(devices); } catch { /* ignore */ }
    }
    const currentTrack = currentStream.getVideoTracks()[0];
    let videoConstraints: MediaTrackConstraints;
    if (devices.length >= 2) {
      const currentDeviceId = currentTrack?.getSettings().deviceId;
      const currentIndex = devices.findIndex(d => d.deviceId === currentDeviceId);
      const nextDevice = devices[(currentIndex + 1) % devices.length];
      videoConstraints = { deviceId: { exact: nextDevice.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } };
    } else if (isMobile) {
      const nextFacing = currentFacingModeRef.current === 'user' ? 'environment' : 'user';
      videoConstraints = { facingMode: { exact: nextFacing }, width: { ideal: 640 }, height: { ideal: 480 } };
    } else { toast('دوربین دیگری در دسترس نیست'); return; }
    isSwitchingCameraRef.current = true;
    setIsSwitchingCamera(true);
    let newStream: MediaStream | null = null;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) throw new Error('No video track from new camera');
      const pc = pcRef.current;
      const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
      currentTrack?.stop();
      currentStream.getVideoTracks().forEach(t => { if (t !== newTrack) currentStream.removeTrack(t); });
      currentStream.addTrack(newTrack);
      cameraTrackRef.current = newTrack;
      const newFacing = newTrack.getSettings().facingMode;
      currentFacingModeRef.current = newFacing === 'environment' ? 'environment' : 'user';
      if (localVideoRef.current) localVideoRef.current.srcObject = currentStream;
    } catch (err) {
      logError('[E2EE][MEDIA]', 'switchCamera failed:', err);
      newStream?.getTracks().forEach(t => t.stop());
      const errName = (err instanceof Error) ? err.name : '';
      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') toast.error('دوربین دیگری در دسترس نیست');
      else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') toast.error('دسترسی به دوربین یا میکروفون داده نشد');
      else if (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError') toast.error('دوربین دیگری در دسترس نیست');
      else toast.error('تغییر دوربین انجام نشد');
    } finally { isSwitchingCameraRef.current = false; setIsSwitchingCamera(false); }
  }, [videoDevices]);

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
