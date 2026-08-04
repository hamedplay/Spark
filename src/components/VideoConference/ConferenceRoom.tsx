import { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare, Users, Hand, ScreenShare, ScreenShareOff, Maximize2, Minimize2, Crown, Pin, X, Copy, Check, Smile, ChartBar as BarChart2, PenTool, Volume2, VolumeX, Activity, UserPlus, ShieldAlert, UserX, Mic as Mic2, ChevronUp, ChevronDown, ArrowRightLeft, SlidersHorizontal, LayoutGrid, MonitorPlay, PanelRight, ShieldCheck, ShieldOff, Clock } from 'lucide-react';
import { useConferenceClient } from './conferenceClient';
import { getSharedRTCConfig, getGuestRTCConfig } from '../../lib/rtcConfig';
import { startDiagnostics, stopDiagnostics, stopAllDiagnostics, attemptICERestart } from '../../lib/webrtcDiagnostics';
import type { PeerDiagnostics } from '../../lib/webrtcDiagnostics';
import toast from 'react-hot-toast';
import type {
  ConferenceRoom, ConferenceParticipant, ConferenceMessage,
  PeerConnection, Reaction, SidePanel, LayoutMode,
} from './types';
import { VideoTile, QualityDot } from './VideoTile';
import { GalleryLayout } from './GalleryLayout';
import { SpeakerLayout } from './SpeakerLayout';
import { SidebarLayout } from './SidebarLayout';
import { Whiteboard } from './Whiteboard';
import { PollPanel } from './PollPanel';
import { SettingsPanel, VIDEO_QUALITY_PRESETS } from './SettingsPanel';
import { ChatPanel } from './ChatPanel';
import { PendingApprovalsList } from './ApprovalGate';
import type { PendingApproval } from './ApprovalGate';
import { BanList } from './BanList';
import type { VideoQuality } from './SettingsPanel';
import { LeaveConfirmModal } from './Room/LeaveConfirmModal';
import { KickBanModal, type KickConfirmData, type PendingBanData } from './Room/KickBanModal';
import { ScreenShareBadge, FloatingReactions, EmojiPicker, SpeakingProgressBar } from './Room/Overlays';
import { DiagnosticsPanel } from './Room/DiagnosticsPanel';
import { BottomControls } from './Room/BottomControls';
import { TopBar } from './Room/TopBar';
import { VideoArea, type TileData } from './Room/VideoArea';
import { ParticipantsPanel } from './Room/ParticipantsPanel';
import { SidePanelHeader } from './Room/SidePanelHeader';
import { SidePanelContainer } from './Room/SidePanelContainer';
import { RoomOverlays } from './Room/RoomOverlays';
import { RoomBackground } from './Room/RoomBackground';
import { ROLE_PERMISSIONS, ROLE_LABELS, ROLE_COLORS, type RoleType, type Permission } from './Room/roleConstants';
import { mediaReducer, type MediaState } from './Room/mediaReducer';
import { MAX_PARTICIPANTS, calculateBitrate, setPreferredCodecs, EMOJIS, fmt, qualityColor } from './Room/webrtcHelpers';

// ── Config ────────────────────────────────────────────────────────────────────

// ── Media state reducer ───────────────────────────────────────────────────────
// (moved to Room/mediaReducer.ts)

// ── Types ─────────────────────────────────────────────────────────────────────
interface HandRaiseEntry { peerId: string; name: string; time: number; }

