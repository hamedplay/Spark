import React, { useState, useEffect, useRef } from 'react';
import {
  Video, Plus, LogIn, Copy, Check, Loader2, Mic, MicOff,
  VideoOff, Users, Clock, Crown, Link2, UserPlus, Send,
  Search, X, ChevronRight, RefreshCw, Globe, Calendar, Lock, Unlock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ConferenceRoomView } from './ConferenceRoom';
import type { ConferenceRoom } from './types';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 9; i++) {
    if (i === 3 || i === 6) c += '-';
    c += chars[Math.floor(Math.random() * chars.length)];
  }
  return c;
}

// ── Invite modal ──────────────────────────────────────────────────────────────
interface UserProfile { user_id: string; full_name: string | null; email: string | null; }

function InviteModal({ room, currentUserId, onClose }: { room: ConferenceRoom; currentUserId: string; onClose: () => void }) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [linkCopied, setLinkCopied] = useState(false);

  const joinLink = `${window.location.origin}?conference=${room.code}`;

  useEffect(() => {
    supabase.from('profiles').select('user_id, full_name, email').neq('user_id', currentUserId).not('is_hidden', 'eq', true)
      .then(({ data }) => setUsers(data || []));
  }, [currentUserId]);

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });

  const copyLink = () => {
    navigator.clipboard.writeText(joinLink);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 2000);
    toast.success('لینک کپی شد');
  };

  const inviteUser = async (u: UserProfile) => {
    setSending(u.user_id);
    try {
      await supabase.from('notifications').insert([{
        user_id: u.user_id,
        title: `دعوت به ویدیو کنفرانس: ${room.name || 'جلسه ویدیویی'}`,
        message: `برای ورود به جلسه کد «${room.code}» را در بخش ویدیو کنفرانس وارد کنید`,
        type: 'meeting', read: false,
      }]);
      setSent(prev => new Set([...prev, u.user_id]));
      toast.success(`دعوتنامه به ${u.full_name || u.email} ارسال شد`);
    } catch { toast.error('خطا در ارسال'); }
    finally { setSending(null); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold dark:text-white flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-teal-500" /> دعوت از شرکت‌کنندگان
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">لینک دعوت (بدون نیاز به لاگین)</p>
            <div className="flex gap-2">
              <div className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <Link2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-xs text-gray-500 dark:text-gray-400 truncate font-mono">{joinLink}</span>
              </div>
              <button onClick={copyLink}
                className="flex items-center gap-1.5 px-3 py-2.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors flex-shrink-0">
                {linkCopied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {linkCopied ? 'کپی شد' : 'کپی'}
              </button>
            </div>
            <div className="mt-2 px-3 py-2 bg-blue-50 dark:bg-blue-900/20 rounded-xl flex items-center gap-2">
              <span className="text-xs text-blue-600 dark:text-blue-400">کد جلسه:</span>
              <span className="font-mono font-bold text-blue-700 dark:text-blue-300 text-base tracking-widest">{room.code}</span>
            </div>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">دعوت از کاربران سامانه</p>
            <div className="relative mb-3">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو نام یا ایمیل..."
                className="w-full pr-9 pl-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white text-sm" />
            </div>
            <div className="max-h-52 overflow-y-auto space-y-2">
              {filtered.length === 0
                ? <p className="text-center text-gray-400 text-sm py-4">کاربری یافت نشد</p>
                : filtered.map(u => (
                  <div key={u.user_id} className="flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-gray-800 rounded-xl">
                    <div className="w-9 h-9 rounded-full bg-teal-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                      {(u.full_name || u.email || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email}</p>
                    </div>
                    {sent.has(u.user_id) ? (
                      <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
                        <Check className="w-3.5 h-3.5" /> ارسال شد
                      </span>
                    ) : (
                      <button onClick={() => inviteUser(u)} disabled={sending === u.user_id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50">
                        {sending === u.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} دعوت
                      </button>
                    )}
                  </div>
                ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Room card ─────────────────────────────────────────────────────────────────
function RoomCard({ room, currentUserId, onJoin, onInvite }: {
  room: ConferenceRoom & { participant_count?: number; meeting?: any };
  currentUserId: string;
  onJoin: () => void;
  onInvite: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = room.host_id === currentUserId;

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(room.code);
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const meetingTime = room.meeting?.start_time && room.meeting?.end_time
    ? `${room.meeting.start_time} - ${room.meeting.end_time}`
    : null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-lg transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-800 dark:text-white truncate">{room.name || 'جلسه ویدیویی'}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-green-600 dark:text-green-400 font-medium">فعال</span>
            </div>
            {meetingTime && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />{meetingTime}
              </span>
            )}
          </div>
        </div>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isHost ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-teal-100 dark:bg-teal-900/30'}`}>
          {isHost ? <Crown className="w-4 h-4 text-amber-600 dark:text-amber-400" /> : <Users className="w-4 h-4 text-teal-600 dark:text-teal-400" />}
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 mb-4">
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          <span>{room.participant_count ?? 0} / {room.max_participants}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>{moment(room.created_at).fromNow()}</span>
        </div>
        {room.is_locked ? (
          <Lock className="w-3.5 h-3.5 text-red-400" />
        ) : (
          <Unlock className="w-3.5 h-3.5 text-green-400" />
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button onClick={copy}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-xs font-mono transition-colors">
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
          {room.code}
        </button>
        <div className="flex gap-1.5">
          <button onClick={(e) => { e.stopPropagation(); onInvite(); }}
            className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-medium transition-colors border border-blue-200 dark:border-blue-700">
            <UserPlus className="w-3 h-3" /> دعوت
          </button>
          <button onClick={onJoin}
            className="flex items-center gap-1 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors">
            ورود <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function VideoConferencePage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [rooms, setRooms] = useState<(ConferenceRoom & { participant_count?: number; meeting?: any })[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeRoom, setActiveRoom] = useState<ConferenceRoom | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [myPeerId, setMyPeerId] = useState('');

  // Media prefs (no stream started until user clicks join)
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  // Create form
  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);

  // Join by code
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);

  // Invite
  const [inviteRoom, setInviteRoom] = useState<ConferenceRoom | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);
      const { data: p } = await supabase.from('profiles').select('full_name, email').eq('user_id', user.id).maybeSingle();
      setUserName(p?.full_name || p?.email || 'کاربر');
      fetchRooms(user.id);
    })();
  }, []);

  const isRoomActive = (room: any): boolean => {
    if (room.status === 'ended') return false;
    const now = new Date();

    // If linked to a meeting, check if the meeting date+time has passed
    if (room.meeting) {
      const mtg = room.meeting;
      if (mtg.request_date && mtg.end_time) {
        // request_date is UTC ISO — convert to local date string
        const localDate = new Date(mtg.request_date);
        const y = localDate.getFullYear();
        const mo = String(localDate.getMonth() + 1).padStart(2, '0');
        const d = String(localDate.getDate()).padStart(2, '0');
        const endDt = new Date(`${y}-${mo}-${d}T${mtg.end_time}:00`);
        if (!isNaN(endDt.getTime()) && endDt < now) return false;
      }
      return true;
    }

    // Standalone room (no meeting): expire after 8 hours of creation
    if (room.created_at) {
      const createdAt = new Date(room.created_at);
      const ageHours = (now.getTime() - createdAt.getTime()) / 3600000;
      if (ageHours > 8) return false;
    }

    return true;
  };

  const fetchRooms = async (uid?: string) => {
    setLoading(true);
    const targetUserId = uid || userId;
    try {
      const { data: rd } = await supabase
        .from('conference_rooms')
        .select('*, meeting:meeting_id(request_date, start_time, end_time, subject)')
        .neq('status', 'ended')
        .order('created_at', { ascending: false });
      if (!rd) return;

      let invitedRoomIds: string[] = [];
      if (targetUserId) {
        const { data: myParts } = await supabase.from('conference_participants')
          .select('room_id').eq('user_id', targetUserId);
        invitedRoomIds = (myParts || []).map(p => p.room_id);
      }

      const relevant = targetUserId
        ? rd.filter(r => r.host_id === targetUserId || invitedRoomIds.includes(r.id))
        : rd;

      // Filter out rooms whose linked meeting has ended
      const active = relevant.filter(isRoomActive);

      const withCounts = await Promise.all(active.map(async r => {
        const { count } = await supabase.from('conference_participants')
          .select('id', { count: 'exact', head: true })
          .eq('room_id', r.id).eq('status', 'joined');
        return { ...r, participant_count: count ?? 0 };
      }));
      setRooms(withCounts);
    } finally { setLoading(false); }
  };

  const doJoin = async (room: ConferenceRoom) => {
    if (!userId) return;
    const peerId = `${userId}-${Date.now()}`;
    setMyPeerId(peerId);

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: !isVideoOff, audio: true });
    } catch {
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); setIsVideoOff(true); }
      catch { toast.error('خطا در دسترسی به دوربین/میکروفن'); return; }
    }
    stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    stream.getVideoTracks().forEach(t => { t.enabled = !isVideoOff; });

    const { error } = await supabase.from('conference_participants').upsert([{
      room_id: room.id, user_id: userId, display_name: userName,
      role: room.host_id === userId ? 'host' : 'participant',
      status: 'joined', joined_at: new Date().toISOString(),
      is_muted: isMuted, is_video_off: isVideoOff, peer_id: peerId,
    }], { onConflict: 'room_id,user_id' });
    if (error) { toast.error('خطا در ورود به اتاق: ' + error.message); return; }

    if (room.status === 'waiting') {
      await supabase.from('conference_rooms').update({ status: 'active' }).eq('id', room.id);
    }

    setLocalStream(stream);
    setActiveRoom({ ...room });
    setJoinCode('');
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setCreating(true);
    try {
      const { data: room, error } = await supabase.from('conference_rooms').insert([{
        name: createName.trim() || `جلسه ${moment().format('jYYYY/jMM/jDD HH:mm')}`,
        code: generateCode(), host_id: userId, status: 'active',
        password: null, waiting_room_enabled: false, is_locked: false,
      }]).select().single();
      if (error || !room) throw error;
      setCreateName(''); setShowCreate(false);
      await doJoin(room);
    } catch { toast.error('خطا در ایجاد اتاق'); }
    finally { setCreating(false); }
  };

  const handleJoinByCode = async () => {
    if (!joinCode.trim()) { toast.error('کد اتاق را وارد کنید'); return; }
    setJoining(true);
    try {
      const code = joinCode.toUpperCase().trim();
      const formatted = code.replace(/\s|-/g, '').replace(/(.{3})(.{3})(.{3})/, '$1-$2-$3');
      const { data: room } = await supabase.from('conference_rooms').select('*')
        .or(`code.eq.${formatted},code.eq.${code}`).neq('status', 'ended').maybeSingle();
      if (!room) { toast.error('اتاقی با این کد یافت نشد'); return; }
      await doJoin(room);
    } finally { setJoining(false); }
  };

  const handleLeave = () => {
    localStream?.getTracks().forEach(t => t.stop());
    setActiveRoom(null); setLocalStream(null); setMyPeerId('');
    if (userId) fetchRooms(userId); else fetchRooms();
  };

  // Active room view
  if (activeRoom && localStream) {
    return (
      <>
        <ConferenceRoomView room={activeRoom} currentUserId={userId!} currentUserName={userName}
          myPeerId={myPeerId} localStream={localStream} onLeave={handleLeave}
          onInvite={() => setInviteRoom(activeRoom)} />
        {inviteRoom && userId && <InviteModal room={inviteRoom} currentUserId={userId} onClose={() => setInviteRoom(null)} />}
      </>
    );
  }

  // Lobby
  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <Video className="w-6 h-6 text-teal-500" /> ویدیو کنفرانس
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">جلسات آنلاین رمزنگاری‌شده WebRTC</p>
        </div>
        <button onClick={() => fetchRooms(userId || undefined)}
          className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Actions panel */}
        <div className="lg:col-span-1 space-y-4">

          {/* Media toggles (no live stream — just preference) */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="font-bold text-gray-800 dark:text-white mb-3 text-sm flex items-center gap-2">
              <Video className="w-4 h-4 text-teal-500" /> تنظیمات ورود
            </h3>
            <div className="flex gap-3">
              <button onClick={() => setIsMuted(m => !m)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all border ${isMuted ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800' : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'}`}>
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {isMuted ? 'بی‌صدا' : 'میکروفن'}
              </button>
              <button onClick={() => setIsVideoOff(v => !v)}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all border ${isVideoOff ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800' : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'}`}>
                {isVideoOff ? <VideoOff className="w-4 h-4" /> : <Video className="w-4 h-4" />}
                {isVideoOff ? 'دوربین خاموش' : 'دوربین'}
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 text-center">تنظیمات پیش‌فرض هنگام ورود به اتاق</p>
          </div>

          {/* Create room */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <Plus className="w-4 h-4 text-teal-500" /> اتاق جدید
            </h3>
            {!showCreate ? (
              <button onClick={() => setShowCreate(true)}
                className="w-full py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-sm">
                <Video className="w-4 h-4" /> شروع جلسه
              </button>
            ) : (
              <form onSubmit={handleCreate} className="space-y-3">
                <input type="text" value={createName} onChange={e => setCreateName(e.target.value)}
                  placeholder="نام جلسه (اختیاری)"
                  className="w-full p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm" />
                <div className="flex gap-2">
                  <button type="submit" disabled={creating}
                    className="flex-1 py-2.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50">
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} ایجاد
                  </button>
                  <button type="button" onClick={() => setShowCreate(false)}
                    className="px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors">
                    <X className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Join by code */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="font-bold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <LogIn className="w-4 h-4 text-blue-500" /> ورود با کد
            </h3>
            <div className="flex gap-2">
              <input type="text" value={joinCode} onChange={e => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && handleJoinByCode()}
                placeholder="XXX-XXX-XXX" maxLength={11} dir="ltr"
                className="flex-1 p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm font-mono tracking-widest text-center" />
              <button onClick={handleJoinByCode} disabled={joining}
                className="px-4 bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-colors disabled:opacity-50">
                {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Features */}
          <div className="bg-gradient-to-br from-teal-50 to-blue-50 dark:from-teal-900/20 dark:to-blue-900/20 rounded-2xl border border-teal-100 dark:border-teal-800/50 p-4">
            <p className="text-xs font-semibold text-teal-700 dark:text-teal-300 mb-3">امکانات</p>
            <div className="grid grid-cols-2 gap-1.5 text-xs text-gray-600 dark:text-gray-400">
              {['ویدیو چندنفره','رمزنگاری E2E','اشتراک صفحه','چت داخلی','نظرسنجی زنده','وایت‌بورد','واکنش Emoji','لینک مهمان'].map(label => (
                <div key={label} className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-500 flex-shrink-0" />
                  <span>{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Rooms panel */}
        <div className="lg:col-span-2">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
                <Globe className="w-4 h-4 text-teal-500" /> اتاق‌های فعال
                {!loading && (
                  <span className="text-xs font-normal text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                    {rooms.length} اتاق
                  </span>
                )}
              </h3>
              <p className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> اتاق‌هایی که جلسه‌شان هنوز تمام نشده
              </p>
            </div>

            {loading ? (
              <div className="flex justify-center py-16">
                <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
              </div>
            ) : rooms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-gray-400 gap-3">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                  <Video className="w-8 h-8 opacity-40" />
                </div>
                <p className="text-base font-medium">هیچ اتاق فعالی وجود ندارد</p>
                <p className="text-sm opacity-70">یک جلسه جدید شروع کنید یا با کد وارد شوید</p>
                <button onClick={() => setShowCreate(true)}
                  className="mt-2 flex items-center gap-2 px-4 py-2.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors">
                  <Plus className="w-4 h-4" /> شروع جلسه جدید
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rooms.map(room => (
                  <RoomCard key={room.id} room={room} currentUserId={userId || ''}
                    onJoin={() => doJoin(room)} onInvite={() => setInviteRoom(room)} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {inviteRoom && userId && (
        <InviteModal room={inviteRoom} currentUserId={userId} onClose={() => setInviteRoom(null)} />
      )}
    </div>
  );
}
