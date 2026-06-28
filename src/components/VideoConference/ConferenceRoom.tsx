import React, { useState, useEffect, useRef, useCallback, useReducer } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare, Users,
  Hand, ScreenShare, ScreenShareOff, Maximize2, Minimize2,
  Crown, Pin, X, Copy, Check,
  Smile, BarChart2,
  PenTool, Volume2, VolumeX, Activity, UserPlus,
  ShieldAlert, UserX, Mic2, ChevronUp, ChevronDown, ArrowRightLeft,
  SlidersHorizontal, LayoutGrid, MonitorPlay, PanelRight,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';
import type {
  ConferenceRoom, ConferenceParticipant, ConferenceMessage,
  PeerConnection, Reaction, SidePanel, LayoutMode,
} from './types';
import { VideoTile, QualityDot } from './VideoTile';
import { Whiteboard } from './Whiteboard';
import { PollPanel } from './PollPanel';
import { SettingsPanel, VIDEO_QUALITY_PRESETS } from './SettingsPanel';
import { ChatPanel } from './ChatPanel';
import { QuickReactions } from './QuickReactions';
import type { VideoQuality } from './SettingsPanel';

// ── Config ────────────────────────────────────────────────────────────────────
const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
  iceCandidatePoolSize: 4,
  iceTransportPolicy: 'all',
};

const EMOJIS = ['👍','👏','❤️','😂','😮','🎉','🙌','🔥','💯','✅'];

// ── Media state reducer ───────────────────────────────────────────────────────
type MediaState = {
  isMuted: boolean;
  isVideoOff: boolean;
  isHandRaised: boolean;
  isScreenSharing: boolean;
  isSpeakerMuted: boolean;
};

type MediaAction =
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_VIDEO' }
  | { type: 'TOGGLE_HAND' }
  | { type: 'SET_SCREEN_SHARING'; value: boolean }
  | { type: 'SET_SPEAKER_MUTED'; value: boolean }
  | { type: 'FORCE_MUTE' }
  | { type: 'SET_HAND'; value: boolean };

function mediaReducer(state: MediaState, action: MediaAction): MediaState {
  switch (action.type) {
    case 'TOGGLE_MUTE': return { ...state, isMuted: !state.isMuted };
    case 'TOGGLE_VIDEO': return { ...state, isVideoOff: !state.isVideoOff };
    case 'TOGGLE_HAND': return { ...state, isHandRaised: !state.isHandRaised };
    case 'SET_SCREEN_SHARING': return { ...state, isScreenSharing: action.value };
    case 'SET_SPEAKER_MUTED': return { ...state, isSpeakerMuted: action.value };
    case 'FORCE_MUTE': return { ...state, isMuted: true };
    case 'SET_HAND': return { ...state, isHandRaised: action.value };
    default: return state;
  }
}

// ── Role-based permissions ────────────────────────────────────────────────────
type RoleType = 'host' | 'admin' | 'moderator' | 'member' | 'guest';
type Permission =
  | 'kick' | 'ban' | 'transfer_host'
  | 'toggle_chat' | 'toggle_whiteboard'
  | 'mute_all' | 'mute_user'
  | 'manage_polls' | 'lower_hand';

