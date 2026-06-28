import React, { useState, useEffect, useRef, useCallback } from 'react';
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

async function generateUniqueCode(): Promise<string> {
  for (let i = 0; i < 5; i++) {
    const code = generateCode();
    const { data } = await supabase.from('conference_rooms').select('id').eq('code', code).maybeSingle();
    if (!data) return code;
  }
  throw new Error('کد یکتا پیدا نشد، لطفاً دوباره تلاش کنید');
}

// ── Invite modal ──────────────────────────────────────────────────────────────
interface UserProfile { user_id: string; full_name: string | null; email: string | null; }

function InviteModal({ room, currentUserId, onClose }: {
  room: ConferenceRoom; currentUserId: string; onClose: () => void;
}) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [linkCopied, setLinkCopied] = useState(false);
  // debounce timer ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const joinLink = `${window.location.origin}?conference=${room.code}`;

  // Server-side search with debounce + limit (no full table fetch)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setLoadingUsers(true);
      try {
        let query = supabase.from('profiles')
          .select('user_id, full_name, email')
          .neq('user_id', currentUserId)
          .not('is_hidden', 'eq', true)
          .limit(30);
        if (search.trim()) {
          query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
        }
        const { data, error } = await query;
        if (error) throw error;
        setUsers(data || []);
      } catch (e) {
        console.error('fetchUsers error:', e);
        toast.error('خطا در بارگذاری کاربران');
      } finally {
        setLoadingUsers(false);
      }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, currentUserId]);

  const copyLink = () => {
    // fix: clipboard fallback
    navigator.clipboard.writeText(joinLink).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      toast.success('لینک کپی شد');
    }).catch(() => {
      // fallback for browsers that block clipboard
      const ta = document.createElement('textarea');
      ta.value = joinLink; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      toast.success('لینک کپی شد');
    });
  };

  const inviteUser = async (u: UserProfile) => {
    if (sent.has(u.user_id)) return; // dedup
    setSending(u.user_id);
    try {
      const { error } = await supabase.from('notifications').insert([{
        user_id: u.user_id,
        title: `دعوت به ویدیو کنفرانس: ${room.name || 'جلسه ویدیویی'}`,
        message: `برای ورود به جلسه کد «${room.code}» را در بخش ویدیو کنفرانس وارد کنید`,
        type: 'meeting', read: false,
      }]);
      if (error) throw error;
      setSent(prev => new Set([...prev, u.user_id]));
      toast.success(`دعوتنامه به ${u.full_name || u.email} ارسال شد`);
    } catch (e: any) {
      toast.error('خطا در ارسال دعوتنامه: ' + (e.message || ''));
    } finally {
      setSending(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="دعوت از شرکت‌کنندگان"
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      dir="rtl"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="font-bold dark:text-white flex items-center gap-2">
            <UserPlus className="w-5 h-5 text-teal-500" /> دعوت از شرکت‌کنندگان
          </h2>
          <button onClick={onClose} aria-label="بستن" className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
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
              <button
                onClick={copyLink}
                aria-label="کپی لینک"
                className="flex items-center gap-1.5 px-3 py-2.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors flex-shrink-0"
              >
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
              <label htmlFor="invite-search" className="sr-only">جستجو کاربر</label>
              <input
                id="invite-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="جستجو نام یا ایمیل..."
                className="w-full pr-9 pl-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white text-sm"
              />
            </div>
            <div className="max-h-52 overflow-y-auto space-y-2">
              {loadingUsers ? (
                <div className="flex justify-center py-4"><Loader2 className="w-5 h-5 animate-spin text-teal-500" /></div>
              ) : users.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-4">کاربری یافت نشد</p>
              ) : (
                users.map(u => (
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
                      <button
                        onClick={() => inviteUser(u)}
                        disabled={sending === u.user_id}
                        aria-label={`دعوت ${u.full_name || u.email}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        {sending === u.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} دعوت
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Room card ─────────────────────────────────────────────────────────────────
function RoomCard({ room, currentUserId, onJoin, onInvite, joining }: {
  room: ConferenceRoom & { participant_count?: number; meeting?: any };
  currentUserId: string;
  onJoin: () => void;
  onInvite: () => void;
  joining: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = room.host_id === currentUserId;

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(room.code).catch(() => {});
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
        <button
          onClick={copy}
          aria-label={`کپی کد اتاق ${room.code}`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-xs font-mono transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
          {room.code}
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onInvite(); }}
            aria-label="دعوت از شرکت‌کنندگان"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-medium transition-colors border border-blue-200 dark:border-blue-700"
          >
            <UserPlus className="w-3 h-3" /> دعوت
          </button>
          <button
            onClick={onJoin}
            disabled={joining}
            aria-label="ورود به اتاق"
            aria-pressed={joining}
            className="flex items-center gap-1 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            {joining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
            ورود
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
  const [notLoggedIn, setNotLoggedIn] = useState(false);
  const [activeRoom, setActiveRoom] = useState<ConferenceRoom | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [myPeerId, setMyPeerId] = useState('');

  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);

  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  // per-room joining state for room cards
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  const [inviteRoom, setInviteRoom] = useState<ConferenceRoom | null>(null);

  // fix: stop previous stream before acquiring new one
  const localStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  // fix: guard against concurrent doJoin calls (stream race condition)
  const joiningRef = useRef(false);

  // fix: ghost participant cleanup on page unload
  const activeRoomRef = useRef<ConferenceRoom | null>(null);
  const userIdRef = useRef<string | null>(null);
  const myPeerIdRef = useRef<string>('');
  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { myPeerIdRef.current = myPeerId; }, [myPeerId]);

  useEffect(() => {
    const markLeft = () => {
      const r = activeRoomRef.current;
      const uid = userIdRef.current;
      const pid = myPeerIdRef.current;
      if (r && uid) {
        // Use sendBeacon so it fires even during page unload
        const url = `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/conference_participants?room_id=eq.${r.id}&user_id=eq.${uid}`;
        const payload = JSON.stringify({ status: 'left', peer_id: pid });
        navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
      }
    };
    window.addEventListener('pagehide', markLeft);
    window.addEventListener('beforeunload', markLeft);
    return () => {
      window.removeEventListener('pagehide', markLeft);
      window.removeEventListener('beforeunload', markLeft);
    };
  }, []);

  const isRoomActive = (room: any): boolean => {
    if (room.status === 'ended') return false;
    const now = new Date();
    if (room.meeting) {
      const mtg = room.meeting;
      if (mtg.request_date && mtg.end_time) {
        const localDate = new Date(mtg.request_date);
        const y = localDate.getFullYear();
        const mo = String(localDate.getMonth() + 1).padStart(2, '0');
        const d = String(localDate.getDate()).padStart(2, '0');
        // parse explicitly to avoid timezone ambiguity
        const endDt = new Date(`${y}-${mo}-${d}T${mtg.end_time}:00`);
        if (!isNaN(endDt.getTime()) && endDt < now) return false;
      }
      return true;
    }
    if (room.created_at) {
      const ageHours = (now.getTime() - new Date(room.created_at).getTime()) / 3600000;
      if (ageHours > 8) return false;
    }
    return true;
  };

  // fix: N+1 removed — single bulk count query instead of one per room
  // IMPORTANT: declared before any useEffect that includes it in a dep array to avoid TDZ
  const fetchRooms = useCallback(async (uid?: string) => {
    setLoading(true);
    const targetUserId = uid || userId;
    try {
      const { data: rd, error: rdErr } = await supabase
        .from('conference_rooms')
        .select('*, meeting:meeting_id(request_date, start_time, end_time, subject)')
        .neq('status', 'ended')
        .order('created_at', { ascending: false });
      if (rdErr) throw rdErr;
      if (!rd?.length) { setRooms([]); return; }

      let invitedRoomIds: string[] = [];
      if (targetUserId) {
        const { data: myParts, error: pErr } = await supabase
          .from('conference_participants')
          .select('room_id')
          .eq('user_id', targetUserId);
        if (pErr) throw pErr;
        invitedRoomIds = (myParts || []).map(p => p.room_id);
      }

      const relevant = targetUserId
        ? rd.filter(r => r.host_id === targetUserId || invitedRoomIds.includes(r.id))
        : rd;
      const active = relevant.filter(isRoomActive);
      if (!active.length) { setRooms([]); return; }

      // Bulk count: one query for all rooms
      const activeIds = active.map(r => r.id);
      const { data: countRows, error: cErr } = await supabase
        .from('conference_participants')
        .select('room_id')
        .in('room_id', activeIds)
        .eq('status', 'joined');
      if (cErr) throw cErr;

      const countMap: Record<string, number> = {};
      (countRows || []).forEach(row => {
        countMap[row.room_id] = (countMap[row.room_id] || 0) + 1;
      });

      setRooms(active.map(r => ({ ...r, participant_count: countMap[r.id] ?? 0 })));
    } catch (e: any) {
      console.error('fetchRooms error:', e);
      toast.error('خطا در بارگذاری اتاق‌ها: ' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // fix: auth guard — set notLoggedIn instead of infinite spinner
  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setNotLoggedIn(true); setLoading(false); return; }
        setUserId(user.id);
        const { data: p } = await supabase.from('profiles').select('full_name, email').eq('user_id', user.id).maybeSingle();
        setUserName(p?.full_name || p?.email || 'کاربر');
        await fetchRooms(user.id);
      } catch (e) {
        console.error('init error:', e);
        toast.error('خطا در بارگذاری اطلاعات');
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: auto-refresh rooms list when any room changes (no manual refresh needed)
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel('conf-rooms-lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_rooms' }, () => {
        if (!activeRoomRef.current) fetchRooms(userIdRef.current || undefined);
      })
      .subscribe();
    return () => { ch.unsubscribe(); };
  }, [userId, fetchRooms]);

  // fix: doJoin with full validation + stream race condition guard
  const doJoin = async (room: ConferenceRoom) => {
    if (!userId || joiningRef.current) return;
    joiningRef.current = true;

    // Client-side pre-check (UX only — server enforces via RLS)
    if (room.is_locked) { toast.error('این اتاق قفل شده است'); joiningRef.current = false; return; }
    if ((room.participant_count ?? 0) >= room.max_participants) {
      toast.error('ظرفیت اتاق پر شده است'); joiningRef.current = false; return;
    }

    setJoiningRoomId(room.id);
    const peerId = `${userId}-${Date.now()}`;
    setMyPeerId(peerId);

    // fix: stop any previous stream before acquiring new one
    localStreamRef.current?.getTracks().forEach(t => t.stop());

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: !isVideoOff, audio: true });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        setIsVideoOff(true);
      } catch {
        toast.error('دسترسی به دوربین و میکروفن امکان‌پذیر نیست. لطفاً مجوزها را بررسی کنید.');
        setJoiningRoomId(null);
        joiningRef.current = false;
        return;
      }
    }
    stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    stream.getVideoTracks().forEach(t => { t.enabled = !isVideoOff; });

    try {
      const { error } = await supabase.from('conference_participants').upsert([{
        room_id: room.id, user_id: userId, display_name: userName,
        role: room.host_id === userId ? 'host' : 'member',
        status: 'joined', joined_at: new Date().toISOString(),
        is_muted: isMuted, is_video_off: isVideoOff, peer_id: peerId,
      }], { onConflict: 'room_id,user_id' });
      if (error) throw error;

      if (room.status === 'waiting') {
        await supabase.from('conference_rooms').update({ status: 'active' }).eq('id', room.id);
      }

      setLocalStream(stream);
      setActiveRoom({ ...room });
      setJoinCode('');
    } catch (e: any) {
      stream.getTracks().forEach(t => t.stop());
      toast.error('خطا در ورود به اتاق: ' + (e.message || ''));
    } finally {
      setJoiningRoomId(null);
      joiningRef.current = false;
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    setCreating(true);
    try {
      const code = await generateUniqueCode();
      const { data: room, error } = await supabase.from('conference_rooms').insert([{
        name: createName.trim() || `جلسه ${moment().format('jYYYY/jMM/jDD HH:mm')}`,
        code, host_id: userId, status: 'active',
        password: null, waiting_room_enabled: false, is_locked: false,
      }]).select().single();
      if (error || !room) throw error;
      setCreateName(''); setShowCreate(false);
      await doJoin(room);
    } catch (e: any) {
      toast.error('خطا در ایجاد اتاق: ' + (e.message || ''));
    } finally {
      setCreating(false);
    }
  };

  const handleJoinByCode = async () => {
    const raw = joinCode.trim();
    if (!raw) { toast.error('کد اتاق را وارد کنید'); return; }
    // Validate length before formatting (raw should be 9 alphanum chars)
    const stripped = raw.replace(/[-\s]/g, '');
    if (stripped.length !== 9) { toast.error('کد اتاق باید ۹ کاراکتر باشد (مثلاً XXX-XXX-XXX)'); return; }

    setJoining(true);
    try {
      const formatted = stripped.replace(/(.{3})(.{3})(.{3})/, '$1-$2-$3').toUpperCase();
      const { data: room, error } = await supabase.from('conference_rooms').select('*')
        .or(`code.eq.${formatted},code.eq.${stripped.toUpperCase()}`)
        .neq('status', 'ended')
        .maybeSingle();
      if (error) throw error;
      if (!room) { toast.error('اتاقی با این کد یافت نشد'); return; }
      await doJoin(room);
    } catch (e: any) {
      toast.error('خطا در ورود با کد: ' + (e.message || ''));
    } finally {
      setJoining(false);
    }
  };

  // fix: stream cleanup moved to finally so it always runs even if DB update fails
  const handleLeave = async () => {
    try {
      if (activeRoom && userId) {
        await supabase.from('conference_participants')
          .update({ status: 'left' })
          .eq('room_id', activeRoom.id)
          .eq('user_id', userId);
      }
    } catch (e) {
      console.error('handleLeave update error:', e);
    } finally {
      localStream?.getTracks().forEach(t => t.stop());
      setActiveRoom(null); setLocalStream(null); setMyPeerId('');
      fetchRooms(userId || undefined);
    }
  };

  // ── Auth guard ─────────────────────────────────────────────────────────────
  if (notLoggedIn) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center" dir="rtl">
        <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
          <Video className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-lg font-medium dark:text-white">برای استفاده از ویدیو کنفرانس وارد شوید</p>
        <p className="text-sm text-gray-500">لطفاً ابتدا در سامانه احراز هویت کنید</p>
      </div>
    );
  }

  // ── Active room ────────────────────────────────────────────────────────────
  if (activeRoom && localStream) {
    return (
      <>
        <ConferenceRoomView
          room={activeRoom}
          currentUserId={userId!}
          currentUserName={userName}
          myPeerId={myPeerId}
          localStream={localStream}
          onLeave={handleLeave}
          onInvite={() => setInviteRoom(activeRoom)}
        />
        {inviteRoom && userId && (
          <InviteModal room={inviteRoom} currentUserId={userId} onClose={() => setInviteRoom(null)} />
        )}
      </>
    );
  }

  // ── Lobby ──────────────────────────────────────────────────────────────────
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
        <button
          onClick={() => fetchRooms(userId || undefined)}
          aria-label="بارگذاری مجدد"
          className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Actions panel */}
        <div className="lg:col-span-1 space-y-4">

          {/* Media toggles */}
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <h3 className="font-bold text-gray-800 dark:text-white mb-3 text-sm flex items-center gap-2">
              <Video className="w-4 h-4 text-teal-500" /> تنظیمات ورود
            </h3>
            <div className="flex gap-3">
              <button
                onClick={() => setIsMuted(m => !m)}
                aria-pressed={isMuted}
                aria-label={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all border ${isMuted ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800' : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                {isMuted ? 'بی‌صدا' : 'میکروفن'}
              </button>
              <button
                onClick={() => setIsVideoOff(v => !v)}
                aria-pressed={isVideoOff}
                aria-label={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all border ${isVideoOff ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800' : 'bg-gray-50 dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-600'}`}
              >
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
              <button
                onClick={() => setShowCreate(true)}
                className="w-full py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 shadow-sm"
              >
                <Video className="w-4 h-4" /> شروع جلسه
              </button>
            ) : (
              <form onSubmit={handleCreate} className="space-y-3">
                <label htmlFor="create-name" className="sr-only">نام جلسه</label>
                <input
                  id="create-name"
                  type="text"
                  value={createName}
                  onChange={e => setCreateName(e.target.value)}
                  placeholder="نام جلسه (اختیاری)"
                  className="w-full p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm"
                />
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex-1 py-2.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-medium transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Video className="w-4 h-4" />} ایجاد
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    aria-label="انصراف"
                    className="px-4 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl transition-colors"
                  >
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
              <label htmlFor="join-code" className="sr-only">کد اتاق</label>
              <input
                id="join-code"
                type="text"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleJoinByCode(); } }}
                placeholder="XXX-XXX-XXX"
                maxLength={11}
                dir="ltr"
                className="flex-1 p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white text-sm font-mono tracking-widest text-center"
              />
              <button
                onClick={handleJoinByCode}
                disabled={joining}
                aria-label="ورود با کد"
                className="px-4 bg-blue-500 hover:bg-blue-600 text-white rounded-xl transition-colors disabled:opacity-50"
              >
                {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Features */}
          <div className="bg-gradient-to-br from-teal-50 to-blue-50 dark:from-teal-900/20 dark:to-blue-900/20 rounded-2xl border border-teal-100 dark:border-teal-800/50 p-4">
            <p className="text-xs font-semibold text-teal-700 dark:text-teal-300 mb-3">امکانات</p>
            <div className="grid grid-cols-2 gap-1.5 text-xs text-gray-600 dark:text-gray-400">
              {['ویدیو چندنفره', 'رمزنگاری E2E', 'اشتراک صفحه', 'چت داخلی', 'نظرسنجی زنده', 'وایت‌بورد', 'واکنش Emoji', 'لینک مهمان'].map(label => (
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
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-2 flex items-center gap-2 px-4 py-2.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors"
                >
                  <Plus className="w-4 h-4" /> شروع جلسه جدید
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {rooms.map(room => (
                  <RoomCard
                    key={room.id}
                    room={room}
                    currentUserId={userId || ''}
                    onJoin={() => doJoin(room)}
                    onInvite={() => setInviteRoom(room)}
                    joining={joiningRoomId === room.id}
                  />
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