interface Props {
  room: ConferenceRoom;
  currentUserId: string;
  currentUserName: string;
  myPeerId: string;
  localStream: MediaStream;
  onLeave: () => void;
  onInvite?: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Main component ────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
export function ConferenceRoomView({ room, currentUserId, currentUserName, myPeerId, localStream, onLeave, onInvite }: Props) {
  const supabase = useConferenceClient();
  // ── RTCConfig — loaded from system_config via shared cache on mount
  const rtcConfigRef = useRef<RTCConfiguration>({
    iceServers: [], iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require',
  });
  const isGuestClient = (() => {
    try {
      return (supabase as unknown as { auth?: { config?: { persistSession?: boolean } } }).auth?.config?.persistSession === false;
    } catch { return false; }
  })();
  const rtcConfigReadyRef = useRef<Promise<void>>(
    (isGuestClient ? getGuestRTCConfig() : getSharedRTCConfig()).then(cfg => { rtcConfigRef.current = cfg; })
  );

  useEffect(() => {
    const fetcher = isGuestClient ? getGuestRTCConfig : getSharedRTCConfig;
    rtcConfigReadyRef.current = fetcher().then(cfg => { rtcConfigRef.current = cfg; });
  }, []);
  const [media, dispatch] = useReducer(mediaReducer, {
    isMuted: false, isVideoOff: false, isHandRaised: false,
    isScreenSharing: false, isSpeakerMuted: false,
  });
  // Stable ref so callbacks (onended, timers) always read current media state
  const mediaRef = useRef(media);
  mediaRef.current = media;
  const { isMuted, isVideoOff, isHandRaised, isScreenSharing, isSpeakerMuted } = media;

  // ── Other state ────────────────────────────────────────────────────────────
  const [peers, setPeers] = useState<Map<string, PeerConnection>>(new Map());
  const [messages, setMessages] = useState<ConferenceMessage[]>([]);
  const [reactions, setReactions] = useState<Reaction[]>([]);
  // userId → emoji, cleared after 3s
  const [tileReactions, setTileReactions] = useState<Map<string, string>>(new Map());
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => {
    try { return (localStorage.getItem(`conf_layout_${room.id}`) as LayoutMode) || 'gallery'; } catch { return 'gallery'; }
  });
  // Drag-and-drop tile order — peerIds, persisted to localStorage
  const [tileOrder, setTileOrder] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(`conf_tile_order_${room.id}`) || '[]'); } catch { return []; }
  });
  const dragSrcRef = useRef<string | null>(null);
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [duration, setDuration] = useState(0);
  const [codeCopied, setCodeCopied] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [myQuality, setMyQuality] = useState<PeerConnection['networkQuality']>('good');
  // Peer latencies (peerId → RTT ms) — updated every 3s via WebRTC getStats()
  const [peerLatencies, setPeerLatencies] = useState<Record<string, number>>({});

  // Peer avatar URLs (userId → avatar_url) fetched from profiles on demand
  const [peerAvatarUrls, setPeerAvatarUrls] = useState<Record<string, string>>({});
  const fetchedAvatarUserIds = useRef<Set<string>>(new Set());

  // WebRTC diagnostics — peerId → latest stats snapshot
  const [peerDiagnostics, setPeerDiagnostics] = useState<Map<string, PeerDiagnostics>>(new Map());

  // Dynamic host — updated on transfer
  const [hostId, setHostId] = useState(room.host_id);
  const isHost = hostId === currentUserId;

  // Runtime chat toggle — starts from room setting, updated via DB subscription
  const [chatEnabled, setChatEnabled] = useState(room.chat_enabled ?? true);

  // Runtime speaking limit toggle — starts from room setting, synced via DB subscription
  const [speakingLimitEnabled, setSpeakingLimitEnabled] = useState(room.speaking_limit_enabled ?? true);

  // Per-user speaking limit in seconds (default 60, host can set per participant)
  const [myLimitSecs, setMyLimitSecs] = useState(60);
  const myLimitSecsRef = useRef(myLimitSecs);
  myLimitSecsRef.current = myLimitSecs;

  // Meeting expiry: secondsLeft = null means no limit; negative = already expired
  const [secondsLeft, setSecondsLeft] = useState<number | null>(() => {
    if (!room.expires_at) return null;
    return Math.round((new Date(room.expires_at).getTime() - Date.now()) / 1000);
  });
  const warned5MinRef = useRef(false);

  // Role of the current user — fetched once on mount and updated on transfer
  const [myRole, setMyRole] = useState<RoleType>(room.host_id === currentUserId ? 'host' : 'member');

  // Video quality settings
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('medium');
  const [dataSaverMode, setDataSaverMode] = useState(false);
  const [applyingVideoConstraints, setApplyingVideoConstraints] = useState(false);
  // Tracks the currently applied quality (may differ from videoQuality when adaptive mode degrades it)
  const [adaptiveQuality, setAdaptiveQuality] = useState<VideoQuality>('medium');
  const adaptiveQualityRef = useRef(adaptiveQuality);
  adaptiveQualityRef.current = adaptiveQuality;

  useEffect(() => {
    supabase.from('conference_participants')
      .select('role')
      .eq('room_id', room.id)
      .eq('user_id', currentUserId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.role) setMyRole(data.role as RoleType);
      });
  }, [room.id, currentUserId]);

  const checkPermission = (perm: Permission): boolean => {
    const effectiveRole: RoleType = hostId === currentUserId ? 'host' : myRole;
    return ROLE_PERMISSIONS[effectiveRole]?.has(perm) ?? false;
  };

  // Stable wrapper around sendSignalRef so ChatPanel never holds a stale closure
  const sendSignalStable = useCallback((to: string | null, type: string, data: object) => {
    sendSignalRef.current(to, type, data);
  }, []);

  const toggleChatEnabled = useCallback(async () => {
    const next = !chatEnabled;
    setChatEnabled(next);
    sendSignalRef.current(null, 'chat_toggle', { enabled: next });
    await supabase.from('conference_rooms').update({ chat_enabled: next }).eq('id', room.id);
  }, [chatEnabled, room.id]);

  const toggleSpeakingLimit = useCallback(async () => {
    const next = !speakingLimitEnabled;
    setSpeakingLimitEnabled(next);
    await supabase.from('conference_rooms').update({ speaking_limit_enabled: next }).eq('id', room.id);
    toast(next ? 'محدودیت زمان صحبت فعال شد' : 'محدودیت زمان صحبت غیرفعال شد');
  }, [speakingLimitEnabled, room.id]);

  const ROLE_LABELS_REF = ROLE_LABELS;
  const ROLE_COLORS_REF = ROLE_COLORS;

  // Load pending approvals for host/admin
  useEffect(() => {
    if (!isHost && myRole !== 'admin') return;
    const loadApprovals = async () => {
      const { data } = await supabase
        .from('pending_approvals')
        .select('*')
        .eq('room_id', room.id)
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at');
      setPendingApprovals((data as PendingApproval[]) || []);
    };
    loadApprovals();
    const ch = supabase.channel(`conf-approvals-${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pending_approvals', filter: `room_id=eq.${room.id}` }, loadApprovals)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, isHost, myRole]);

  const approveUser = async (approvalId: string) => {
    await supabase.from('pending_approvals').update({ status: 'approved', approved_by: currentUserId }).eq('id', approvalId);
    setPendingApprovals(prev => prev.filter(a => a.id !== approvalId));
  };

  const rejectUser = async (approvalId: string) => {
    await supabase.from('pending_approvals').update({ status: 'rejected', approved_by: currentUserId }).eq('id', approvalId);
    setPendingApprovals(prev => prev.filter(a => a.id !== approvalId));
  };
  const [handRaiseQueue, setHandRaiseQueue] = useState<HandRaiseEntry[]>([]);

  // Pending approvals (host/admin view)
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  // Kick/ban action menu (null = closed)
  const [kickConfirm, setKickConfirm] = useState<KickConfirmData | null>(null);
  // Selected ban duration while waiting for reason input (undefined = not yet chosen)
  const [pendingBan, setPendingBan] = useState<PendingBanData | null>(null);
  const [banReason, setBanReason] = useState('');
  // Ban list visibility
  const [showBanList, setShowBanList] = useState(false);
  // Role change dropdown (peerId → open)
  const [roleDropdown, setRoleDropdown] = useState<string | null>(null);
  // Per-participant speaking limit editor (peerId → open)
  const [limitEditor, setLimitEditor] = useState<string | null>(null);
  const [limitInputs, setLimitInputs] = useState<Record<string, string>>({});

  const applyVideoConstraints = useCallback(async (quality: VideoQuality, dataSaver: boolean) => {
    const preset = VIDEO_QUALITY_PRESETS[dataSaver ? 'low' : quality];
    const frameRate = dataSaver ? 15 : preset.frameRate;
    const bitrate = calculateBitrate(preset.width, preset.height, frameRate);
    setApplyingVideoConstraints(true);
    try {
      // 1. تنظیم resolution/framerate روی local track
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        try {
          await videoTrack.applyConstraints({
            width: { ideal: preset.width },
            height: { ideal: preset.height },
            frameRate: { ideal: frameRate },
          });
        } catch {
          await videoTrack.applyConstraints({ frameRate: { ideal: frameRate } }).catch(() => {});
        }
      }
      // 2. تنظیم bitrate روی همه sender‌ها
      await Promise.all(Array.from(peersRef.current.values()).map(async (peer) => {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
        if (!sender) return;
        try {
          const params = sender.getParameters();
          if (!params.encodings || params.encodings.length === 0) params.encodings = [{}];
          params.encodings[0].maxBitrate = bitrate.max;
          params.encodings[0].maxFramerate = frameRate;
          await sender.setParameters(params);
        } catch { /* setParameters ممکن است در همه مرورگرها پشتیبانی نشود */ }
      }));
      toast.success('کیفیت ویدیو و پهنای باند بهینه شد');
    } catch {
      toast.error('خطا در تغییر کیفیت ویدیو');
    } finally {
      setApplyingVideoConstraints(false);
    }
  }, []);

  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const iceCandidateQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  const myPeerIdRef = useRef(myPeerId);
  const localStreamRef = useRef(localStream);
  const sidePanelRef = useRef(sidePanel);
  myPeerIdRef.current = myPeerId;
  localStreamRef.current = localStream;
  sidePanelRef.current = sidePanel;

  // Stable refs for adaptive bitrate interval (avoids stale closures)
  const applyVideoConstraintsRef = useRef<(q: VideoQuality, ds: boolean) => Promise<void>>(async () => {});
  const videoQualityRef = useRef(videoQuality);
  const dataSaverModeRef = useRef(dataSaverMode);
  videoQualityRef.current = videoQuality;
  dataSaverModeRef.current = dataSaverMode;
  // wire ref so adaptive bitrate interval always calls the latest version
  applyVideoConstraintsRef.current = applyVideoConstraints;

  // Duration + meeting countdown
  useEffect(() => {
    const t = setInterval(() => {
      setDuration(d => d + 1);
      if (room.expires_at) {
        const left = Math.round((new Date(room.expires_at).getTime() - Date.now()) / 1000);
        setSecondsLeft(left);
        if (!warned5MinRef.current && left > 0 && left <= 300) {
          warned5MinRef.current = true;
          toast('۵ دقیقه تا پایان جلسه باقی مانده', { icon: '⏰', duration: 6000 });
        }
        if (left <= 0 && left > -3) {
          toast.error('زمان جلسه به پایان رسید', { duration: 6000 });
        }
      }
    }, 1000);
    return () => clearInterval(t);
  }, [room.expires_at]);

  // Heartbeat
  useEffect(() => {
    const t = setInterval(async () => {
      await supabase.from('conference_participants')
        .update({ last_seen: new Date().toISOString() })
        .eq('room_id', room.id).eq('user_id', currentUserId).eq('status', 'joined');
    }, 15000);
    return () => clearInterval(t);
  }, [room.id, currentUserId]);

  // Speaking timer — tracks consecutive speaking seconds, auto-mutes at 60s
  const speakingSecsRef = useRef(0);
  const [speakingSecs, setSpeakingSecs] = useState(0);
  const speakingLimitEnabledRef = useRef(speakingLimitEnabled);
  speakingLimitEnabledRef.current = speakingLimitEnabled;

  useEffect(() => {
    if (!localStream.getAudioTracks().length) return;

    let ctx: AudioContext;
    try { ctx = new AudioContext(); } catch { return; }

    const source = ctx.createMediaStreamSource(localStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const INTERVAL = 500;
    const SPEAKING_THRESHOLD = 0.04;

    const t = setInterval(() => {
      // Skip measurement if muted
      if (mediaRef.current.isMuted) {
        speakingSecsRef.current = 0;
        setSpeakingSecs(0);
        return;
      }
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / (data.length * 255);
      if (avg > SPEAKING_THRESHOLD) {
        speakingSecsRef.current += INTERVAL / 1000;
        setSpeakingSecs(Math.floor(speakingSecsRef.current));
        if (speakingLimitEnabledRef.current && speakingSecsRef.current >= myLimitSecsRef.current) {
          // Auto-mute
          localStreamRef.current.getAudioTracks().forEach(tr => { tr.enabled = false; });
          dispatch({ type: 'FORCE_MUTE' });
          broadcastStateRef.current(true, mediaRef.current.isVideoOff, mediaRef.current.isHandRaised);
          toast.error('زمان صحبت شما تمام شد — میکروفون قطع شد', { duration: 5000, icon: '🎙️' });
          speakingSecsRef.current = 0;
          setSpeakingSecs(0);
        }
      } else {
        // Reset on silence
        speakingSecsRef.current = 0;
        setSpeakingSecs(0);
      }
    }, INTERVAL);

    return () => {
      clearInterval(t);
      ctx.close().catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localStream]);

  // Avatar fetch — loads profile photos for local user + any new peers
  useEffect(() => {
    const toFetch = [currentUserId, ...Array.from(peers.values()).map(p => p.userId)]
      .filter(uid => !fetchedAvatarUserIds.current.has(uid));
    if (!toFetch.length) return;
    toFetch.forEach(uid => fetchedAvatarUserIds.current.add(uid));
    supabase.from('profiles_public').select('user_id, avatar_url').in('user_id', toFetch)
      .then(({ data }) => {
        if (!data?.length) return;
        const map: Record<string, string> = {};
        data.forEach(p => { if (p.avatar_url) map[p.user_id] = p.avatar_url; });
        if (Object.keys(map).length) setPeerAvatarUrls(prev => ({ ...prev, ...map }));
      }).catch(() => {});
  }, [peers, currentUserId]);

  // RTT polling — every 3s read candidate-pair stats from each RTCPeerConnection
  useEffect(() => {
    const t = setInterval(async () => {
      const latencies: Record<string, number> = {};
      for (const [peerId, peer] of peersRef.current) {
        try {
          const stats = await peer.pc.getStats();
          stats.forEach(report => {
            if (
              report.type === 'candidate-pair' &&
              (report as any).state === 'succeeded' &&
              typeof (report as any).currentRoundTripTime === 'number'
            ) {
              latencies[peerId] = Math.round((report as any).currentRoundTripTime * 1000);
            }
          });
          // Update networkQuality on the PeerConnection object
          const rtt = latencies[peerId];
          if (rtt !== undefined && peersRef.current.has(peerId)) {
            peersRef.current.get(peerId)!.networkQuality =
              rtt < 100 ? 'excellent' : rtt < 200 ? 'good' : rtt < 400 ? 'fair' : 'poor';
          }
        } catch { /* ignore — pc may have been closed */ }
      }
      if (Object.keys(latencies).length) {
        setPeerLatencies(latencies);
        setPeers(new Map(peersRef.current)); // propagate updated networkQuality
        // Update local quality from average peer RTT
        const values = Object.values(latencies);
        if (values.length) {
          const avg = values.reduce((a, b) => a + b, 0) / values.length;
          setMyQuality(avg < 100 ? 'excellent' : avg < 200 ? 'good' : avg < 400 ? 'fair' : 'poor');
        }
      }
    }, 3000);
    return () => clearInterval(t);
  }, []);

  // Adaptive bitrate — هر 4 ثانیه packet loss را چک می‌کنیم و کیفیت را تنظیم می‌کنیم
  useEffect(() => {
    const QUALITIES: VideoQuality[] = ['low', 'medium', 'high'];
    const t = setInterval(async () => {
      for (const peer of peersRef.current.values()) {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
        if (!sender) continue;
        try {
          const stats = await sender.getStats();
          let sent = 0, retransmitted = 0;
          stats.forEach((report: any) => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              sent = report.packetsSent || 0;
              retransmitted = report.retransmittedPacketsSent || 0;
            }
          });
          if (sent < 10) continue;
          const lossRate = retransmitted / sent;
          const curQuality = adaptiveQualityRef.current;
          const curIdx = QUALITIES.indexOf(curQuality);
          if (lossRate > 0.05 && curIdx > 0) {
            const downgraded = QUALITIES[curIdx - 1];
            setAdaptiveQuality(downgraded);
            // applyVideoConstraints is defined later; use ref to avoid stale closure
            applyVideoConstraintsRef.current(downgraded, dataSaverModeRef.current);
            toast('کیفیت به دلیل ضعف شبکه کاهش یافت', { icon: '📉', duration: 4000 });
            break;
          } else if (lossRate < 0.01 && curIdx < QUALITIES.indexOf(videoQualityRef.current)) {
            const upgraded = QUALITIES[curIdx + 1];
            setAdaptiveQuality(upgraded);
            applyVideoConstraintsRef.current(upgraded, dataSaverModeRef.current);
            toast('کیفیت ویدیو بهبود یافت', { icon: '📈', duration: 3000 });
            break;
          }
        } catch { /* getStats ممکن است در برخی مرورگرها ناموجود باشد */ }
      }
    }, 4000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ── WebRTC helpers ─────────────────────────────────────────────────────────
  const sendSignal = useCallback((toPeerId: string | null, type: string, data: object) => {
    const payload = {
      from: myPeerIdRef.current,
      from_user_id: currentUserId,
      from_name: currentUserName,
      to: toPeerId,
      type,
      data,
    };
    channelRef.current?.send({ type: 'broadcast', event: 'signal', payload });
  }, [currentUserId, currentUserName, room.id]);

  const buildPC = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string): Promise<RTCPeerConnection> => {
    await rtcConfigReadyRef.current;
    console.log(`[WRTCDiag] buildPC → peer=${remotePeerId} name="${remoteDisplayName}" rtcConfig=`, JSON.stringify(rtcConfigRef.current));
    const pc = new RTCPeerConnection(rtcConfigRef.current);

    const localTracks = localStreamRef.current.getTracks();
    console.log(`[WRTCDiag] addTrack × ${localTracks.length} → peer=${remotePeerId}`, localTracks.map(t => `${t.kind}:${t.id}:enabled=${t.enabled}`));
    localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));

    // تنظیم اولویت codec پس از addTrack
    setPreferredCodecs(pc);

    pc.ontrack = (e) => {
      console.log(`[WRTCDiag] ontrack ← peer=${remotePeerId} track.kind=${e.track.kind} track.id=${e.track.id} streams.length=${e.streams.length} stream0_id=${e.streams[0]?.id ?? 'NONE'}`);
      const stream = e.streams[0];
      if (!stream) {
        console.warn(`[WRTCDiag] ontrack: e.streams[0] is undefined for peer=${remotePeerId} — stream will NOT be set`);
        return;
      }
      const cur = peersRef.current.get(remotePeerId);
      if (cur) {
        console.log(`[WRTCDiag] ontrack: setting stream on peer=${remotePeerId} stream.id=${stream.id} tracks=`, stream.getTracks().map(t => `${t.kind}:${t.id}`));
        peersRef.current.set(remotePeerId, { ...cur, stream }); setPeers(new Map(peersRef.current));
      } else {
        console.warn(`[WRTCDiag] ontrack: peer=${remotePeerId} NOT found in peersRef — stream dropped`);
      }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        console.log(
          `[WRTCDiag][ICE-OUT] peer=${remotePeerId}` +
          ` | type=${e.candidate.type}` +
          ` | protocol=${e.candidate.protocol}` +
          ` | address=${e.candidate.address}` +
          ` | port=${e.candidate.port}` +
          ` | candidate="${e.candidate.candidate}"`
        );
        sendSignal(remotePeerId, 'ice', { candidate: e.candidate.toJSON() });
      } else {
        console.log(`[WRTCDiag][ICE-OUT] gathering complete (null candidate) peer=${remotePeerId} iceGatheringState=${pc.iceGatheringState}`);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WRTCDiag][STATE] connectionState → peer=${remotePeerId} state=${pc.connectionState}`);
      const cur = peersRef.current.get(remotePeerId);
      if (cur) { peersRef.current.set(remotePeerId, { ...cur, connectionState: pc.connectionState }); setPeers(new Map(peersRef.current)); }
      if (pc.connectionState === 'connected') toast.success(`${remoteDisplayName} وارد شد`);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        pc.getStats().then(stats => {
          let selectedPairId: string | null = null;
          const candidates: Record<string, any> = {};
          const pairs: any[] = [];
          stats.forEach(r => {
            if (r.type === 'local-candidate') {
              candidates[r.id] = { dir: 'local', type: r.candidateType, protocol: r.protocol, address: r.address, port: r.port };
              console.log(`[WRTCDiag][STATS] local-candidate id=${r.id} type=${r.candidateType} protocol=${r.protocol} address=${r.address} port=${r.port}`);
            }
            if (r.type === 'remote-candidate') {
              candidates[r.id] = { dir: 'remote', type: r.candidateType, protocol: r.protocol, address: r.address, port: r.port };
              console.log(`[WRTCDiag][STATS] remote-candidate id=${r.id} type=${r.candidateType} protocol=${r.protocol} address=${r.address} port=${r.port}`);
            }
            if (r.type === 'candidate-pair') {
              pairs.push(r);
              if (r.nominated && r.state === 'succeeded') selectedPairId = r.id;
              console.log(
                `[WRTCDiag][STATS] candidate-pair id=${r.id}` +
                ` state=${r.state} nominated=${r.nominated}` +
                ` local=${r.localCandidateId} remote=${r.remoteCandidateId}` +
                ` bytesSent=${r.bytesSent ?? 'n/a'} bytesReceived=${r.bytesReceived ?? 'n/a'}` +
                ` RTT=${r.currentRoundTripTime ?? 'n/a'} totalRTT=${r.totalRoundTripTime ?? 'n/a'}`
              );
            }
          });
          if (selectedPairId) {
            const pair = pairs.find(p => p.id === selectedPairId);
            const lc = pair ? candidates[pair.localCandidateId]  : null;
            const rc = pair ? candidates[pair.remoteCandidateId] : null;
            console.log(
              `[WRTCDiag][STATS] SELECTED PAIR peer=${remotePeerId}` +
              ` | local=${lc?.type}/${lc?.protocol}/${lc?.address}:${lc?.port}` +
              ` | remote=${rc?.type}/${rc?.protocol}/${rc?.address}:${rc?.port}` +
              ` | bytesSent=${pair?.bytesSent} bytesReceived=${pair?.bytesReceived} RTT=${pair?.currentRoundTripTime}`
            );
          } else {
            console.warn(
              `[WRTCDiag][STATS] NO selected candidate-pair peer=${remotePeerId}` +
              ` | total_pairs=${pairs.length}` +
              ` | pair_states: [${pairs.map(p => `${p.id}:${p.state}(nominated=${p.nominated})`).join(', ')}]`
            );
          }
        }).catch(err => console.warn(`[WRTCDiag][STATS] getStats failed peer=${remotePeerId}`, err));
      }
      if (pc.connectionState === 'disconnected') {
        // First try ICE restart before giving up
        setTimeout(async () => {
          if (pc.connectionState !== 'disconnected' && pc.connectionState !== 'failed') return;
          const restarted = await attemptICERestart(pc, (offer) => {
            sendSignalRef.current(remotePeerId, 'offer', { sdp: offer, iceRestart: true });
          });
          if (!restarted) {
            // ICE restart not possible — wait a bit more then clean up
            setTimeout(() => {
              if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
                stopDiagnostics(remotePeerId);
                pc.close();
                peersRef.current.delete(remotePeerId);
                setPeers(new Map(peersRef.current));
                sendSignalRef.current(null, 'peer_left', { peerId: remotePeerId, displayName: remoteDisplayName });
                supabase.from('conference_participants')
                  .update({ status: 'left', left_at: new Date().toISOString() })
                  .eq('room_id', room.id).eq('user_id', remoteUserId)
                  .then(() => {});
              }
            }, 15000);
          }
        }, 5000);
      }
      if (pc.connectionState === 'failed') {
        stopDiagnostics(remotePeerId);
        setTimeout(() => { if (pc.connectionState === 'failed') { pc.close(); peersRef.current.delete(remotePeerId); setPeers(new Map(peersRef.current)); } }, 2000);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      console.log(`[WRTCDiag][STATE] iceConnectionState → peer=${remotePeerId} state=${s}`);
      if (s === 'failed') {
        console.warn(`[WRTCDiag][ICE-FAIL] iceConnectionState=failed peer=${remotePeerId} — dumping getStats`);
        pc.getStats().then(stats => {
          stats.forEach(r => {
            if (r.type === 'candidate-pair') {
              console.warn(
                `[WRTCDiag][ICE-FAIL] candidate-pair id=${r.id}` +
                ` state=${r.state} nominated=${r.nominated}` +
                ` writable=${r.writable} priority=${r.priority}` +
                ` bytesSent=${r.bytesSent ?? 0} bytesReceived=${r.bytesReceived ?? 0}`
              );
            }
          });
        }).catch(() => {});
      }
    };

    pc.onsignalingstatechange = () => {
      console.log(`[WRTCDiag][STATE] signalingState → peer=${remotePeerId} state=${pc.signalingState}`);
    };

    pc.onicegatheringstatechange = () => {
      console.log(`[WRTCDiag][STATE] iceGatheringState → peer=${remotePeerId} state=${pc.iceGatheringState}`);
    };

    const conn: PeerConnection = { peerId: remotePeerId, userId: remoteUserId, displayName: remoteDisplayName, pc, stream: null, screenStream: null, isScreenSharing: false, isMuted: false, isVideoOff: false, isHandRaised: false, connectionState: 'new', networkQuality: 'good', speakingSeconds: 0, audioLevel: 0 };
    peersRef.current.set(remotePeerId, conn);
    setPeers(new Map(peersRef.current));

    // Start diagnostics — update state every 5s
    startDiagnostics(pc, remotePeerId, (d) => {
      setPeerDiagnostics(prev => new Map(prev).set(remotePeerId, d));
    });

    return pc;
  }, [sendSignal]);

  const getPC = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string): Promise<RTCPeerConnection> => {
    const cur = peersRef.current.get(remotePeerId);
    if (cur && cur.pc.connectionState !== 'failed' && cur.pc.connectionState !== 'closed') return cur.pc;
    return buildPC(remotePeerId, remoteUserId, remoteDisplayName);
  }, [buildPC]);

  const flushICE = useCallback(async (remotePeerId: string) => {
    const q = iceCandidateQueue.current.get(remotePeerId) || [];
    console.log(`[WRTCDiag][ICE-FLUSH] peer=${remotePeerId} queued=${q.length} hasRemoteDesc=${!!peersRef.current.get(remotePeerId)?.pc?.remoteDescription}`);
    if (!q.length) return;
    const pc = peersRef.current.get(remotePeerId)?.pc;
    if (!pc?.remoteDescription) return;
    for (const c of q) {
      console.log(
        `[WRTCDiag][ICE-FLUSH] addIceCandidate peer=${remotePeerId}` +
        ` | typeof=${typeof c}` +
        ` | json=${JSON.stringify(c)}`
      );
      await pc.addIceCandidate(new RTCIceCandidate(c)).then(() => {
        console.log(`[WRTCDiag][ICE-FLUSH] addIceCandidate SUCCESS peer=${remotePeerId}`);
      }).catch((err) => {
        console.warn(`[WRTCDiag][ICE-FLUSH] addIceCandidate FAILED peer=${remotePeerId}`, err);
      });
    }
    iceCandidateQueue.current.delete(remotePeerId);
    console.log(`[WRTCDiag][ICE-FLUSH] done — flushed ${q.length} candidates for peer=${remotePeerId}`);
  }, []);

  const makeOffer = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string) => {
    const pc = await getPC(remotePeerId, remoteUserId, remoteDisplayName);
    console.log(`[WRTCDiag] makeOffer → peer=${remotePeerId} signalingState=${pc.signalingState}`);
    if (pc.signalingState !== 'stable') {
      console.warn(`[WRTCDiag] makeOffer SKIPPED — signalingState=${pc.signalingState} peer=${remotePeerId}`);
      return;
    }
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      console.log(`[WRTCDiag] makeOffer: offer created and set, SENDING to peer=${remotePeerId}`);
      sendSignalRef.current(remotePeerId, 'offer', { sdp: pc.localDescription });
    } catch (e) { console.error('makeOffer failed', e); }
  }, [getPC]);

  // Stable refs — updated every render
  const makeOfferRef = useRef(makeOffer);
  const sendSignalRef = useRef(sendSignal);
  const getPCRef = useRef(getPC);
  const flushICERef = useRef(flushICE);
  const stopScreenShareRef = useRef<() => void>(() => {});
  const showTileReactionRef = useRef<(userId: string, emoji: string) => void>(() => {});
  makeOfferRef.current = makeOffer;
  sendSignalRef.current = sendSignal;
  getPCRef.current = getPC;
  flushICERef.current = flushICE;

  // ── Channel setup ──────────────────────────────────────────────────────────
  useEffect(() => {
    const ch = supabase.channel(`conf-${room.id}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = ch;

    ch.on('broadcast', { event: 'signal' }, ({ payload }) => {
      if (payload.to !== null && payload.to !== myPeerIdRef.current) return;
      if (payload.from === myPeerIdRef.current) return;
      const { from, from_user_id, from_name, type, data } = payload;

      (async () => {
        if (type === 'join') {
          console.log(`[WRTCDiag] RECV join ← from=${from} name="${from_name}" myPeerId=${myPeerIdRef.current} willOffer=${myPeerIdRef.current < from}`);
          // Reject new peers if room is at capacity
          if (peersRef.current.size >= MAX_PARTICIPANTS - 1) {
            console.warn(`[WebRTC] Ignoring join from ${from_name} — room at capacity (${MAX_PARTICIPANTS})`);
            return;
          }
          if (myPeerIdRef.current < from) {
            await makeOfferRef.current(from, from_user_id, from_name);
          } else {
            await getPCRef.current(from, from_user_id, from_name);
          }

        } else if (type === 'offer') {
          console.log(`[WRTCDiag] RECV offer ← from=${from} name="${from_name}" iceRestart=${data.iceRestart ?? false}`);
          const pc = await getPCRef.current(from, from_user_id, from_name);
          console.log(`[WRTCDiag] offer: pc.signalingState=${pc.signalingState} peer=${from}`);
          try {
            if (pc.signalingState === 'have-local-offer') {
              if (myPeerIdRef.current < from) {
                console.log(`[WRTCDiag] offer: rollback local offer for peer=${from}`);
                await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
              } else {
                console.warn(`[WRTCDiag] offer: SKIPPED (glare resolution) peer=${from} myPeerId=${myPeerIdRef.current}`);
                return;
              }
            }
            if (pc.signalingState !== 'stable') {
              console.warn(`[WRTCDiag] offer: SKIPPED signalingState=${pc.signalingState} peer=${from}`);
              return;
            }
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            console.log(`[WRTCDiag] offer: setRemoteDescription done, creating answer for peer=${from}`);
            await flushICERef.current(from);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            console.log(`[WRTCDiag] SEND answer → to=${from}`);
            sendSignalRef.current(from, 'answer', { sdp: pc.localDescription });
          } catch (e) { console.error('offer error', e); }

        } else if (type === 'answer') {
          console.log(`[WRTCDiag] RECV answer ← from=${from} signalingState=${peersRef.current.get(from)?.pc.signalingState}`);
          const cur = peersRef.current.get(from);
          if (cur?.pc.signalingState === 'have-local-offer') {
            try {
              await cur.pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
              console.log(`[WRTCDiag] answer: setRemoteDescription done for peer=${from}`);
              await flushICERef.current(from);
            }
            catch (e) { console.error('answer error', e); }
          } else {
            console.warn(`[WRTCDiag] answer: IGNORED — pc not found or signalingState=${peersRef.current.get(from)?.pc.signalingState} for peer=${from}`);
          }

        } else if (type === 'ice') {
          const cur = peersRef.current.get(from);
          if (cur?.pc) {
            if (cur.pc.remoteDescription) {
              console.log(
                `[WRTCDiag][ICE-IN] RECV ice peer=${from} → addIceCandidate` +
                ` | typeof_data.candidate=${typeof data.candidate}` +
                ` | json=${JSON.stringify(data.candidate)}`
              );
              cur.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).then(() => {
                console.log(`[WRTCDiag][ICE-IN] addIceCandidate SUCCESS peer=${from}`);
              }).catch((err) => {
                console.warn(`[WRTCDiag][ICE-IN] addIceCandidate FAILED peer=${from}`, err);
              });
            } else {
              console.log(
                `[WRTCDiag][ICE-IN] RECV ice peer=${from} → QUEUED (no remoteDesc)` +
                ` | typeof_data.candidate=${typeof data.candidate}` +
                ` | json=${JSON.stringify(data.candidate)}`
              );
              const q = iceCandidateQueue.current.get(from) || [];
              q.push(data.candidate);
              iceCandidateQueue.current.set(from, q);
            }
          } else {
            console.warn(`[WRTCDiag][ICE-IN] RECV ice peer=${from} → DROPPED (no pc found) json=${JSON.stringify(data.candidate)}`);
          }

        } else if (type === 'leave') {
          const cur = peersRef.current.get(from);
          if (cur) { cur.pc.close(); peersRef.current.delete(from); setPeers(new Map(peersRef.current)); toast(`${from_name} جلسه را ترک کرد`); }

        } else if (type === 'peer_left') {
          const targetPeerId = data.peerId as string;
          const cur = peersRef.current.get(targetPeerId);
          if (cur) { cur.pc.close(); peersRef.current.delete(targetPeerId); setPeers(new Map(peersRef.current)); }

        } else if (type === 'end') {
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          toast.error('میزبان جلسه را پایان داد');
          onLeave();

        } else if (type === 'state') {
          const cur = peersRef.current.get(from);
          if (cur) {
            const wasHandRaised = cur.isHandRaised;
            peersRef.current.set(from, { ...cur, isMuted: data.isMuted, isVideoOff: data.isVideoOff, isHandRaised: data.isHandRaised });
            setPeers(new Map(peersRef.current));
            // Update hand raise queue on state changes
            if (data.isHandRaised && !wasHandRaised) {
              setHandRaiseQueue(q => [...q.filter(e => e.peerId !== from), { peerId: from, name: from_name, time: Date.now() }]);
            } else if (!data.isHandRaised && wasHandRaised) {
              setHandRaiseQueue(q => q.filter(e => e.peerId !== from));
            }
          }

        } else if (type === 'chat') {
          setMessages(prev => [...prev, data]);
          if (sidePanelRef.current !== 'chat') setUnreadCount(c => c + 1);

        } else if (type === 'reaction') {
          const r: Reaction = { ...data, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20, createdAt: Date.now(), expiresAt: Date.now() + 3000 };
          setReactions(prev => [...prev, r]);
          setTimeout(() => setReactions(prev => prev.filter(x => x.id !== r.id)), 3000);
          showTileReactionRef.current(data.userId, data.emoji);

        } else if (type === 'host_mute_all') {
          localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
          dispatch({ type: 'FORCE_MUTE' });
          toast('میزبان درخواست قطع میکروفون داد');

        } else if (type === 'lower_hand') {
          // Host asked us to lower our hand
          dispatch({ type: 'SET_HAND', value: false });
          broadcastStateRef.current(mediaRef.current.isMuted, mediaRef.current.isVideoOff, false);
          toast('میزبان دست شما را پایین آورد');

        } else if (type === 'host_transfer') {
          setHostId(data.newHostUserId as string);
          if (data.newHostUserId === currentUserId) {
            setMyRole('host');
            toast.success('شما به عنوان میزبان جدید انتخاب شدید');
          } else {
            toast(`میزبانی به ${data.newHostName} منتقل شد`);
          }

        } else if (type === 'kick') {
          toast.error('شما توسط میزبان از جلسه خارج شدید');
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          onLeave();

        } else if (type === 'role_change') {
          if (data.targetUserId === currentUserId) {
            setMyRole(data.newRole as RoleType);
            const labels: Record<string, string> = { admin: 'مدیر', moderator: 'ناظر', member: 'عضو', guest: 'مهمان', host: 'میزبان' };
            toast(`نقش شما به "${labels[data.newRole] || data.newRole}" تغییر یافت`);
          }
        } else if (type === 'chat_toggle') {
          setChatEnabled(data.enabled as boolean);
        } else if (type === 'speaking_limit_change') {
          if (data.targetUserId === currentUserId) {
            const secs = Math.max(10, Math.min(600, Number(data.limitSecs) || 60));
            setMyLimitSecs(secs);
            toast(`محدودیت صحبت شما به ${secs} ثانیه تغییر یافت`);
          }
        }
      })();
    })
    .subscribe(async (status) => {
      console.log(`[WRTCDiag] channel conf-${room.id} subscribe status=${status} myPeerId=${myPeerIdRef.current}`);
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // Realtime channel dropped — rejoin after a short delay
        setTimeout(() => ch.subscribe(), 3000);
        return;
      }
      if (status !== 'SUBSCRIBED') return;

      console.log(`[WRTCDiag] SEND join → broadcast myPeerId=${myPeerId} userId=${currentUserId}`);
      sendSignalRef.current(null, 'join', { userId: currentUserId, displayName: currentUserName, peerId: myPeerId });

      await new Promise(r => setTimeout(r, 500));

      const { data: existing } = await supabase
        .from('conference_participants')
        .select('user_id, display_name, peer_id')
        .eq('room_id', room.id)
        .eq('status', 'joined')
        .neq('user_id', currentUserId);

      console.log(`[WRTCDiag] existing participants from DB: count=${existing?.length ?? 0}`, existing?.map(p => `peer=${p.peer_id} user=${p.user_id}`));

      if (existing) {
        for (const p of existing) {
          if (!p.peer_id || p.peer_id === myPeerId) {
            console.log(`[WRTCDiag] skipping existing participant peer_id=${p.peer_id} (null or self)`);
            continue;
          }
          console.log(`[WRTCDiag] existing participant peer=${p.peer_id} myPeerId=${myPeerIdRef.current} willOffer=${myPeerIdRef.current < p.peer_id}`);
          if (myPeerIdRef.current < p.peer_id) {
            await makeOfferRef.current(p.peer_id, p.user_id, p.display_name);
          } else {
            const existingPC = await getPCRef.current(p.peer_id, p.user_id, p.display_name);
            setTimeout(async () => {
              console.log(`[WRTCDiag] delayed offer check for peer=${p.peer_id} hasRemoteDesc=${!!existingPC.remoteDescription} signalingState=${existingPC.signalingState}`);
              if (!existingPC.remoteDescription && existingPC.signalingState === 'stable') {
                await makeOfferRef.current(p.peer_id, p.user_id, p.display_name);
              }
            }, 1500);
          }
        }
      }
    });

    const roomCh = supabase.channel(`room-status-${room.id}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'conference_rooms',
        filter: `id=eq.${room.id}`,
      }, ({ new: row }) => {
        if (row.status === 'ended') {
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          toast.error('میزبان جلسه را پایان داد');
          onLeave();
        }
        // Sync host transfers that came through DB
        if (row.host_id && row.host_id !== room.host_id) {
          setHostId(row.host_id as string);
        }
        // Sync runtime chat toggle
        if (typeof row.chat_enabled === 'boolean') {
          setChatEnabled(row.chat_enabled);
        }
        // Sync speaking limit toggle
        if (typeof row.speaking_limit_enabled === 'boolean') {
          setSpeakingLimitEnabled(row.speaking_limit_enabled);
        }
      })
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'room_mod_actions',
        filter: `room_id=eq.${room.id}`,
      }, ({ new: row }) => {
        if (row.target_user_id !== currentUserId) return;
        if (row.action_type === 'kick') {
          toast.error('شما توسط میزبان از جلسه خارج شدید');
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          onLeave();
        } else if (row.action_type === 'mute') {
          localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
          dispatch({ type: 'FORCE_MUTE' });
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
      supabase.removeChannel(roomCh);
      for (const p of peersRef.current.values()) p.pc.close();
      peersRef.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id]);

  // Participants list for UI
  const [participants, setParticipants] = useState<ConferenceParticipant[]>([]);
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('conference_participants').select('*').eq('room_id', room.id).eq('status', 'joined');
      if (data) setParticipants(data as ConferenceParticipant[]);
    };
    load();
    const ch = supabase.channel(`conf-parts-${room.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_participants', filter: `room_id=eq.${room.id}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [room.id]);


  // Quality
  useEffect(() => {
    const t = setInterval(async () => {
      let loss = 0, cnt = 0;
      for (const p of peersRef.current.values()) {
        try { const st = await p.pc.getStats(); st.forEach((s: any) => { if (s.type === 'inbound-rtp') { const tot = (s.packetsReceived||0)+(s.packetsLost||0); if (tot>0){loss+=(s.packetsLost||0)/tot*100;cnt++;} } }); } catch { /**/ }
      }
      const avg = cnt > 0 ? loss/cnt : 0;
      setMyQuality(avg<1?'excellent':avg<5?'good':avg<15?'fair':'poor');
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // ── Controls ───────────────────────────────────────────────────────────────
  const broadcastState = useCallback((muted: boolean, videoOff: boolean, handRaised: boolean) => {
    sendSignal(null, 'state', { peerId: myPeerId, isMuted: muted, isVideoOff: videoOff, isHandRaised: handRaised });
    supabase.from('conference_participants')
      .update({ is_muted: muted, is_video_off: videoOff, is_hand_raised: handRaised })
      .eq('room_id', room.id).eq('user_id', currentUserId)
      .then(({ error }) => { if (error) console.error('broadcastState DB error:', error); });
  }, [sendSignal, myPeerId, room.id, currentUserId]);

  // Stable ref so it's usable inside channel callbacks without stale closure
  const broadcastStateRef = useRef(broadcastState);
  broadcastStateRef.current = broadcastState;

  const toggleMute = () => {
    const n = !isMuted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !n; });
    dispatch({ type: 'TOGGLE_MUTE' });
    broadcastState(n, isVideoOff, isHandRaised);
    if (!n) { speakingSecsRef.current = 0; setSpeakingSecs(0); }
  };

  const toggleVideo = () => {
    const n = !isVideoOff;
    localStream.getVideoTracks().forEach(t => { t.enabled = !n; });
    dispatch({ type: 'TOGGLE_VIDEO' });
    broadcastState(isMuted, n, isHandRaised);
  };

  const toggleHand = () => {
    const n = !isHandRaised;
    dispatch({ type: 'TOGGLE_HAND' });
    broadcastState(isMuted, isVideoOff, n);
    if (n) toast('دست شما بلند شد');
  };

  const startScreenShare = async () => {
    try {
      const ss = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = ss;
      const screenVideoTrack = ss.getVideoTracks()[0];
      const screenAudioTrack = ss.getAudioTracks()[0] ?? null;

      for (const p of peersRef.current.values()) {
        const videoSender = p.pc.getSenders().find(s => s.track?.kind === 'video');
        let needsRenegotiation = false;

        if (videoSender) {
          await videoSender.replaceTrack(screenVideoTrack).catch(err => console.error('replaceTrack video error:', err));
        } else {
          p.pc.addTrack(screenVideoTrack, localStreamRef.current);
          needsRenegotiation = true;
        }

        if (screenAudioTrack) {
          const audioSender = p.pc.getSenders().find(s => s.track?.kind === 'audio');
          if (!audioSender) {
            p.pc.addTrack(screenAudioTrack, ss);
            needsRenegotiation = true;
          }
        }

        if (needsRenegotiation && p.pc.signalingState === 'stable') {
          try {
            const offer = await p.pc.createOffer();
            await p.pc.setLocalDescription(offer);
            sendSignalRef.current(p.peerId, 'offer', { sdp: p.pc.localDescription });
          } catch (e) { console.error('renegotiation after addTrack failed', e); }
        }
      }

      dispatch({ type: 'SET_SCREEN_SHARING', value: true });
      sendSignal(null, 'state', { peerId: myPeerId, isMuted, isVideoOff, isHandRaised, isScreenSharing: true });

      screenVideoTrack.onended = () => stopScreenShareRef.current();
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        toast.error(
          'دسترسی به اشتراک‌گذاری صفحه رد شد.\nدر تنظیمات مرورگر، دسترسی صفحه نمایش را فعال کنید.',
          { duration: 6000 }
        );
      } else if (e?.name === 'TypeError') {
        toast.error('مرورگر شما از اشتراک‌گذاری صفحه پشتیبانی نمی‌کند. لطفاً Chrome یا Edge را امتحان کنید.');
      } else if (e?.name === 'NotFoundError') {
        toast.error('صفحه‌ای برای اشتراک‌گذاری یافت نشد.');
      } else if (e?.name !== 'AbortError') {
        toast.error('خطا در اشتراک‌گذاری صفحه. دوباره تلاش کنید.', { duration: 4000 });
      }
    }
  };

  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    const camTrack = localStreamRef.current.getVideoTracks()[0] ?? null;

    for (const p of peersRef.current.values()) {
      const sender = p.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        if (camTrack) {
          camTrack.enabled = !mediaRef.current.isVideoOff;
          await sender.replaceTrack(camTrack).catch(() => {});
        } else {
          await sender.replaceTrack(null).catch(() => {});
        }
      }
    }

    dispatch({ type: 'SET_SCREEN_SHARING', value: false });
    // Use ref so this is never stale when called from screenTrack.onended
    const { isMuted: m, isVideoOff: v, isHandRaised: h } = mediaRef.current;
    broadcastStateRef.current(m, v, h);
  }, []);

  stopScreenShareRef.current = stopScreenShare;

  const showTileReaction = useCallback((userId: string, emoji: string) => {
    setTileReactions(prev => new Map(prev).set(userId, emoji));
    setTimeout(() => {
      setTileReactions(prev => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    }, 3000);
  }, []);
  showTileReactionRef.current = showTileReaction;

  const sendEmoji = (emoji: string) => {
    setShowEmojiPicker(false);
    const r: Reaction = { id: crypto.randomUUID(), userId: currentUserId, displayName: currentUserName, emoji, x: 0, y: 0, createdAt: Date.now(), expiresAt: Date.now() + 3000 };
    sendSignal(null, 'reaction', r);
    setReactions(prev => [...prev, { ...r, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20 }]);
    setTimeout(() => setReactions(prev => prev.filter(x => x.id !== r.id)), 3000);
    showTileReaction(currentUserId, emoji);
  };


  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showAllControls, setShowAllControls] = useState(false);

  // Close role dropdown and limit editor when clicking outside
  useEffect(() => {
    if (!roleDropdown && !limitEditor) return;
    const handler = () => { setRoleDropdown(null); setLimitEditor(null); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [roleDropdown, limitEditor]);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // Persist layout + tile order
  useEffect(() => {
    try { localStorage.setItem(`conf_layout_${room.id}`, layoutMode); } catch {}
  }, [layoutMode, room.id]);

  useEffect(() => {
    try { localStorage.setItem(`conf_tile_order_${room.id}`, JSON.stringify(tileOrder)); } catch {}
  }, [tileOrder, room.id]);

  // ── Host management ────────────────────────────────────────────────────────
  const muteAll = async () => {
    sendSignal(null, 'host_mute_all', { fromHost: currentUserName });
    for (const p of peersRef.current.values()) {
      await supabase.from('room_mod_actions').insert({
        room_id: room.id, by_admin_id: currentUserId,
        target_user_id: p.userId, action_type: 'mute',
      });
    }
    toast.success('درخواست قطع میکروفون برای همه ارسال شد');
  };

  const kickParticipant = async (peerId: string, targetUserId: string, displayName: string) => {
    sendSignal(peerId, 'kick', { fromHost: currentUserName });
    const { error } = await supabase.from('room_mod_actions').insert({
      room_id: room.id, by_admin_id: currentUserId,
      target_user_id: targetUserId, action_type: 'kick',
    });
    if (error) console.error('kick mod_action error:', error);
    await supabase.from('conference_participants')
      .update({ status: 'left', left_at: new Date().toISOString() })
      .eq('room_id', room.id).eq('user_id', targetUserId);
    setTimeout(() => {
      const cur = peersRef.current.get(peerId);
      if (cur) { cur.pc.close(); peersRef.current.delete(peerId); setPeers(new Map(peersRef.current)); }
    }, 500);
    toast.success(`${displayName} از جلسه خارج شد`);
  };

  // durationMinutes = null → مسدودی دائمی
  const banParticipant = async (
    targetPeerId: string, targetUserId: string, displayName: string,
    durationMinutes: number | null,
    reason?: string,
  ) => {
    const expiresAt = durationMinutes != null
      ? new Date(Date.now() + durationMinutes * 60_000).toISOString()
      : null;

    await supabase.from('banned_users').upsert([{
      room_id: room.id, user_id: targetUserId,
      display_name: displayName, banned_by: currentUserId,
      expires_at: expiresAt,
      reason: reason?.trim() || null,
    }], { onConflict: 'room_id,user_id' });

    await kickParticipant(targetPeerId, targetUserId, displayName);

    const label = durationMinutes == null
      ? 'دائمی'
      : durationMinutes < 60 ? `${durationMinutes} دقیقه` : `${durationMinutes / 60} ساعت`;
    toast.success(`${displayName} مسدود شد (${label})`);
  };

  const changeRole = async (_targetPeerId: string, targetUserId: string, displayName: string, newRole: RoleType) => {
    const { error } = await supabase.from('conference_participants')
      .update({ role: newRole })
      .eq('room_id', room.id)
      .eq('user_id', targetUserId);
    if (error) { toast.error('خطا در تغییر نقش'); return; }
    sendSignal(null, 'role_change', { targetUserId, newRole });
    setRoleDropdown(null);
    toast.success(`نقش ${displayName} به "${ROLE_LABELS[newRole]}" تغییر یافت`);
  };
  const lowerHand = (peerId: string) => {
    sendSignal(peerId, 'lower_hand', { fromHost: currentUserName });
    setHandRaiseQueue(q => q.filter(e => e.peerId !== peerId));
  };

  // Transfer host to another participant
  const transferHost = async (targetPeerId: string, targetUserId: string, targetName: string) => {
    sendSignal(null, 'host_transfer', { newHostUserId: targetUserId, newHostName: targetName });
    const { error } = await supabase.from('conference_rooms')
      .update({ host_id: targetUserId })
      .eq('id', room.id);
    if (error) { console.error('transferHost error:', error); toast.error('خطا در انتقال میزبانی'); return; }
    setHostId(targetUserId);
    // Remove from hand queue if they had hand raised
    setHandRaiseQueue(q => q.filter(e => e.peerId !== targetPeerId));
    toast.success(`میزبانی به ${targetName} منتقل شد`);
  };

  const doLeave = async (endRoom: boolean) => {
    setShowLeaveConfirm(false);
    if (endRoom) {
      sendSignalRef.current(null, 'end', { displayName: currentUserName });
      const { error } = await supabase.from('conference_rooms').update({ status: 'ended', ended_at: new Date().toISOString() }).eq('id', room.id);
      if (error) console.error('doLeave end room error:', error);
    } else {
      sendSignalRef.current(null, 'leave', { displayName: currentUserName });
    }
    for (const p of peersRef.current.values()) p.pc.close();
    peersRef.current.clear();
    stopAllDiagnostics();
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (channelRef.current) { supabase.removeChannel(channelRef.current); channelRef.current = null; }
    const { error: leaveErr } = await supabase.from('conference_participants').update({ status: 'left', left_at: new Date().toISOString() }).eq('room_id', room.id).eq('user_id', currentUserId);
    if (leaveErr) console.error('doLeave participant update error:', leaveErr);
    onLeave();
  };

  const leaveRoom = () => {
    if (isHost) { setShowLeaveConfirm(true); } else { doLeave(false); }
  };

  const copyCode = () => { navigator.clipboard.writeText(room.code); setCodeCopied(true); setTimeout(() => setCodeCopied(false), 2000); };
  const togglePanel = (p: SidePanel) => { setSidePanel(s => s === p ? null : p); if (p === 'chat') setUnreadCount(0); };

  // ── Tiles ──────────────────────────────────────────────────────────────────
  const allTiles = [
    { peerId: myPeerId, userId: currentUserId, displayName: currentUserName, stream: localStream, isMuted, isVideoOff, isHandRaised, isLocal: true, isHost, networkQuality: myQuality, avatarUrl: peerAvatarUrls[currentUserId], pingMs: undefined as number | undefined },
    ...Array.from(peers.values()).map(p => ({ peerId: p.peerId, userId: p.userId, displayName: p.displayName, stream: p.stream, isMuted: p.isMuted, isVideoOff: p.isVideoOff, isHandRaised: p.isHandRaised, isLocal: false, isHost: hostId === p.userId, networkQuality: p.networkQuality, avatarUrl: peerAvatarUrls[p.userId], pingMs: peerLatencies[p.peerId] })),
  ];


  // Sorted hand raise queue (earliest first)
  const sortedQueue = [...handRaiseQueue].sort((a, b) => a.time - b.time);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col bg-gray-950 text-white select-none relative ${isFullscreen ? 'fixed inset-0 z-[9999]' : 'h-full'}`} dir="rtl">
      <RoomBackground />
      {/* All content is above z-0 */}
      <div className="relative z-10 flex flex-col h-full">

      {/* Top bar */}
      <TopBar
        room={room}
        duration={duration}
        secondsLeft={secondsLeft}
        fmt={fmt}
        myQuality={myQuality}
        qualityColor={qualityColor}
        onInvite={onInvite}
        copyCode={copyCode}
        codeCopied={codeCopied}
        layoutMode={layoutMode}
        setLayoutMode={setLayoutMode}
        isFullscreen={isFullscreen}
        setIsFullscreen={setIsFullscreen}
        participantCount={allTiles.length}
      />

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative">
        {/* Video area */}
        <div className="flex-1 flex flex-col overflow-hidden p-2 gap-2 min-w-0 relative">
          <VideoArea
            allTiles={allTiles}
            tileOrder={tileOrder}
            setTileOrder={setTileOrder}
            pinnedPeerId={pinnedPeerId}
            setPinnedPeerId={setPinnedPeerId}
            layoutMode={layoutMode}
            tileReactions={tileReactions}
            dragSrcRef={dragSrcRef}
          />
        </div>

        {/* Side panel */}
        <SidePanelContainer
          sidePanel={sidePanel}
          setSidePanel={setSidePanel}
          togglePanel={togglePanel}
          isMobile={isMobile}
          room={room}
          messages={messages}
          chatEnabled={chatEnabled}
          canToggleChat={checkPermission('toggle_chat')}
          onToggleChat={toggleChatEnabled}
          sendSignalStable={sendSignalStable}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          onOwnMessage={msg => setMessages(prev => [...prev, msg])}
          allTiles={allTiles}
          participants={participants}
          myRole={myRole}
          isHost={isHost}
          hostId={hostId}
          myPeerId={myPeerId}
          currentUserNameForPanel={currentUserName}
          pinnedPeerId={pinnedPeerId}
          setPinnedPeerId={setPinnedPeerId}
          sortedQueue={sortedQueue}
          pendingApprovals={pendingApprovals}
          onApprove={approveUser}
          onReject={rejectUser}
          peersSize={peers.size}
          showBanList={showBanList}
          setShowBanList={setShowBanList}
          checkPermission={checkPermission}
          muteAll={muteAll}
          lowerHand={lowerHand}
          changeRole={changeRole}
          transferHost={transferHost}
          setKickConfirm={setKickConfirm}
          setPendingBan={setPendingBan}
          setBanReason={setBanReason}
          roleDropdown={roleDropdown}
          setRoleDropdown={setRoleDropdown}
          limitEditor={limitEditor}
          setLimitEditor={setLimitEditor}
          limitInputs={limitInputs}
          setLimitInputs={setLimitInputs}
          sendSignalRef={sendSignalRef}
          speakingLimitEnabled={speakingLimitEnabled}
          tileReactions={tileReactions}
          roomId={room.id}
          videoQuality={videoQuality}
          dataSaverMode={dataSaverMode}
          applyingVideoConstraints={applyingVideoConstraints}
          onChangeQuality={(q) => { setVideoQuality(q); applyVideoConstraints(q, dataSaverMode); }}
          onToggleDataSaver={() => { const next = !dataSaverMode; setDataSaverMode(next); applyVideoConstraints(videoQuality, next); }}
          onToggleSpeakingLimit={toggleSpeakingLimit}
          myQuality={myQuality}
          peers={peers}
          peerDiagnostics={peerDiagnostics}
          qualityColor={qualityColor}
        />
      </div>

      {/* Overlays, modals, and bottom controls */}
      <RoomOverlays
        kickConfirm={kickConfirm}
        pendingBan={pendingBan}
        banReason={banReason}
        setBanReason={setBanReason}
        canBan={checkPermission('ban')}
        onKick={async () => { await kickParticipant(kickConfirm.peerId, kickConfirm.userId, kickConfirm.displayName); setKickConfirm(null); }}
        onSelectBanDuration={(durationMinutes, label) => setPendingBan({ durationMinutes, label })}
        onConfirmBan={async () => {
          await banParticipant(kickConfirm.peerId, kickConfirm.userId, kickConfirm.displayName, pendingBan!.durationMinutes, banReason);
          setKickConfirm(null); setPendingBan(null); setBanReason('');
        }}
        onBackFromBan={() => { setPendingBan(null); setBanReason(''); }}
        onCloseKickBan={() => { setKickConfirm(null); setPendingBan(null); setBanReason(''); }}
        showLeaveConfirm={showLeaveConfirm}
        onLeaveOnly={() => doLeave(false)}
        onEndForAll={() => doLeave(true)}
        onCancelLeave={() => setShowLeaveConfirm(false)}
        isScreenSharing={isScreenSharing}
        isMobile={isMobile}
        currentUserName={currentUserName}
        onStopScreenShare={stopScreenShare}
        reactions={reactions}
        room={room}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        isHandRaised={isHandRaised}
        isSpeakerMuted={isSpeakerMuted}
        showEmojiPicker={showEmojiPicker}
        sidePanel={sidePanel}
        showAllControls={showAllControls}
        unreadCount={unreadCount}
        sortedQueueLength={sortedQueue.length}
        pendingApprovalsLength={pendingApprovals.length}
        canMuteAll={checkPermission('mute_all') && peers.size > 0}
        speakingLimitEnabled={speakingLimitEnabled}
        speakingSecs={speakingSecs}
        myLimitSecs={myLimitSecs}
        onToggleMute={toggleMute}
        onToggleVideo={toggleVideo}
        onToggleHand={toggleHand}
        onToggleScreenShare={isScreenSharing ? stopScreenShare : startScreenShare}
        onToggleEmojiPicker={() => setShowEmojiPicker(v => !v)}
        onTogglePanel={(p) => { togglePanel(p); if (isMobile) setShowAllControls(false); }}
        onToggleSpeakerMute={() => dispatch({ type: 'SET_SPEAKER_MUTED', value: !isSpeakerMuted })}
        onMuteAll={muteAll}
        onLeave={leaveRoom}
        onToggleAllControls={() => setShowAllControls(v => !v)}
        onSendEmoji={sendEmoji}
      />
      </div>
    </div>
  );
}
