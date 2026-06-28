import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, MessageSquare, Users,
  Hand, ScreenShare, ScreenShareOff, Maximize2, Minimize2,
  Crown, Pin, X, Send, Copy, Check, Loader2,
  Grid2x2 as Grid, LayoutGrid as Layout, Smile, BarChart2,
  PenTool, Trash2, Volume2, VolumeX, Activity, UserPlus,
  ShieldAlert, UserX, Mic2, Settings2, ChevronUp, ChevronDown,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';
import type {
  ConferenceRoom, ConferenceParticipant, ConferenceMessage,
  PeerConnection, ConferencePoll, WhiteboardStroke, Reaction,
} from './types';

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

interface Props {
  room: ConferenceRoom;
  currentUserId: string;
  currentUserName: string;
  myPeerId: string;
  localStream: MediaStream;
  onLeave: () => void;
  onInvite?: () => void;
}

type LayoutMode = 'grid' | 'sidebar';
type SidePanel = 'chat' | 'participants' | 'polls' | 'whiteboard' | null;

// ── Quality dot ───────────────────────────────────────────────────────────────
function QualityDot({ quality }: { quality: PeerConnection['networkQuality'] }) {
  const c = { excellent:'bg-green-500', good:'bg-teal-400', fair:'bg-amber-400', poor:'bg-red-500' };
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c[quality] ?? 'bg-gray-400'}`} />;
}

// ── Video tile ────────────────────────────────────────────────────────────────
function VideoTile({ stream, displayName, isMuted, isVideoOff, isHandRaised, isLocal, isPinned, isHost, networkQuality, onPin, small = false }: {
  stream: MediaStream | null; displayName: string; isMuted: boolean; isVideoOff: boolean;
  isHandRaised: boolean; isLocal: boolean; isPinned: boolean; isHost: boolean;
  networkQuality: PeerConnection['networkQuality']; onPin: () => void; small?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    // Always reassign so track replacements (screen share ↔ camera) take effect
    el.srcObject = stream;
    el.play().catch(() => {});

    // When tracks are added/replaced in the same stream object, re-attach
    const onAddTrack = () => {
      el.srcObject = null;
      el.srcObject = stream;
      el.play().catch(() => {});
    };
    stream.addEventListener('addtrack', onAddTrack);
    return () => stream.removeEventListener('addtrack', onAddTrack);
  }, [stream]);

  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  const ring = isHandRaised ? 'ring-2 ring-yellow-400' : isPinned ? 'ring-2 ring-teal-400' : '';

  return (
    <div className={`relative bg-gray-900 rounded-2xl overflow-hidden cursor-pointer aspect-video ${ring}`} onClick={onPin}>
      {!isVideoOff && stream ? (
        <video ref={videoRef} autoPlay playsInline muted={isLocal}
          className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`} />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950">
          <div className={`rounded-full flex items-center justify-center font-bold text-white bg-gradient-to-br from-teal-600 to-teal-800 ${small ? 'w-10 h-10 text-base' : 'w-20 h-20 text-3xl'}`}>
            {initials}
          </div>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
        <div className="flex items-center gap-1.5">
          <QualityDot quality={networkQuality} />
          <span className={`text-white font-medium truncate flex-1 ${small ? 'text-xs' : 'text-sm'}`}>
            {isLocal ? `${displayName} (شما)` : displayName}
          </span>
          {isHost && <Crown className={`text-amber-400 flex-shrink-0 ${small ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
          {isHandRaised && <Hand className={`text-yellow-400 animate-bounce flex-shrink-0 ${small ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
          {isMuted && <MicOff className={`text-red-400 flex-shrink-0 ${small ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
          {isVideoOff && <VideoOff className={`text-red-400 flex-shrink-0 ${small ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
        </div>
      </div>
      {isPinned && !small && <div className="absolute top-2 right-2 bg-teal-500/90 rounded-lg p-1"><Pin className="w-3 h-3 text-white" /></div>}
    </div>
  );
}

// ── Whiteboard (touch + mouse) ────────────────────────────────────────────────
function Whiteboard({ roomId, userId }: { roomId: string; userId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [tool, setTool] = useState<'pen' | 'eraser'>('pen');
  const [color, setColor] = useState('#00d4aa');
  const [width, setWidth] = useState(4);
  const drawing = useRef(false);
  const currentPath = useRef<{ x: number; y: number }[]>([]);

  const getPos = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: (clientX - rect.left) / rect.width * canvas.width, y: (clientY - rect.top) / rect.height * canvas.height };
  };

  const drawStroke = useCallback((ctx: CanvasRenderingContext2D, stroke: WhiteboardStroke) => {
    if (stroke.points.length < 2) return;
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over';
    ctx.strokeStyle = stroke.color; ctx.lineWidth = stroke.width; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    stroke.points.slice(1).forEach(p => ctx.lineTo(p.x, p.y)); ctx.stroke();
  }, []);

  const startDraw = (x: number, y: number) => { drawing.current = true; currentPath.current = [getPos(x, y)]; };
  const moveDraw = (x: number, y: number) => {
    if (!drawing.current) return;
    currentPath.current.push(getPos(x, y));
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx && currentPath.current.length >= 2) drawStroke(ctx, { id:'', userId, points: currentPath.current, color, width, tool });
  };
  const endDraw = async () => {
    if (!drawing.current || currentPath.current.length < 2) { drawing.current = false; return; }
    const stroke: WhiteboardStroke = { id: crypto.randomUUID(), userId, points: [...currentPath.current], color, width, tool };
    drawing.current = false; currentPath.current = [];
    const { error } = await supabase.from('conference_whiteboard').insert({ room_id: roomId, user_id: userId, stroke_data: stroke });
    if (error) console.error('whiteboard insert error:', error);
  };

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('conference_whiteboard').select('stroke_data').eq('room_id', roomId).order('created_at');
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx || !data) return;
      data.forEach(({ stroke_data }) => drawStroke(ctx, stroke_data as WhiteboardStroke));
    };
    load();
    const ch = supabase.channel(`wb-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conference_whiteboard', filter: `room_id=eq.${roomId}` },
        ({ new: row }) => {
          const ctx = canvasRef.current?.getContext('2d');
          if (ctx && row.stroke_data?.userId !== userId) drawStroke(ctx, row.stroke_data as WhiteboardStroke);
        })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [roomId, userId, drawStroke]);

  const COLORS = ['#00d4aa','#3b82f6','#ef4444','#f59e0b','#ec4899','#ffffff','#374151','#000000'];

  return (
    <div className="flex flex-col h-full gap-2 p-2">
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        <div className="flex gap-1 bg-gray-800 rounded-xl p-1">
          {(['pen','eraser'] as const).map(t => (
            <button key={t} onClick={() => setTool(t)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${tool === t ? 'bg-teal-600 text-white' : 'text-gray-400 hover:text-white'}`}>
              {t === 'pen' ? 'قلم' : 'پاک‌کن'}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          {COLORS.map(c => (
            <button key={c} onClick={() => setColor(c)}
              className={`w-6 h-6 rounded-full border-2 transition-transform ${color === c ? 'border-white scale-125' : 'border-transparent'}`}
              style={{ background: c }} />
          ))}
        </div>
        <select value={width} onChange={e => setWidth(Number(e.target.value))}
          className="bg-gray-800 text-white text-xs rounded-lg px-2 py-1.5 border border-gray-700">
          {[2,4,8,14,20].map(w => <option key={w} value={w}>{w}px</option>)}
        </select>
        <button onClick={() => { const ctx = canvasRef.current?.getContext('2d'); if (ctx) ctx.clearRect(0,0,canvasRef.current!.width,canvasRef.current!.height); supabase.from('conference_whiteboard').delete().eq('room_id', roomId).then(()=>{}); }}
          className="p-1.5 bg-red-900/40 hover:bg-red-900/60 text-red-400 rounded-lg transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 rounded-xl overflow-hidden bg-white min-h-0">
        <canvas ref={canvasRef} width={1200} height={700} className="w-full h-full"
          style={{ cursor: tool === 'eraser' ? 'cell' : 'crosshair', touchAction: 'none' }}
          onMouseDown={e => startDraw(e.clientX, e.clientY)}
          onMouseMove={e => moveDraw(e.clientX, e.clientY)}
          onMouseUp={endDraw} onMouseLeave={endDraw}
          onTouchStart={e => { e.preventDefault(); startDraw(e.touches[0].clientX, e.touches[0].clientY); }}
          onTouchMove={e => { e.preventDefault(); moveDraw(e.touches[0].clientX, e.touches[0].clientY); }}
          onTouchEnd={e => { e.preventDefault(); endDraw(); }} />
      </div>
    </div>
  );
}