const ROLE_PERMISSIONS: Record<RoleType, Set<Permission>> = {
  host:      new Set(['kick','ban','transfer_host','toggle_chat','toggle_whiteboard','mute_all','mute_user','manage_polls','lower_hand']),
  admin:     new Set(['kick','ban','toggle_chat','toggle_whiteboard','mute_all','mute_user','manage_polls','lower_hand']),
  moderator: new Set(['mute_user','manage_polls','lower_hand']),
  member:    new Set(),
  guest:     new Set(),
};

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
  // ── Media state (reducer eliminates scattered setters + prevents race conditions)
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

  // Dynamic host — updated on transfer
  const [hostId, setHostId] = useState(room.host_id);
  const isHost = hostId === currentUserId;

  // Runtime chat toggle — starts from room setting, updated via DB subscription
  const [chatEnabled, setChatEnabled] = useState(room.chat_enabled ?? true);

  // Role of the current user — fetched once on mount and updated on transfer
  const [myRole, setMyRole] = useState<RoleType>(room.host_id === currentUserId ? 'host' : 'member');

  // Video quality settings
  const [videoQuality, setVideoQuality] = useState<VideoQuality>('medium');
  const [dataSaverMode, setDataSaverMode] = useState(false);
  const [applyingVideoConstraints, setApplyingVideoConstraints] = useState(false);

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
    await supabase.from('conference_rooms').update({ chat_enabled: next }).eq('id', room.id);
  }, [chatEnabled, room.id]);

  // Hand raise queue (sorted by raise time)
  const [handRaiseQueue, setHandRaiseQueue] = useState<HandRaiseEntry[]>([]);

  const applyVideoConstraints = useCallback(async (quality: VideoQuality, dataSaver: boolean) => {
    const preset = VIDEO_QUALITY_PRESETS[dataSaver ? 'low' : quality];
    const frameRate = dataSaver ? 15 : preset.frameRate;
    setApplyingVideoConstraints(true);
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: preset.width }, height: { ideal: preset.height }, frameRate: { ideal: frameRate } },
        audio: false,
      });
      const newTrack = newStream.getVideoTracks()[0];
      for (const peer of peersRef.current.values()) {
        const sender = peer.pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) await sender.replaceTrack(newTrack).catch(() => {});
      }
      const oldTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldTrack) { localStreamRef.current.removeTrack(oldTrack); oldTrack.stop(); }
      localStreamRef.current.addTrack(newTrack);
      newTrack.enabled = !mediaRef.current.isVideoOff;
      toast.success('کیفیت ویدیو تغییر کرد');
    } catch {
      toast.error('خطا در تغییر کیفیت ویدیو');
    } finally {
      setApplyingVideoConstraints(false);
    }
  }, []);

  // ── Refs (never stale in callbacks) ───────────────────────────────────────
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

  // Duration
  useEffect(() => {
    const t = setInterval(() => setDuration(d => d + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Heartbeat
  useEffect(() => {
    const t = setInterval(async () => {
      await supabase.from('conference_participants')
        .update({ updated_at: new Date().toISOString() } as any)
        .eq('room_id', room.id).eq('user_id', currentUserId).eq('status', 'joined');
    }, 15000);
    return () => clearInterval(t);
  }, [room.id, currentUserId]);

  // Avatar fetch — loads profile photos for local user + any new peers
  useEffect(() => {
    const toFetch = [currentUserId, ...Array.from(peers.values()).map(p => p.userId)]
      .filter(uid => !fetchedAvatarUserIds.current.has(uid));
    if (!toFetch.length) return;
    toFetch.forEach(uid => fetchedAvatarUserIds.current.add(uid));
    supabase.from('profiles').select('user_id, avatar_url').in('user_id', toFetch)
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

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

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
    if (type === 'join') {
      // Guard: skip insert if required fields are missing (prevents HTTP 400)
      if (!room?.id || !myPeerIdRef.current || !currentUserId) return;
      supabase.from('conference_signals').insert({
        room_id: room.id,
        from_peer_id: myPeerIdRef.current,
        from_user_id: currentUserId,
        from_display_name: currentUserName,
        to_peer_id: null,
        type: 'join',
        payload: data,
      }).then(({ error }) => { if (error) console.error('conference_signals insert error:', error); });
    }
  }, [currentUserId, currentUserName, room.id]);

  const buildPC = useCallback((remotePeerId: string, remoteUserId: string, remoteDisplayName: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));

    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      const cur = peersRef.current.get(remotePeerId);
      if (cur) { peersRef.current.set(remotePeerId, { ...cur, stream }); setPeers(new Map(peersRef.current)); }
    };

    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal(remotePeerId, 'ice', { candidate: e.candidate.toJSON() });
    };

    pc.onconnectionstatechange = () => {
      const cur = peersRef.current.get(remotePeerId);
      if (cur) { peersRef.current.set(remotePeerId, { ...cur, connectionState: pc.connectionState }); setPeers(new Map(peersRef.current)); }
      if (pc.connectionState === 'connected') toast.success(`${remoteDisplayName} وارد شد`);
      if (pc.connectionState === 'disconnected') {
        setTimeout(() => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            pc.close();
            peersRef.current.delete(remotePeerId);
            setPeers(new Map(peersRef.current));
            sendSignalRef.current(null, 'peer_left', { peerId: remotePeerId, displayName: remoteDisplayName });
            supabase.from('conference_participants')
              .update({ status: 'left', left_at: new Date().toISOString() })
              .eq('room_id', room.id).eq('user_id', remoteUserId)
              .then(() => {});
          }
        }, 30000);
      }
      if (pc.connectionState === 'failed') {
        setTimeout(() => { if (pc.connectionState === 'failed') { pc.close(); peersRef.current.delete(remotePeerId); setPeers(new Map(peersRef.current)); } }, 2000);
      }
    };

    const conn: PeerConnection = { peerId: remotePeerId, userId: remoteUserId, displayName: remoteDisplayName, pc, stream: null, isMuted: false, isVideoOff: false, isHandRaised: false, connectionState: 'new', networkQuality: 'good', speakingSeconds: 0, audioLevel: 0 };
    peersRef.current.set(remotePeerId, conn);
    setPeers(new Map(peersRef.current));
    return pc;
  }, [sendSignal]);

  const getPC = useCallback((remotePeerId: string, remoteUserId: string, remoteDisplayName: string): RTCPeerConnection => {
    const cur = peersRef.current.get(remotePeerId);
    if (cur && cur.pc.connectionState !== 'failed' && cur.pc.connectionState !== 'closed') return cur.pc;
    return buildPC(remotePeerId, remoteUserId, remoteDisplayName);
  }, [buildPC]);

  const flushICE = useCallback(async (remotePeerId: string) => {
    const q = iceCandidateQueue.current.get(remotePeerId) || [];
    if (!q.length) return;
    const pc = peersRef.current.get(remotePeerId)?.pc;
    if (!pc?.remoteDescription) return;
    for (const c of q) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    iceCandidateQueue.current.delete(remotePeerId);
  }, []);

  const makeOffer = useCallback(async (remotePeerId: string, remoteUserId: string, remoteDisplayName: string) => {
    const pc = getPC(remotePeerId, remoteUserId, remoteDisplayName);
    if (pc.signalingState !== 'stable') return;
    try {
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
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
          if (myPeerIdRef.current < from) {
            await makeOfferRef.current(from, from_user_id, from_name);
          } else {
            getPCRef.current(from, from_user_id, from_name);
          }

        } else if (type === 'offer') {
          const pc = getPCRef.current(from, from_user_id, from_name);
          try {
            if (pc.signalingState === 'have-local-offer') {
              if (myPeerIdRef.current < from) {
                await pc.setLocalDescription({ type: 'rollback' } as RTCSessionDescriptionInit);
              } else { return; }
            }
            if (pc.signalingState !== 'stable') return;
            await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
            await flushICERef.current(from);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendSignalRef.current(from, 'answer', { sdp: pc.localDescription });
          } catch (e) { console.error('offer error', e); }

        } else if (type === 'answer') {
          const cur = peersRef.current.get(from);
          if (cur?.pc.signalingState === 'have-local-offer') {
            try { await cur.pc.setRemoteDescription(new RTCSessionDescription(data.sdp)); await flushICERef.current(from); }
            catch (e) { console.error('answer error', e); }
          }

        } else if (type === 'ice') {
          const cur = peersRef.current.get(from);
          if (cur?.pc) {
            if (cur.pc.remoteDescription) {
              cur.pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
            } else {
              const q = iceCandidateQueue.current.get(from) || [];
              q.push(data.candidate);
              iceCandidateQueue.current.set(from, q);
            }
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
          const r: Reaction = { ...data, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20, createdAt: Date.now() };
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
        }
      })();
    })
    .subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;

      sendSignalRef.current(null, 'join', { userId: currentUserId, displayName: currentUserName, peerId: myPeerId });

      await new Promise(r => setTimeout(r, 500));

      const { data: existing } = await supabase
        .from('conference_participants')
        .select('user_id, display_name, peer_id')
        .eq('room_id', room.id)
        .eq('status', 'joined')
        .neq('user_id', currentUserId);

      if (existing) {
        for (const p of existing) {
          if (!p.peer_id || p.peer_id === myPeerId) continue;
          if (myPeerIdRef.current < p.peer_id) {
            await makeOfferRef.current(p.peer_id, p.user_id, p.display_name);
          } else {
            const existingPC = getPCRef.current(p.peer_id, p.user_id, p.display_name);
            setTimeout(async () => {
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
      ch.unsubscribe();
      roomCh.unsubscribe();
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
    return () => { ch.unsubscribe(); };
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
      const screenTrack = ss.getVideoTracks()[0];

      for (const p of peersRef.current.values()) {
        const sender = p.pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack).catch(err => console.error('replaceTrack error:', err));
        } else {
          p.pc.addTrack(screenTrack, localStreamRef.current);
        }
      }

      dispatch({ type: 'SET_SCREEN_SHARING', value: true });
      sendSignal(null, 'state', { peerId: myPeerId, isMuted, isVideoOff, isHandRaised, isScreenSharing: true });

      screenTrack.onended = () => stopScreenShareRef.current();
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
    const r: Reaction = { id: crypto.randomUUID(), userId: currentUserId, displayName: currentUserName, emoji, x: 0, y: 0, createdAt: Date.now() };
    sendSignal(null, 'reaction', r);
    setReactions(prev => [...prev, { ...r, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20 }]);
    setTimeout(() => setReactions(prev => prev.filter(x => x.id !== r.id)), 3000);
    showTileReaction(currentUserId, emoji);
  };


  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showAllControls, setShowAllControls] = useState(false);

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

  const kickParticipant = async (peerId: string, displayName: string) => {
    const targetPeer = peersRef.current.get(peerId);
    sendSignal(peerId, 'kick', { fromHost: currentUserName });
    if (targetPeer) {
      const { error } = await supabase.from('room_mod_actions').insert({
        room_id: room.id, by_admin_id: currentUserId,
        target_user_id: targetPeer.userId, action_type: 'kick',
      });
      if (error) console.error('kick mod_action error:', error);
      await supabase.from('conference_participants')
        .update({ status: 'left', left_at: new Date().toISOString() })
        .eq('room_id', room.id).eq('user_id', targetPeer.userId);
    }
    setTimeout(() => {
      const cur = peersRef.current.get(peerId);
      if (cur) { cur.pc.close(); peersRef.current.delete(peerId); setPeers(new Map(peersRef.current)); }
    }, 500);
    toast.success(`${displayName} از جلسه خارج شد`);
  };

  // Lower a specific participant's hand (host only)
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
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    channelRef.current?.unsubscribe();
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

  const qualityColor = { excellent:'text-green-400', good:'text-teal-400', fair:'text-amber-400', poor:'text-red-400' };

  // Sorted hand raise queue (earliest first)
  const sortedQueue = [...handRaiseQueue].sort((a, b) => a.time - b.time);

  const coreControls = (
    <>
      <button onClick={toggleMute} title={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'} aria-pressed={isMuted}
        className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>
      <button onClick={toggleVideo} title={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'} aria-pressed={isVideoOff}
        className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isVideoOff ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
        {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
      </button>
      {room.allow_chat && (
        <button onClick={() => togglePanel('chat')} title="چت"
          className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'chat' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
          <MessageSquare className="w-5 h-5" />
          {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold">{unreadCount > 9 ? '9+' : unreadCount}</span>}
        </button>
      )}
      <button onClick={leaveRoom} title="پایان جلسه"
        className="w-12 h-11 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all shadow-lg flex-shrink-0">
        <PhoneOff className="w-5 h-5" />
      </button>
    </>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className={`flex flex-col bg-gray-950 text-white select-none ${isFullscreen ? 'fixed inset-0 z-[9999]' : 'h-full'}`} dir="rtl">
      <style>{`
        @keyframes float-up{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-120px) scale(1.5)}}
        @keyframes tile-reaction{0%{opacity:0;transform:scale(0.5)}15%{opacity:1;transform:scale(1.2)}30%{transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(0.8)}}
        .conf-panel-mobile{transition:transform 0.3s cubic-bezier(.4,0,.2,1)}
      `}</style>

      {/* Top bar */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900/95 border-b border-gray-800 flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
          <span className="font-bold text-sm truncate max-w-[120px] sm:max-w-xs">{room.name || 'جلسه ویدیویی'}</span>
          <span className="text-gray-400 text-xs font-mono flex-shrink-0">{fmt(duration)}</span>
          <span className={`hidden sm:flex items-center gap-1 text-xs flex-shrink-0 ${qualityColor[myQuality]}`}>
            <Activity className="w-3 h-3" />{myQuality}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {onInvite && (
            <button onClick={onInvite} title="دعوت" className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-700 hover:bg-blue-600 rounded-lg text-xs font-medium transition-colors">
              <UserPlus className="w-3.5 h-3.5" /><span className="hidden sm:inline">دعوت</span>
            </button>
          )}
          <button onClick={copyCode} title="کپی کد جلسه" className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-lg text-xs font-mono transition-colors">
            {codeCopied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            <span className="hidden sm:inline">{room.code}</span>
          </button>
          {/* Layout mode toggle — 3 modes */}
          <div className="hidden sm:flex items-center gap-0.5 bg-gray-800 rounded-lg p-0.5">
            {([
              { mode: 'gallery', icon: LayoutGrid, title: 'نمای گالری' },
              { mode: 'speaker', icon: MonitorPlay, title: 'نمای سخنران' },
              { mode: 'sidebar', icon: PanelRight, title: 'نمای نوار کناری' },
            ] as const).map(({ mode, icon: Icon, title }) => (
              <button
                key={mode}
                onClick={() => setLayoutMode(mode)}
                title={title}
                aria-pressed={layoutMode === mode}
                className={`p-1.5 rounded-md transition-colors ${layoutMode === mode ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
              >
                <Icon className="w-3.5 h-3.5" />
              </button>
            ))}
          </div>
          <button onClick={() => setIsFullscreen(v => !v)} title="تمام‌صفحه" className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors">
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
          </button>
          <div className="flex items-center gap-1 px-2 py-1.5 bg-gray-800 rounded-lg text-xs flex-shrink-0">
            <Users className="w-3.5 h-3.5 text-teal-400" /><span>{allTiles.length}</span>
          </div>
        </div>
      </div>

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden min-h-0 relative">
        {/* Video area */}
        <div className="flex-1 flex flex-col overflow-hidden p-2 gap-2 min-w-0 relative">
          {(() => {
            // Compute ordered tiles — respect saved drag order, fill in any new peers at the end
            const rawTiles = allTiles;
            const orderedTiles = [
              ...tileOrder.map(id => rawTiles.find(t => t.peerId === id)).filter(Boolean) as typeof rawTiles,
              ...rawTiles.filter(t => !tileOrder.includes(t.peerId)),
            ];

            // DnD handlers
            const onDragStart = (peerId: string) => { dragSrcRef.current = peerId; };
            const onDragOver = (e: React.DragEvent, peerId: string) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
            };
            const onDrop = (e: React.DragEvent, targetId: string) => {
              e.preventDefault();
              const srcId = dragSrcRef.current;
              if (!srcId || srcId === targetId) return;
              const ids = orderedTiles.map(t => t.peerId);
              const si = ids.indexOf(srcId);
              const ti = ids.indexOf(targetId);
              if (si === -1 || ti === -1) return;
              const next = [...ids];
              next.splice(si, 1);
              next.splice(ti, 0, srcId);
              setTileOrder(next);
              dragSrcRef.current = null;
            };

            const makeDraggable = (peerId: string) => ({
              draggable: true,
              onDragStart: () => onDragStart(peerId),
              onDragOver: (e: React.DragEvent) => onDragOver(e, peerId),
              onDrop: (e: React.DragEvent) => onDrop(e, peerId),
              style: { cursor: 'grab' } as React.CSSProperties,
            });

            if (pinnedPeerId) {
              return (
                <div className="flex flex-col flex-1 gap-2 min-h-0">
                  <div className="flex-1 min-h-0">
                    {orderedTiles.filter(t => t.peerId === pinnedPeerId).map(t => (
                      <VideoTile key={t.peerId} {...t} isPinned isHost={t.isHost} activeReaction={tileReactions.get(t.userId)} onPin={() => setPinnedPeerId(null)} />
                    ))}
                  </div>
                  <div className="flex gap-2 flex-shrink-0 overflow-x-auto pb-1">
                    {orderedTiles.filter(t => t.peerId !== pinnedPeerId).map(t => (
                      <div key={t.peerId} className="w-28 sm:w-32 flex-shrink-0" {...makeDraggable(t.peerId)}>
                        <VideoTile {...t} isPinned={false} isHost={t.isHost} activeReaction={tileReactions.get(t.userId)} onPin={() => setPinnedPeerId(t.peerId)} small />
                      </div>
                    ))}
                  </div>
                </div>
              );
            }

            // ── Gallery ────────────────────────────────────────────────────────
            if (layoutMode === 'gallery') {
              const n = orderedTiles.length;
              const cols =
                n === 1 ? 'grid-cols-1' :
                n === 2 ? 'grid-cols-1 sm:grid-cols-2' :
                n <= 4 ? 'grid-cols-2' :
                n <= 6 ? 'grid-cols-2 sm:grid-cols-3' :
                n <= 9 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4';
              return (
                <div className={`flex-1 overflow-y-auto grid gap-2 content-start ${cols}`}>
                  {orderedTiles.map(t => (
                    <div key={t.peerId} {...makeDraggable(t.peerId)}>
                      <VideoTile {...t}
                        isPinned={pinnedPeerId === t.peerId}
                        isHost={t.isHost}
                        activeReaction={tileReactions.get(t.userId)}
                        onPin={() => setPinnedPeerId(p => p === t.peerId ? null : t.peerId)} />
                    </div>
                  ))}
                </div>
              );
            }

            // ── Speaker ────────────────────────────────────────────────────────
            if (layoutMode === 'speaker') {
              const [speaker, ...rest] = orderedTiles;
              return (
                <div className="flex flex-col flex-1 gap-2 min-h-0">
                  <div className="flex-1 min-h-0" {...makeDraggable(speaker.peerId)}>
                    <VideoTile {...speaker}
                      isPinned={false}
                      isHost={speaker.isHost}
                      activeReaction={tileReactions.get(speaker.userId)}
                      onPin={() => setPinnedPeerId(speaker.peerId)} />
                  </div>
                  {rest.length > 0 && (
                    <div className="flex gap-2 flex-shrink-0 overflow-x-auto pb-1">
                      {rest.map(t => (
                        <div key={t.peerId} className="w-28 sm:w-36 flex-shrink-0" {...makeDraggable(t.peerId)}>
                          <VideoTile {...t}
                            isPinned={false}
                            isHost={t.isHost}
                            activeReaction={tileReactions.get(t.userId)}
                            onPin={() => {
                              setTileOrder(prev => {
                                const ids = orderedTiles.map(x => x.peerId);
                                const si = ids.indexOf(t.peerId);
                                if (si <= 0) return prev;
                                const next = [...ids];
                                next.splice(si, 1);
                                next.unshift(t.peerId);
                                return next;
                              });
                            }}
                            small />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            // ── Sidebar ────────────────────────────────────────────────────────
            const [main, ...others] = orderedTiles;
            return (
              <div className="flex flex-1 gap-2 min-h-0">
                <div className="w-28 sm:w-36 flex-shrink-0 flex flex-col gap-2 overflow-y-auto">
                  {others.map(t => (
                    <div key={t.peerId} {...makeDraggable(t.peerId)}>
                      <VideoTile {...t}
                        isPinned={false}
                        isHost={t.isHost}
                        activeReaction={tileReactions.get(t.userId)}
                        onPin={() => {
                          setTileOrder(prev => {
                            const ids = orderedTiles.map(x => x.peerId);
                            const si = ids.indexOf(t.peerId);
                            if (si <= 0) return prev;
                            const next = [...ids];
                            next.splice(si, 1);
                            next.unshift(t.peerId);
                            return next;
                          });
                        }}
                        small />
                    </div>
                  ))}
                </div>
                <div className="flex-1 min-w-0" {...makeDraggable(main.peerId)}>
                  <VideoTile {...main}
                    isPinned={false}
                    isHost={main.isHost}
                    activeReaction={tileReactions.get(main.userId)}
                    onPin={() => {}} />
                </div>
              </div>
            );
          })()}

          {/* Quick reactions bar — fixed bottom-center of video area */}
          {room.allow_reactions && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50">
              <QuickReactions onSend={sendEmoji} />
            </div>
          )}
        </div>

        {/* Side panel */}
        {sidePanel && (
          <>
            {isMobile && (
              <div className="absolute inset-0 bg-black/60 z-30" onClick={() => setSidePanel(null)} />
            )}
            <div className={`
              bg-gray-900 border-gray-800 flex flex-col z-40
              ${isMobile
                ? 'absolute bottom-0 left-0 right-0 h-[70vh] rounded-t-2xl border-t conf-panel-mobile'
                : 'w-64 md:w-72 flex-shrink-0 border-r relative'
              }
            `}>
              <div className="flex border-b border-gray-800 flex-shrink-0">
                {isMobile && (
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-10 h-1.5 bg-gray-600 rounded-full" />
                )}
                {sidePanel === 'settings' ? (
                  <>
                    <div className="flex-1 flex items-center px-3 py-2.5 gap-2">
                      <SlidersHorizontal className="w-4 h-4 text-teal-400 flex-shrink-0" />
                      <span className="text-sm font-medium text-teal-400">تنظیمات</span>
                    </div>
                    <button onClick={() => setSidePanel(null)} aria-label="بستن پنل" className="px-3 text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </>
                ) : (
                  <>
                    {(['chat','participants','polls','whiteboard'] as SidePanel[]).filter(Boolean).map(p => (
                      <button key={p!} onClick={() => togglePanel(p)}
                        className={`flex-1 py-2.5 text-xs font-medium transition-colors ${sidePanel === p ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-500 hover:text-gray-300'}`}>
                        {p === 'chat' ? 'چت' : p === 'participants' ? (
                          <span className="flex items-center justify-center gap-1">
                            افراد
                            {sortedQueue.length > 0 && (
                              <span className="w-4 h-4 rounded-full bg-yellow-500 text-black text-[10px] flex items-center justify-center font-bold">
                                {sortedQueue.length}
                              </span>
                            )}
                          </span>
                        ) : p === 'polls' ? 'نظرسنجی' : 'وایت‌بورد'}
                      </button>
                    ))}
                    <button onClick={() => setSidePanel(null)} aria-label="بستن پنل" className="px-3 text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0">
                      <X className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>

              {sidePanel === 'chat' && (
                <ChatPanel
                  roomId={room.id}
                  currentUserId={currentUserId}
                  currentUserName={currentUserName}
                  messages={messages}
                  chatEnabled={chatEnabled}
                  canToggleChat={checkPermission('toggle_chat')}
                  onToggleChat={toggleChatEnabled}
                  sendSignal={sendSignalStable}
                />
              )}

              {sidePanel === 'participants' && (
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
                  {/* Hand raise queue — host/admin/moderator only */}
                  {checkPermission('lower_hand') && sortedQueue.length > 0 && (
                    <div className="p-2 bg-yellow-900/20 rounded-xl border border-yellow-700/40">
                      <p className="text-xs font-semibold text-yellow-400 flex items-center gap-1.5 mb-1.5">
                        <Hand className="w-3 h-3" />صف دست‌بالاها ({sortedQueue.length})
                      </p>
                      {sortedQueue.map((entry, i) => (
                        <div key={entry.peerId} className="flex items-center gap-2 py-1">
                          <span className="w-4 h-4 rounded-full bg-yellow-600/40 text-yellow-300 text-[10px] flex items-center justify-center font-bold flex-shrink-0">{i + 1}</span>
                          <span className="text-sm text-gray-200 flex-1 truncate">{entry.name}</span>
                          <span className="text-xs text-gray-500 flex-shrink-0">{Math.round((Date.now() - entry.time) / 1000)}ث پیش</span>
                          <button onClick={() => lowerHand(entry.peerId)}
                            title="پایین آوردن دست"
                            aria-label={`پایین آوردن دست ${entry.name}`}
                            className="p-1 rounded-lg bg-yellow-900/40 hover:bg-yellow-900/70 text-yellow-400 transition-colors flex-shrink-0">
                            <Hand className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Host tools */}
                  {(checkPermission('mute_all') || checkPermission('kick')) && peers.size > 0 && (
                    <div className="p-2 bg-gray-800/60 rounded-xl space-y-1.5 border border-gray-700">
                      <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <Crown className="w-3 h-3" />ابزار مدیریت
                      </p>
                      {checkPermission('mute_all') && (
                        <button onClick={muteAll}
                          className="w-full flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-amber-900/40 text-gray-200 hover:text-amber-300 rounded-lg text-xs transition-colors">
                          <Mic2 className="w-3.5 h-3.5" />قطع میکروفون همه
                        </button>
                      )}
                    </div>
                  )}

                  {/* Participant list */}
                  {allTiles.map(t => (
                    <div key={t.peerId} className="flex items-center gap-2 p-2 bg-gray-800 rounded-xl group">
                      <div className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {t.displayName[0]?.toUpperCase() || '?'}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{t.isLocal ? `${t.displayName} (شما)` : t.displayName}</p>
                        <div className="flex items-center gap-1 mt-0.5">
                          <QualityDot quality={t.networkQuality} />
                          <span className="text-xs text-gray-500">{t.networkQuality}</span>
                          {t.isHost && <span className="text-xs text-amber-400 mr-1">میزبان</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {t.isHost && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                        {t.isMuted && <MicOff className="w-3 h-3 text-red-400" />}
                        {t.isVideoOff && <VideoOff className="w-3 h-3 text-red-400" />}
                        {t.isHandRaised && <Hand className="w-3.5 h-3.5 text-yellow-400 animate-bounce" />}
                        {/* Host lower hand */}
                        {checkPermission('lower_hand') && !t.isLocal && t.isHandRaised && (
                          <button onClick={() => lowerHand(t.peerId)}
                            title="پایین آوردن دست"
                            className="p-1 rounded-lg hover:bg-yellow-900/40 text-yellow-500 hover:text-yellow-300 transition-colors">
                            <Hand className="w-3 h-3" />
                          </button>
                        )}
                        {/* Transfer host */}
                        {checkPermission('transfer_host') && !t.isLocal && !t.isHost && (
                          <button onClick={() => transferHost(t.peerId, t.userId, t.displayName)}
                            title="انتقال میزبانی"
                            aria-label={`انتقال میزبانی به ${t.displayName}`}
                            className="p-1 rounded-lg bg-transparent hover:bg-amber-900/40 text-gray-600 hover:text-amber-400 transition-colors opacity-0 group-hover:opacity-100">
                            <ArrowRightLeft className="w-3 h-3" />
                          </button>
                        )}
                        {/* Kick */}
                        {checkPermission('kick') && !t.isLocal && (
                          <button onClick={() => kickParticipant(t.peerId, t.displayName)}
                            title="خارج کردن از جلسه"
                            className="p-1 rounded-lg bg-red-900/0 hover:bg-red-900/40 text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {/* Pin */}
                        {!t.isLocal && (
                          <button onClick={() => setPinnedPeerId(p => p === t.peerId ? null : t.peerId)}
                            title="پین کردن"
                            className={`p-1 rounded-lg transition-colors opacity-0 group-hover:opacity-100 ${pinnedPeerId === t.peerId ? 'text-teal-400 bg-teal-900/40 opacity-100' : 'text-gray-600 hover:text-teal-400 hover:bg-teal-900/20'}`}>
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {participants.length > allTiles.length && (
                    <p className="text-xs text-gray-500 text-center py-1">{participants.length} نفر در جلسه</p>
                  )}
                </div>
              )}

              {sidePanel === 'polls' && <PollPanel roomId={room.id} userId={currentUserId} isHost={checkPermission('manage_polls')} />}
              {sidePanel === 'whiteboard' && (
                <div className="flex-1 overflow-hidden min-h-0">
                  <Whiteboard roomId={room.id} userId={currentUserId} isHost={checkPermission('toggle_whiteboard')} />
                </div>
              )}
              {sidePanel === 'settings' && (
                <SettingsPanel
                  videoQuality={videoQuality}
                  dataSaverMode={dataSaverMode}
                  isApplying={applyingVideoConstraints}
                  onChangeQuality={(q) => {
                    setVideoQuality(q);
                    applyVideoConstraints(q, dataSaverMode);
                  }}
                  onToggleDataSaver={() => {
                    const next = !dataSaverMode;
                    setDataSaverMode(next);
                    applyVideoConstraints(videoQuality, next);
                  }}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Host leave confirm */}
      {showLeaveConfirm && (
        <div role="dialog" aria-modal="true" aria-label="خروج از جلسه" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
          <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm text-center space-y-4" dir="rtl">
            <div className="w-14 h-14 rounded-full bg-red-900/40 flex items-center justify-center mx-auto">
              <PhoneOff className="w-7 h-7 text-red-400" />
            </div>
            <div>
              <h3 className="text-white font-bold text-lg mb-1">خروج از جلسه</h3>
              <p className="text-gray-400 text-sm">شما میزبان هستید. چه کاری انجام دهید؟</p>
            </div>
            <div className="flex flex-col gap-2">
              <button onClick={() => doLeave(false)} autoFocus
                className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors text-sm">
                فقط خودم خارج شوم (جلسه ادامه دارد)
              </button>
              <button onClick={() => doLeave(true)}
                className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition-colors text-sm">
                پایان دادن جلسه برای همه
              </button>
              <button onClick={() => setShowLeaveConfirm(false)}
                className="w-full py-2.5 text-gray-400 hover:text-white text-sm transition-colors">
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screen share badge */}
      {isScreenSharing && !isMobile && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-teal-600/95 rounded-full px-4 py-1.5 flex items-center gap-2 text-sm font-medium text-white shadow-lg">
          <ScreenShare className="w-4 h-4" />
          {currentUserName} در حال ارائه صفحه است
          <button onClick={stopScreenShare} className="mr-1 px-2 py-0.5 rounded-full bg-white/20 hover:bg-white/30 text-xs transition-colors">
            توقف
          </button>
        </div>
      )}

      {/* Floating reactions — emoji + sender name */}
      {reactions.map(r => (
        <div key={r.id} className="fixed pointer-events-none z-[9999] flex flex-col items-center gap-0.5"
          style={{ left: `${r.x}%`, top: `${r.y}%`, animation: 'float-up 3s ease-out forwards' }}>
          <span className="text-3xl">{r.emoji}</span>
          <span className="text-[10px] text-white/80 bg-black/50 rounded-full px-1.5 py-0.5 leading-tight max-w-[72px] truncate">{r.displayName}</span>
        </div>
      ))}

      {/* Bottom controls */}
      <div className="bg-gray-900/95 border-t border-gray-800 flex-shrink-0 relative" dir="rtl">
        {/* Emoji picker — rendered here (above overflow-x-auto) so it's never clipped */}
        {showEmojiPicker && room.allow_reactions && (
          <div role="listbox" aria-label="انتخاب ایموجی"
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 bg-gray-800 rounded-2xl p-2 flex flex-wrap gap-1 shadow-2xl border border-gray-700 z-[200] w-52">
            {EMOJIS.map(e => (
              <button key={e} onClick={() => sendEmoji(e)} aria-label={`واکنش ${e}`}
                className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-700 text-lg transition-colors">
                {e}
              </button>
            ))}
          </div>
        )}
        {isMobile ? (
          <>
            <div className="flex items-center justify-center gap-2 px-3 py-2.5">
              {coreControls}
              <button onClick={() => setShowAllControls(v => !v)} aria-label="بیشتر"
                className="w-11 h-11 rounded-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 transition-all flex-shrink-0">
                {showAllControls ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
              </button>
            </div>
            {showAllControls && (
              <div className="flex items-center justify-center gap-2 px-3 pb-3 flex-wrap">
                {room.allow_screen_share && (
                  <button onClick={isScreenSharing ? stopScreenShare : startScreenShare} title="اشتراک صفحه"
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${isScreenSharing ? 'bg-teal-600 hover:bg-teal-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                    {isScreenSharing ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
                  </button>
                )}
                <button onClick={toggleHand} title="بلند کردن دست" aria-pressed={isHandRaised}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${isHandRaised ? 'bg-yellow-500 hover:bg-yellow-400' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <Hand className="w-5 h-5" />
                </button>
                {room.allow_reactions && (
                  <button onClick={() => setShowEmojiPicker(v => !v)} title="واکنش"
                    aria-pressed={showEmojiPicker}
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${showEmojiPicker ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                    <Smile className="w-5 h-5" />
                  </button>
                )}
                <button onClick={() => { togglePanel('participants'); setShowAllControls(false); }} title="شرکت‌کنندگان"
                  className={`relative w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'participants' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <Users className="w-5 h-5" />
                  {sortedQueue.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-yellow-500 rounded-full text-[9px] text-black flex items-center justify-center font-bold">{sortedQueue.length}</span>
                  )}
                </button>
                <button onClick={() => { togglePanel('polls'); setShowAllControls(false); }} title="نظرسنجی"
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'polls' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <BarChart2 className="w-5 h-5" />
                </button>
                <button onClick={() => { togglePanel('whiteboard'); setShowAllControls(false); }} title="وایت‌بورد"
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'whiteboard' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <PenTool className="w-5 h-5" />
                </button>
                <button onClick={() => { togglePanel('settings'); setShowAllControls(false); }} title="تنظیمات"
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'settings' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <SlidersHorizontal className="w-5 h-5" />
                </button>
                <button onClick={() => dispatch({ type: 'SET_SPEAKER_MUTED', value: !isSpeakerMuted })} title={isSpeakerMuted ? 'فعال کردن صدا' : 'قطع صدا'}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${isSpeakerMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                {checkPermission('mute_all') && (
                  <button onClick={muteAll} title="قطع میکروفون همه"
                    className="w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg bg-amber-700 hover:bg-amber-600">
                    <ShieldAlert className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div role="toolbar" aria-label="کنترل‌های جلسه" className="flex items-center justify-center gap-2 px-3 py-3 overflow-x-auto">
            <button onClick={toggleMute} aria-label={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'} aria-pressed={isMuted}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <button onClick={toggleVideo} aria-label={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'} aria-pressed={isVideoOff}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isVideoOff ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
            {room.allow_screen_share && (
              <button onClick={isScreenSharing ? stopScreenShare : startScreenShare} aria-label={isScreenSharing ? 'توقف اشتراک صفحه' : 'شروع اشتراک صفحه'} aria-pressed={isScreenSharing}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isScreenSharing ? 'bg-teal-600 hover:bg-teal-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                {isScreenSharing ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
              </button>
            )}
            <button onClick={toggleHand} aria-label={isHandRaised ? 'پایین آوردن دست' : 'بلند کردن دست'} aria-pressed={isHandRaised}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isHandRaised ? 'bg-yellow-500 hover:bg-yellow-400' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <Hand className="w-5 h-5" />
            </button>
            {room.allow_reactions && (
              <div className="flex-shrink-0">
                <button onClick={() => setShowEmojiPicker(v => !v)} aria-label="ارسال واکنش ایموجی" aria-expanded={showEmojiPicker}
                  aria-pressed={showEmojiPicker}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg ${showEmojiPicker ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <Smile className="w-5 h-5" />
                </button>
              </div>
            )}
            {room.allow_chat && (
              <button onClick={() => togglePanel('chat')} aria-label="باز کردن پنل چت" aria-pressed={sidePanel === 'chat'}
                className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'chat' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                <MessageSquare className="w-5 h-5" />
                {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold">{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </button>
            )}
            <button onClick={() => togglePanel('participants')} aria-label="باز کردن لیست شرکت‌کنندگان" aria-pressed={sidePanel === 'participants'}
              className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'participants' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <Users className="w-5 h-5" />
              {sortedQueue.length > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full text-xs text-black flex items-center justify-center font-bold">{sortedQueue.length}</span>
              )}
            </button>
            <button onClick={() => togglePanel('polls')} aria-label="باز کردن نظرسنجی" aria-pressed={sidePanel === 'polls'}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'polls' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <BarChart2 className="w-5 h-5" />
            </button>
            <button onClick={() => togglePanel('whiteboard')} aria-label="باز کردن وایت‌بورد" aria-pressed={sidePanel === 'whiteboard'}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'whiteboard' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <PenTool className="w-5 h-5" />
            </button>
            <button onClick={() => togglePanel('settings')} aria-label="تنظیمات" aria-pressed={sidePanel === 'settings'}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'settings' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <SlidersHorizontal className="w-5 h-5" />
            </button>
            <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
            <button onClick={() => dispatch({ type: 'SET_SPEAKER_MUTED', value: !isSpeakerMuted })} aria-label={isSpeakerMuted ? 'فعال کردن صدای اسپیکر' : 'قطع صدای اسپیکر'} aria-pressed={isSpeakerMuted}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isSpeakerMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            {checkPermission('mute_all') && peers.size > 0 && (
              <button onClick={muteAll} aria-label="قطع میکروفون همه شرکت‌کنندگان"
                className="w-12 h-12 rounded-full bg-amber-700 hover:bg-amber-600 flex items-center justify-center transition-all shadow-lg flex-shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </button>
            )}
            <button onClick={leaveRoom} aria-label="ترک یا پایان جلسه"
              className="w-14 h-12 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all shadow-lg flex-shrink-0">
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
