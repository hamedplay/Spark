import { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import { useConferenceClient } from './conferenceClient';
import type { PeerDiagnostics } from '../../lib/webrtcDiagnostics';
import toast from 'react-hot-toast';
import type { ConferenceRoom, ConferenceMessage, PeerConnection, Reaction, SidePanel, LayoutMode } from './types';
import { VIDEO_QUALITY_PRESETS } from './SettingsPanel';
import type { PendingApproval } from './ApprovalGate';
import type { VideoQuality } from './SettingsPanel';
import { type KickConfirmData, type PendingBanData } from './Room/KickBanModal';
import { TopBar } from './Room/TopBar';
import { VideoArea } from './Room/VideoArea';
import { SidePanelContainer } from './Room/SidePanelContainer';
import { RoomOverlays } from './Room/RoomOverlays';
import { RoomBackground } from './Room/RoomBackground';
import { ROLE_PERMISSIONS, ROLE_LABELS, ROLE_COLORS, type RoleType, type Permission } from './Room/roleConstants';
import { mediaReducer } from './Room/mediaReducer';
import { calculateBitrate, fmt, qualityColor } from './Room/webrtcHelpers';
import { useConferenceWebRTC } from './Room/useConferenceWebRTC';
import { useConferenceMediaControls } from './Room/useConferenceMediaControls';
import { useConferenceHostActions } from './Room/useConferenceHostActions';

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
  loadRTCConfig: () => Promise<RTCConfiguration>;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Main component ────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
export function ConferenceRoomView({ room, currentUserId, currentUserName, myPeerId, localStream, onLeave, onInvite, loadRTCConfig }: Props) {
  const supabase = useConferenceClient();
  // ── RTCConfig — loaded via injected loader (authenticated or guest)
  const rtcConfigRef = useRef<RTCConfiguration>({
    iceServers: [], iceTransportPolicy: 'all',
    iceCandidatePoolSize: 10, bundlePolicy: 'max-bundle', rtcpMuxPolicy: 'require',
  });
  const rtcConfigReadyRef = useRef<Promise<void>>(
    loadRTCConfig().then(cfg => { rtcConfigRef.current = cfg; })
  );

  useEffect(() => {
    rtcConfigReadyRef.current = loadRTCConfig().then(cfg => { rtcConfigRef.current = cfg; });
  }, [loadRTCConfig]);
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
  const broadcastStateRef = useRef<(muted: boolean, videoOff: boolean, handRaised: boolean) => void>(() => {});

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


  const {
    participants, sendSignal, sendSignalRef, showTileReactionRef, stopScreenShareRef
  } = useConferenceWebRTC({
    broadcastStateRef, channelRef, currentUserId, currentUserName, dispatch, iceCandidateQueue,
    localStreamRef, mediaRef, myPeerId, myPeerIdRef, onLeave, peersRef,
    room, rtcConfigReadyRef, rtcConfigRef, setChatEnabled, setHandRaiseQueue, setHostId,
    setMessages, setMyLimitSecs, setMyQuality, setMyRole, setPeerDiagnostics, setPeers,
    setReactions, setSpeakingLimitEnabled, setUnreadCount, sidePanelRef, supabase
  });

  const {
    sendEmoji, startScreenShare, stopScreenShare, toggleHand, toggleMute, toggleVideo
  } = useConferenceMediaControls({
    broadcastStateRef, currentUserId, currentUserName, dispatch, isHandRaised, isMuted,
    isVideoOff, localStream, localStreamRef, mediaRef, myPeerId, peersRef,
    room, screenStreamRef, sendSignal, sendSignalRef, setReactions, setShowEmojiPicker,
    setSpeakingSecs, setTileReactions, showTileReactionRef, speakingSecsRef, stopScreenShareRef, supabase
  });

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

  const {
    banParticipant, changeRole, doLeave, kickParticipant, lowerHand, muteAll,
    transferHost
  } = useConferenceHostActions({
    channelRef, currentUserId, currentUserName, onLeave, peersRef, room,
    screenStreamRef, sendSignal, sendSignalRef, setHandRaiseQueue, setHostId, setPeers,
    setRoleDropdown, setShowLeaveConfirm, supabase
  });

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