// ── Poll panel ────────────────────────────────────────────────────────────────
function PollPanel({ roomId, userId, isHost }: { roomId: string; userId: string; isHost: boolean }) {
  const [polls, setPolls] = useState<ConferencePoll[]>([]);
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const loadPolls = useCallback(async () => {
    const { data: pData } = await supabase.from('conference_polls').select('*').eq('room_id', roomId).order('created_at', { ascending: false });
    if (!pData) return;
    const pollsWithVotes = await Promise.all(pData.map(async p => {
      const { data: votes } = await supabase.from('conference_poll_votes').select('option_index').eq('poll_id', p.id);
      const { data: myVote } = await supabase.from('conference_poll_votes').select('option_index').eq('poll_id', p.id).eq('user_id', userId).maybeSingle();
      const voteCounts: Record<number, number> = {};
      votes?.forEach(v => { voteCounts[v.option_index] = (voteCounts[v.option_index] || 0) + 1; });
      return { ...p, options: p.options as string[], votes: voteCounts, my_vote: myVote?.option_index ?? null };
    }));
    setPolls(pollsWithVotes);
  }, [roomId, userId]);

  useEffect(() => {
    loadPolls();
    const ch = supabase.channel(`polls-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_polls', filter: `room_id=eq.${roomId}` }, loadPolls)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conference_poll_votes' }, loadPolls)
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [roomId, loadPolls]);

  const createPoll = async () => {
    if (!question.trim() || options.filter(o => o.trim()).length < 2) { toast.error('سوال و حداقل ۲ گزینه لازم است'); return; }
    setCreating(true);
    await supabase.from('conference_polls').insert({ room_id: roomId, created_by: userId, question, options: options.filter(o => o.trim()) });
    setQuestion(''); setOptions(['', '']); setShowCreate(false); setCreating(false);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto p-3 gap-3">
      {isHost && (
        <button onClick={() => setShowCreate(v => !v)}
          className="w-full py-2 bg-teal-700 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-2">
          <BarChart2 className="w-4 h-4" /> نظرسنجی جدید
        </button>
      )}
      {showCreate && (
        <div className="bg-gray-800 rounded-xl p-3 space-y-2">
          <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="سوال..."
            className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
          {options.map((o, i) => (
            <input key={i} value={o} onChange={e => { const a = [...options]; a[i] = e.target.value; setOptions(a); }}
              placeholder={`گزینه ${i + 1}`} className="w-full bg-gray-700 text-white rounded-lg px-3 py-2 text-sm" />
          ))}
          <button onClick={() => setOptions(o => [...o, ''])} className="text-teal-400 text-xs">+ گزینه جدید</button>
          <button onClick={createPoll} disabled={creating}
            className="w-full py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-sm font-medium disabled:opacity-50">
            {creating ? <Loader2 className="w-4 h-4 animate-spin mx-auto" /> : 'ایجاد'}
          </button>
        </div>
      )}
      {polls.map(poll => {
        const total = Object.values(poll.votes || {}).reduce((a, b) => a + b, 0);
        return (
          <div key={poll.id} className="bg-gray-800 rounded-xl p-3">
            <p className="text-white text-sm font-medium mb-2">{poll.question}</p>
            <div className="space-y-1.5">
              {poll.options.map((opt, i) => {
                const cnt = poll.votes?.[i] || 0;
                const pct = total ? Math.round(cnt / total * 100) : 0;
                return (
                  <button key={i} onClick={() => poll.my_vote == null && supabase.from('conference_poll_votes').insert({ poll_id: poll.id, user_id: userId, option_index: i }).then(() => loadPolls())}
                    className={`w-full text-right rounded-lg overflow-hidden relative transition-all ${poll.my_vote === i ? 'ring-2 ring-teal-400' : 'hover:opacity-80'}`}
                    disabled={poll.my_vote != null}>
                    <div className="absolute inset-0 bg-teal-900/40" style={{ width: `${pct}%` }} />
                    <div className="relative flex justify-between items-center px-3 py-2 text-sm">
                      <span className="text-white">{opt}</span><span className="text-teal-300 text-xs font-mono">{pct}%</span>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-gray-500 text-xs mt-1.5">{total} رای</p>
          </div>
        );
      })}
      {polls.length === 0 && <p className="text-center text-gray-500 text-sm py-8">هنوز نظرسنجی‌ای وجود ندارد</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Main component ────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
export function ConferenceRoomView({ room, currentUserId, currentUserName, myPeerId, localStream, onLeave, onInvite }: Props) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [peers, setPeers] = useState<Map<string, PeerConnection>>(new Map());
  const [messages, setMessages] = useState<ConferenceMessage[]>([]);
  const [messageInput, setMessageInput] = useState('');
  const [reactions, setReactions] = useState<Reaction[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [isHandRaised, setIsHandRaised] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [pinnedPeerId, setPinnedPeerId] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('grid');
  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [duration, setDuration] = useState(0);
  const [codeCopied, setCodeCopied] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [myQuality, setMyQuality] = useState<PeerConnection['networkQuality']>('good');
  const [tileSize, setTileSize] = useState(3); // 1=large, 2=medium, 3=default, 4=small, 5=tiny

  const isHost = room.host_id === currentUserId;

  // ── Refs (never stale in callbacks) ───────────────────────────────────────
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const iceCandidateQueue = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());

  // Keep mutable refs for values used inside channel callbacks
  // This avoids stale closures without recreating the channel
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

  // Heartbeat — update presence every 15s so stale records can be detected
  useEffect(() => {
    const t = setInterval(async () => {
      await supabase.from('conference_participants')
        .update({ updated_at: new Date().toISOString() } as any)
        .eq('room_id', room.id).eq('user_id', currentUserId).eq('status', 'joined');
    }, 15000);
    return () => clearInterval(t);
  }, [room.id, currentUserId]);

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}` : `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;
  };

  // ── Core WebRTC helpers (using refs, never stale) ─────────────────────────

  // Send via Broadcast channel (instant, <50ms) + DB for persistence/late-joiners
  const sendSignal = useCallback((toPeerId: string | null, type: string, data: object) => {
    const payload = {
      from: myPeerIdRef.current,
      from_user_id: currentUserId,
      from_name: currentUserName,
      to: toPeerId,
      type,
      data,
    };
    // Broadcast: instant delivery to all currently subscribed peers
    channelRef.current?.send({ type: 'broadcast', event: 'signal', payload });
    // DB: for late-joiners who weren't subscribed yet (only for 'join' announcement)
    if (type === 'join') {
      supabase.from('conference_signals').insert({
        room_id: room.id,
        from_peer_id: myPeerIdRef.current,
        from_user_id: currentUserId,
        from_display_name: currentUserName,
        to_peer_id: null,
        type: 'join',
        payload: data,
      }).then(() => {});
    }
  }, [currentUserId, currentUserName, room.id]);

  // Create RTCPeerConnection and wire up handlers
  const buildPC = useCallback((remotePeerId: string, remoteUserId: string, remoteDisplayName: string): RTCPeerConnection => {
    const pc = new RTCPeerConnection(RTC_CONFIG);

    // Add local tracks
    localStreamRef.current.getTracks().forEach(track => pc.addTrack(track, localStreamRef.current));

    // Remote track received
    pc.ontrack = (e) => {
      const stream = e.streams[0];
      if (!stream) return;
      const cur = peersRef.current.get(remotePeerId);
      if (cur) { peersRef.current.set(remotePeerId, { ...cur, stream }); setPeers(new Map(peersRef.current)); }
    };

    // ICE candidate ready
    pc.onicecandidate = (e) => {
      if (e.candidate) sendSignal(remotePeerId, 'ice', { candidate: e.candidate.toJSON() });
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
      const cur = peersRef.current.get(remotePeerId);
      if (cur) { peersRef.current.set(remotePeerId, { ...cur, connectionState: pc.connectionState }); setPeers(new Map(peersRef.current)); }
      if (pc.connectionState === 'connected') toast.success(`${remoteDisplayName} وارد شد`);
      if (pc.connectionState === 'disconnected') {
        // Start a 30s grace period; if still disconnected, remove the peer
        setTimeout(() => {
          if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            pc.close();
            peersRef.current.delete(remotePeerId);
            setPeers(new Map(peersRef.current));
            // Send leave signal so other peers clean up
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

    // Store
    const conn: PeerConnection = { peerId: remotePeerId, userId: remoteUserId, displayName: remoteDisplayName, pc, stream: null, isMuted: false, isVideoOff: false, isHandRaised: false, connectionState: 'new', networkQuality: 'good', speakingSeconds: 0 };
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

  // Stable refs — updated every render so channel callbacks are never stale
  const makeOfferRef = useRef(makeOffer);
  const sendSignalRef = useRef(sendSignal);
  const getPCRef = useRef(getPC);
  const flushICERef = useRef(flushICE);
  const stopScreenShareRef = useRef<() => void>(() => {});
  makeOfferRef.current = makeOffer;
  sendSignalRef.current = sendSignal;
  getPCRef.current = getPC;
  flushICERef.current = flushICE;

  // ── Single channel setup — stable for room lifetime ───────────────────────
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
          // New peer announced their arrival.
          // Only the peer with the lower peerId makes the offer (deterministic, prevents glare).
          if (myPeerIdRef.current < from) {
            await makeOfferRef.current(from, from_user_id, from_name);
          } else {
            // We have higher peerId: just prepare PC and wait for their offer
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
          // A peer was force-removed due to disconnect timeout
          const targetPeerId = data.peerId as string;
          const cur = peersRef.current.get(targetPeerId);
          if (cur) { cur.pc.close(); peersRef.current.delete(targetPeerId); setPeers(new Map(peersRef.current)); }

        } else if (type === 'end') {
          // Host ended the room — all participants must leave
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          toast.error('میزبان جلسه را پایان داد');
          onLeave();

        } else if (type === 'state') {
          const cur = peersRef.current.get(from);
          if (cur) { peersRef.current.set(from, { ...cur, isMuted: data.isMuted, isVideoOff: data.isVideoOff, isHandRaised: data.isHandRaised }); setPeers(new Map(peersRef.current)); }

        } else if (type === 'chat') {
          setMessages(prev => [...prev, data]);
          if (sidePanelRef.current !== 'chat') setUnreadCount(c => c + 1);

        } else if (type === 'reaction') {
          const r: Reaction = { ...data, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20, createdAt: Date.now() };
          setReactions(prev => [...prev, r]);
          setTimeout(() => setReactions(prev => prev.filter(x => x.id !== r.id)), 3000);

        } else if (type === 'host_mute_all') {
          // Host asked everyone to mute
          localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
          setIsMuted(true);
          toast(`میزبان درخواست قطع میکروفون داد`);

        } else if (type === 'kick') {
          // We were kicked
          toast.error('شما توسط میزبان از جلسه خارج شدید');
          for (const p of peersRef.current.values()) p.pc.close();
          peersRef.current.clear();
          onLeave();
        }
      })();
    })
    .subscribe(async (status) => {
      if (status !== 'SUBSCRIBED') return;

      // Announce join to everyone currently in channel
      sendSignalRef.current(null, 'join', { userId: currentUserId, displayName: currentUserName, peerId: myPeerId });

      // Connect to participants already in DB (joined before us).
      // Give a short delay so our own participant record with peer_id is committed.
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
            // We have lower peerId — make the offer (deterministic rule)
            await makeOfferRef.current(p.peer_id, p.user_id, p.display_name);
          } else {
            // We have higher peerId — prepare PC; peer with lower ID should offer us.
            // But give them 1.5s to do so; if no offer arrives, we take over.
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

    // Listen for room ended via DB (catches late-joiners and guests)
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
          setIsMuted(true);
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

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

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

  const toggleMute = () => { const n = !isMuted; localStream.getAudioTracks().forEach(t => { t.enabled = !n; }); setIsMuted(n); broadcastState(n, isVideoOff, isHandRaised); };
  const toggleVideo = () => { const n = !isVideoOff; localStream.getVideoTracks().forEach(t => { t.enabled = !n; }); setIsVideoOff(n); broadcastState(isMuted, n, isHandRaised); };
  const toggleHand = () => { const n = !isHandRaised; setIsHandRaised(n); broadcastState(isMuted, isVideoOff, n); if (n) toast('دست شما بلند شد'); };

  const startScreenShare = async () => {
    try {
      const ss = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = ss;
      const screenTrack = ss.getVideoTracks()[0];

      // Replace video track in every peer connection
      for (const p of peersRef.current.values()) {
        const sender = p.pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
          await sender.replaceTrack(screenTrack).catch(err => console.error('replaceTrack error:', err));
        } else {
          p.pc.addTrack(screenTrack, localStreamRef.current);
        }
      }

      setIsScreenSharing(true);
      sendSignal(null, 'state', { peerId: myPeerId, isMuted, isVideoOff, isHandRaised, isScreenSharing: true });

      screenTrack.onended = () => stopScreenShareRef.current();
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        toast.error('دسترسی به اشتراک‌گذاری صفحه رد شد');
      } else if (e?.name === 'TypeError') {
        toast.error('لطفاً مرورگر خود را به‌روز کنید یا افزونه موردنیاز را نصب کنید');
      } else if (e?.name !== 'AbortError') {
        toast.error('خطا در اشتراک‌گذاری صفحه');
      }
    }
  };

  const stopScreenShare = useCallback(async () => {
    // Stop all screen tracks
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    // Restore camera video track in every peer connection
    const camTrack = localStreamRef.current.getVideoTracks()[0] ?? null;

    for (const p of peersRef.current.values()) {
      const sender = p.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        if (camTrack) {
          // Re-enable the track before replacing
          camTrack.enabled = !isVideoOff;
          await sender.replaceTrack(camTrack).catch(() => {});
        } else {
          await sender.replaceTrack(null).catch(() => {});
        }
      }
    }

    setIsScreenSharing(false);

    // Broadcast updated state so remotes re-render their video tiles
    broadcastState(isMuted, isVideoOff, isHandRaised);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMuted, isVideoOff, isHandRaised]);

  // Keep stopScreenShare ref up-to-date (used in screenTrack.onended)
  stopScreenShareRef.current = stopScreenShare;

  const sendEmoji = (emoji: string) => {
    setShowEmojiPicker(false);
    const r: Reaction = { id: crypto.randomUUID(), userId: currentUserId, displayName: currentUserName, emoji, x: 0, y: 0, createdAt: Date.now() };
    sendSignal(null, 'reaction', r);
    setReactions(prev => [...prev, { ...r, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20 }]);
    setTimeout(() => setReactions(prev => prev.filter(x => x.id !== r.id)), 3000);
  };

  const sendMessage = async () => {
    const body = messageInput.trim();
    if (!body) return;
    const tempId = crypto.randomUUID();
    const msg: ConferenceMessage = { id: tempId, room_id: room.id, user_id: currentUserId, display_name: currentUserName, body, created_at: new Date().toISOString() };
    sendSignal(null, 'chat', msg);
    setMessages(prev => [...prev, msg]);
    setMessageInput('');
    const { error } = await supabase.from('conference_messages').insert([msg]);
    if (error) {
      console.error('sendMessage DB error:', error);
      // silently fail persist — message was already delivered via broadcast
    }
  };

  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [showAllControls, setShowAllControls] = useState(false);

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  // ── Host management ────────────────────────────────────────────────────────
  const muteAll = async () => {
    sendSignal(null, 'host_mute_all', { fromHost: currentUserName });
    // Log server-side
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
    // Log server-side
    if (targetPeer) {
      const { error } = await supabase.from('room_mod_actions').insert({
        room_id: room.id, by_admin_id: currentUserId,
        target_user_id: targetPeer.userId, action_type: 'kick',
      });
      if (error) console.error('kick mod_action error:', error);
      // Mark participant as left in DB
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
    { peerId: myPeerId, userId: currentUserId, displayName: currentUserName, stream: localStream, isMuted, isVideoOff, isHandRaised, isLocal: true, isHost, networkQuality: myQuality },
    ...Array.from(peers.values()).map(p => ({ peerId: p.peerId, userId: p.userId, displayName: p.displayName, stream: p.stream, isMuted: p.isMuted, isVideoOff: p.isVideoOff, isHandRaised: p.isHandRaised, isLocal: false, isHost: room.host_id === p.userId, networkQuality: p.networkQuality })),
  ];

  const qualityColor = { excellent:'text-green-400', good:'text-teal-400', fair:'text-amber-400', poor:'text-red-400' };

  // Core controls always visible on mobile
  const coreControls = (
    <>
      <button onClick={toggleMute} title={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'}
        className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
        {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>
      <button onClick={toggleVideo} title={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'}
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
          <button onClick={() => setLayoutMode(l => l === 'grid' ? 'sidebar' : 'grid')} title="تغییر نمای ویدیو" className="p-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors hidden sm:flex">
            {layoutMode === 'grid' ? <Layout className="w-4 h-4" /> : <Grid className="w-4 h-4" />}
          </button>
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
        <div className="flex-1 flex flex-col overflow-hidden p-2 gap-2 min-w-0">
          {/* Tile size slider — desktop only */}
          {!pinnedPeerId && layoutMode === 'grid' && allTiles.length > 1 && (
            <div className="hidden sm:flex items-center gap-2 flex-shrink-0 px-1">
              <span className="text-gray-500 text-xs">کوچک</span>
              <input type="range" min={1} max={5} value={tileSize}
                onChange={e => setTileSize(Number(e.target.value))}
                className="flex-1 h-1.5 accent-teal-500 cursor-pointer" />
              <span className="text-gray-500 text-xs">بزرگ</span>
            </div>
          )}

          {pinnedPeerId ? (
            <div className="flex flex-col flex-1 gap-2 min-h-0">
              <div className="flex-1 min-h-0">
                {allTiles.filter(t => t.peerId === pinnedPeerId).map(t => (
                  <VideoTile key={t.peerId} {...t} isPinned isHost={t.isHost} onPin={() => setPinnedPeerId(null)} />
                ))}
              </div>
              <div className="flex gap-2 flex-shrink-0 overflow-x-auto pb-1">
                {allTiles.filter(t => t.peerId !== pinnedPeerId).map(t => (
                  <div key={t.peerId} className="w-28 sm:w-32 flex-shrink-0">
                    <VideoTile {...t} isPinned={false} isHost={t.isHost} onPin={() => setPinnedPeerId(t.peerId)} small />
                  </div>
                ))}
              </div>
            </div>
          ) : layoutMode === 'sidebar' ? (
            <div className="flex flex-1 gap-2 min-h-0">
              <div className="w-28 sm:w-36 flex-shrink-0 flex flex-col gap-2 overflow-y-auto">
                {allTiles.slice(1).map(t => (
                  <VideoTile key={t.peerId} {...t} isPinned={false} isHost={t.isHost} onPin={() => setPinnedPeerId(t.peerId)} small />
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <VideoTile {...allTiles[0]} isPinned={false} isHost={allTiles[0].isHost} onPin={() => {}} />
              </div>
            </div>
          ) : (
            <div className={`flex-1 overflow-y-auto grid gap-2 content-start ${
              tileSize === 1 ? 'grid-cols-1' :
              tileSize === 2 ? 'grid-cols-2' :
              tileSize === 3 ? (
                allTiles.length === 1 ? 'grid-cols-1' :
                allTiles.length <= 2 ? 'grid-cols-1 sm:grid-cols-2' :
                allTiles.length <= 4 ? 'grid-cols-2' :
                allTiles.length <= 9 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'
              ) :
              tileSize === 4 ? 'grid-cols-2 sm:grid-cols-4' :
              'grid-cols-2 sm:grid-cols-5 md:grid-cols-6'
            }`}>
              {allTiles.map(t => (
                <VideoTile key={t.peerId} {...t}
                  isPinned={pinnedPeerId === t.peerId}
                  isHost={t.isHost}
                  onPin={() => setPinnedPeerId(p => p === t.peerId ? null : t.peerId)}
                  small={tileSize >= 4} />
              ))}
            </div>
          )}
        </div>

        {/* Side panel — desktop: inline sidebar | mobile: overlay from bottom */}
        {sidePanel && (
          <>
            {/* Mobile overlay backdrop */}
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
              {/* Panel tab bar */}
              <div className="flex border-b border-gray-800 flex-shrink-0">
                {isMobile && (
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 w-10 h-1.5 bg-gray-600 rounded-full" />
                )}
                {(['chat','participants','polls','whiteboard'] as SidePanel[]).filter(Boolean).map(p => (
                  <button key={p!} onClick={() => togglePanel(p)}
                    className={`flex-1 py-2.5 text-xs font-medium transition-colors ${sidePanel === p ? 'text-teal-400 border-b-2 border-teal-400' : 'text-gray-500 hover:text-gray-300'}`}>
                    {p === 'chat' ? 'چت' : p === 'participants' ? 'افراد' : p === 'polls' ? 'نظرسنجی' : 'وایت‌بورد'}
                  </button>
                ))}
                <button onClick={() => setSidePanel(null)} className="px-3 text-gray-600 hover:text-gray-300 transition-colors flex-shrink-0">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {sidePanel === 'chat' && (
                <>
                  <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
                    {messages.map(m => (
                      <div key={m.id}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`text-xs font-semibold ${m.user_id === currentUserId ? 'text-teal-400' : 'text-amber-400'}`}>
                            {m.user_id === currentUserId ? 'شما' : m.display_name}
                          </span>
                          <span className="text-gray-600 text-xs">{moment(m.created_at).format('HH:mm')}</span>
                        </div>
                        <div className={`text-sm rounded-xl px-3 py-2 break-words ${m.user_id === currentUserId ? 'bg-teal-900/50 text-teal-100' : 'bg-gray-800 text-gray-200'}`}>
                          {m.body}
                        </div>
                      </div>
                    ))}
                    <div ref={chatEndRef} />
                  </div>
                  <div className="p-2 border-t border-gray-800 flex gap-2">
                    <input value={messageInput} onChange={e => setMessageInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
                      placeholder="پیام..." className="flex-1 bg-gray-800 text-white rounded-xl px-3 py-2 text-sm outline-none placeholder-gray-500 min-w-0" />
                    <button onClick={sendMessage} className="p-2 bg-teal-600 hover:bg-teal-500 rounded-xl transition-colors flex-shrink-0">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </>
              )}

              {sidePanel === 'participants' && (
                <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
                  {/* Host tools */}
                  {isHost && peers.size > 0 && (
                    <div className="p-2 bg-gray-800/60 rounded-xl space-y-1.5 border border-gray-700">
                      <p className="text-xs font-semibold text-amber-400 flex items-center gap-1.5">
                        <Crown className="w-3 h-3" />ابزار میزبان
                      </p>
                      <button onClick={muteAll}
                        className="w-full flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-amber-900/40 text-gray-200 hover:text-amber-300 rounded-lg text-xs transition-colors">
                        <Mic2 className="w-3.5 h-3.5" />قطع میکروفون همه
                      </button>
                    </div>
                  )}
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
                        </div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {t.isHost && <Crown className="w-3.5 h-3.5 text-amber-400" />}
                        {t.isMuted && <MicOff className="w-3 h-3 text-red-400" />}
                        {t.isVideoOff && <VideoOff className="w-3 h-3 text-red-400" />}
                        {t.isHandRaised && <Hand className="w-3.5 h-3.5 text-yellow-400 animate-bounce" />}
                        {/* Host kick button */}
                        {isHost && !t.isLocal && (
                          <button onClick={() => kickParticipant(t.peerId, t.displayName)}
                            title="خارج کردن از جلسه"
                            className="p-1 rounded-lg bg-red-900/0 hover:bg-red-900/40 text-gray-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100">
                            <UserX className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {/* Pin button */}
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

              {sidePanel === 'polls' && <PollPanel roomId={room.id} userId={currentUserId} isHost={isHost} />}
              {sidePanel === 'whiteboard' && (
                <div className="flex-1 overflow-hidden min-h-0">
                  <Whiteboard roomId={room.id} userId={currentUserId} />
                </div>
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
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 bg-teal-600/95 rounded-full px-4 py-1.5 flex items-center gap-2 text-sm font-medium text-white shadow-lg pointer-events-none">
          <ScreenShare className="w-4 h-4" />{currentUserName} در حال ارائه صفحه است
        </div>
      )}

      {/* Floating reactions */}
      {reactions.map(r => (
        <div key={r.id} className="fixed pointer-events-none z-[9999] text-3xl"
          style={{ left: `${r.x}%`, top: `${r.y}%`, animation: 'float-up 3s ease-out forwards' }}>
          {r.emoji}
        </div>
      ))}

      {/* Bottom controls */}
      <div className="bg-gray-900/95 border-t border-gray-800 flex-shrink-0" dir="rtl">
        {/* Mobile: primary controls row + expand toggle */}
        {isMobile ? (
          <>
            <div className="flex items-center justify-center gap-2 px-3 py-2.5">
              {coreControls}
              <button onClick={() => setShowAllControls(v => !v)}
                className="w-11 h-11 rounded-full flex items-center justify-center bg-gray-700 hover:bg-gray-600 transition-all flex-shrink-0">
                {showAllControls ? <ChevronDown className="w-5 h-5" /> : <ChevronUp className="w-5 h-5" />}
              </button>
            </div>
            {/* Expanded secondary controls */}
            {showAllControls && (
              <div className="flex items-center justify-center gap-2 px-3 pb-3 flex-wrap">
                {room.allow_screen_share && (
                  <button onClick={isScreenSharing ? stopScreenShare : startScreenShare} title="اشتراک صفحه"
                    className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${isScreenSharing ? 'bg-teal-600 hover:bg-teal-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                    {isScreenSharing ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
                  </button>
                )}
                <button onClick={toggleHand} title="بلند کردن دست"
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${isHandRaised ? 'bg-yellow-500 hover:bg-yellow-400' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <Hand className="w-5 h-5" />
                </button>
                {room.allow_reactions && (
                  <div className="relative">
                    <button onClick={() => setShowEmojiPicker(v => !v)} title="واکنش"
                      className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${showEmojiPicker ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                      <Smile className="w-5 h-5" />
                    </button>
                    {showEmojiPicker && (
                      <div className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-gray-800 rounded-2xl p-2 flex flex-wrap gap-1 shadow-2xl border border-gray-700 z-50 w-48">
                        {EMOJIS.map(e => <button key={e} onClick={() => sendEmoji(e)} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-700 text-lg transition-colors">{e}</button>)}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => { togglePanel('participants'); setShowAllControls(false); }} title="شرکت‌کنندگان"
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'participants' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <Users className="w-5 h-5" />
                </button>
                <button onClick={() => { togglePanel('polls'); setShowAllControls(false); }} title="نظرسنجی"
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'polls' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <BarChart2 className="w-5 h-5" />
                </button>
                <button onClick={() => { togglePanel('whiteboard'); setShowAllControls(false); }} title="وایت‌بورد"
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${sidePanel === 'whiteboard' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <PenTool className="w-5 h-5" />
                </button>
                <button onClick={() => setIsSpeakerMuted(v => !v)} title={isSpeakerMuted ? 'فعال کردن صدا' : 'قطع صدا'}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg ${isSpeakerMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                {isHost && (
                  <button onClick={muteAll} title="قطع میکروفون همه"
                    className="w-11 h-11 rounded-full flex items-center justify-center transition-all shadow-lg bg-amber-700 hover:bg-amber-600">
                    <ShieldAlert className="w-5 h-5" />
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          /* Desktop: single scrollable row */
          <div role="toolbar" aria-label="کنترل‌های جلسه" className="flex items-center justify-center gap-2 px-3 py-3 overflow-x-auto">
            <button onClick={toggleMute} title={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'} aria-label={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'} aria-pressed={isMuted}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            <button onClick={toggleVideo} title={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'} aria-label={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'} aria-pressed={isVideoOff}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isVideoOff ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {isVideoOff ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
            </button>
            {room.allow_screen_share && (
              <button onClick={isScreenSharing ? stopScreenShare : startScreenShare} title="اشتراک صفحه" aria-label={isScreenSharing ? 'توقف اشتراک صفحه' : 'شروع اشتراک صفحه'} aria-pressed={isScreenSharing}
                className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isScreenSharing ? 'bg-teal-600 hover:bg-teal-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
                {isScreenSharing ? <ScreenShareOff className="w-5 h-5" /> : <ScreenShare className="w-5 h-5" />}
              </button>
            )}
            <button onClick={toggleHand} title="بلند کردن دست" aria-label={isHandRaised ? 'پایین آوردن دست' : 'بلند کردن دست'} aria-pressed={isHandRaised}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isHandRaised ? 'bg-yellow-500 hover:bg-yellow-400' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <Hand className="w-5 h-5" />
            </button>
            {room.allow_reactions && (
              <div className="relative flex-shrink-0">
                <button onClick={() => setShowEmojiPicker(v => !v)} title="واکنش" aria-label="ارسال واکنش ایموجی" aria-expanded={showEmojiPicker}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg ${showEmojiPicker ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                  <Smile className="w-5 h-5" />
                </button>
                {showEmojiPicker && (
                  <div role="listbox" aria-label="انتخاب ایموجی" className="absolute bottom-14 left-1/2 -translate-x-1/2 bg-gray-800 rounded-2xl p-2 flex flex-wrap gap-1 shadow-2xl border border-gray-700 z-50 w-48">
                    {EMOJIS.map(e => <button key={e} onClick={() => sendEmoji(e)} aria-label={`واکنش ${e}`} className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-gray-700 text-lg transition-colors">{e}</button>)}
                  </div>
                )}
              </div>
            )}
            {room.allow_chat && (
              <button onClick={() => togglePanel('chat')} title="چت" aria-label="باز کردن پنل چت" aria-pressed={sidePanel === 'chat'}
                className={`relative w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'chat' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
                <MessageSquare className="w-5 h-5" />
                {unreadCount > 0 && <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-xs flex items-center justify-center font-bold" aria-label={`${unreadCount} پیام خوانده نشده`}>{unreadCount > 9 ? '9+' : unreadCount}</span>}
              </button>
            )}
            <button onClick={() => togglePanel('participants')} title="شرکت‌کنندگان" aria-label="باز کردن لیست شرکت‌کنندگان" aria-pressed={sidePanel === 'participants'}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'participants' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <Users className="w-5 h-5" />
            </button>
            <button onClick={() => togglePanel('polls')} title="نظرسنجی" aria-label="باز کردن نظرسنجی" aria-pressed={sidePanel === 'polls'}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'polls' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <BarChart2 className="w-5 h-5" />
            </button>
            <button onClick={() => togglePanel('whiteboard')} title="وایت‌بورد" aria-label="باز کردن وایت‌بورد" aria-pressed={sidePanel === 'whiteboard'}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${sidePanel === 'whiteboard' ? 'bg-teal-600' : 'bg-gray-700 hover:bg-gray-600'}`}>
              <PenTool className="w-5 h-5" />
            </button>
            <div className="w-px h-8 bg-gray-700 flex-shrink-0" />
            <button onClick={() => setIsSpeakerMuted(v => !v)} title={isSpeakerMuted ? 'فعال کردن صدا' : 'قطع صدا'} aria-label={isSpeakerMuted ? 'فعال کردن صدای اسپیکر' : 'قطع صدای اسپیکر'} aria-pressed={isSpeakerMuted}
              className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shadow-lg flex-shrink-0 ${isSpeakerMuted ? 'bg-red-600 hover:bg-red-500' : 'bg-gray-700 hover:bg-gray-600'}`}>
              {isSpeakerMuted ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
            </button>
            {/* Host-only: mute all */}
            {isHost && peers.size > 0 && (
              <button onClick={muteAll} title="قطع میکروفون همه شرکت‌کنندگان" aria-label="قطع میکروفون همه شرکت‌کنندگان"
                className="w-12 h-12 rounded-full bg-amber-700 hover:bg-amber-600 flex items-center justify-center transition-all shadow-lg flex-shrink-0">
                <ShieldAlert className="w-5 h-5" />
              </button>
            )}
            <button onClick={leaveRoom} title="ترک/پایان جلسه"
              className="w-14 h-12 rounded-full bg-red-600 hover:bg-red-500 flex items-center justify-center transition-all shadow-lg flex-shrink-0">
              <PhoneOff className="w-5 h-5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
