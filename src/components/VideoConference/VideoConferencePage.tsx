import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, Plus, LogIn, Copy, Check, Loader as Loader2, Mic, MicOff, VideoOff, Users, Clock, Crown, Link2, UserPlus, Send, Search, X, ChevronRight, RefreshCw, Globe, Calendar, Lock, Clock as Unlock, Shield, ShieldOff, ShieldCheck } from 'lucide-react';
import { E2EECallPage } from './E2EECallPage';
import { supabase } from '../../lib/supabase';
import { ConferenceClientContext } from './conferenceClient';
import { ConferenceRoomView } from './ConferenceRoom';
import { DeviceSelector } from './DeviceSelector';
import { ApprovalWaitingGate } from './ApprovalGate';
import { getPendingE2EERing } from '../../lib/globalE2EERing';
import type { ConferenceRoom } from './types';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';

import { InviteModal } from './Page/InviteModal';
import { RoomCard } from './Page/RoomCard';
import { BanDetailModal } from './Page/BanDetailModal';

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

  const [banDetail, setBanDetail] = useState<{ reason: string | null; expiresAt: string | null } | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);
  const [requireApproval, setRequireApproval] = useState(false);

  const [waitingApproval, setWaitingApproval] = useState<{ room: ConferenceRoom; stream: MediaStream; isMuted: boolean; isVideoOff: boolean } | null>(null);

  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);

  const [inviteRoom, setInviteRoom] = useState<ConferenceRoom | null>(null);
  const [showE2EE, setShowE2EE] = useState(() => getPendingE2EERing() !== null);

  const [preJoinRoom, setPreJoinRoom] = useState<ConferenceRoom | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  const joiningRef = useRef(false);

  const activeRoomRef = useRef<ConferenceRoom | null>(null);
  const userIdRef = useRef<string | null>(null);
  const myPeerIdRef = useRef<string>('');
  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);
  useEffect(() => { myPeerIdRef.current = myPeerId; }, [myPeerId]);

  useEffect(() => {
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    const sendHeartbeat = async () => {
      const r = activeRoomRef.current;
      const uid = userIdRef.current;
      if (!r || !uid) return;
      await supabase
        .from('conference_participants')
        .update({ last_seen: new Date().toISOString() })
        .eq('room_id', r.id)
        .eq('user_id', uid)
        .eq('status', 'joined');
    };

    const markLeft = async () => {
      const r = activeRoomRef.current;
      const uid = userIdRef.current;
      if (!r || !uid) return;
      try {
        await supabase
          .from('conference_participants')
          .update({ status: 'left' })
          .eq('room_id', r.id)
          .eq('user_id', uid);
      } catch { /* page unloading — best effort */ }
    };

    const startHeartbeat = () => {
      if (heartbeatInterval) return;
      heartbeatInterval = setInterval(sendHeartbeat, 20_000);
    };
    const stopHeartbeat = () => {
      if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    };

    if (activeRoom) startHeartbeat();
    else stopHeartbeat();

    const handleUnload = () => { markLeft(); stopHeartbeat(); };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      stopHeartbeat();
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [activeRoom]);

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

  const fetchRooms = useCallback(async (uid?: string) => {
    setLoading(true);
    const targetUserId = uid || userId;
    try {
      const { data: rd, error: rdErr } = await supabase
        .from('conference_rooms')
        .select('id, name, code, host_id, status, max_participants, is_locked, waiting_room_enabled, allow_reactions, allow_screen_share, allow_chat, record_enabled, require_approval, created_at, ended_at, meeting_id, meeting:meeting_id(request_date, start_time, end_time, subject)')
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

      setRooms((active || []).map(r => ({ ...r, participant_count: countMap[r.id] ?? 0 })));
    } catch (e: any) {
      console.error('fetchRooms error:', e);
      toast.error('خطا در بارگذاری اتاق‌ها: ' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

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

  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel('conf-rooms-lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_rooms' }, () => {
        if (!activeRoomRef.current) fetchRooms(userIdRef.current || undefined);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, fetchRooms]);

  const doJoin = async (room: ConferenceRoom, stream: MediaStream) => {
    if (!userId || joiningRef.current) return;
    joiningRef.current = true;

    if (room.is_locked) { toast.error('این اتاق قفل شده است'); joiningRef.current = false; return; }
    if ((room.participant_count ?? 0) >= room.max_participants) {
      toast.error('ظرفیت اتاق پر شده است'); joiningRef.current = false; return;
    }

    const { data: validation } = await supabase.rpc('validate_room_join', {
      p_room_id: room.id,
      p_password: null,
      p_user_id: userId,
    });
    if (validation && !validation.allowed && validation.reason === 'banned') {
      setBanDetail({ reason: validation.ban_reason ?? null, expiresAt: validation.ban_expires_at ?? null });
      stream.getTracks().forEach(t => t.stop());
      joiningRef.current = false;
      setPreJoinRoom(null);
      return;
    }

    if (room.require_approval && room.host_id !== userId) {
      setWaitingApproval({ room, stream, isMuted, isVideoOff });
      setPreJoinRoom(null);
      joiningRef.current = false;
      return;
    }

    setJoiningRoomId(room.id);
    const peerId = `${userId}-${Date.now()}`;
    setMyPeerId(peerId);

    localStreamRef.current?.getTracks().forEach(t => t.stop());

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
      setPreJoinRoom(null);
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
        require_approval: requireApproval,
      }]).select().single();
      if (error || !room) throw error;
      setCreateName(''); setRequireApproval(false); setShowCreate(false);
      setPreJoinRoom(room);
    } catch (e: any) {
      toast.error('خطا در ایجاد اتاق: ' + (e.message || ''));
    } finally {
      setCreating(false);
    }
  };

  const handleJoinByCode = async () => {
    const raw = joinCode.trim();
    if (!raw) { toast.error('کد اتاق را وارد کنید'); return; }
    const stripped = raw.replace(/[-\s]/g, '');
    if (stripped.length !== 9) { toast.error('کد اتاق باید ۹ کاراکتر باشد (مثلاً XXX-XXX-XXX)'); return; }

    setJoining(true);
    try {
      const formatted = stripped.replace(/(.{3})(.{3})(.{3})/, '$1-$2-$3').toUpperCase();
      const { data: room, error } = await supabase.from('conference_rooms')
        .select('id, name, code, host_id, status, max_participants, is_locked, waiting_room_enabled, allow_reactions, allow_screen_share, allow_chat, record_enabled, require_approval, created_at, ended_at, meeting_id')
        .or(`code.eq.${formatted},code.eq.${stripped.toUpperCase()}`)
        .neq('status', 'ended')
        .maybeSingle();
      if (error) throw error;
      if (!room) { toast.error('اتاقی با این کد یافت نشد'); return; }
      setPreJoinRoom(room);
    } catch (e: any) {
      toast.error('خطا در ورود با کد: ' + (e.message || ''));
    } finally {
      setJoining(false);
    }
  };

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

  if (waitingApproval && userId) {
    return (
      <ApprovalWaitingGate
        roomId={waitingApproval.room.id}
        userId={userId}
        displayName={userName}
        onApproved={async () => {
          const { room, stream, isMuted: mut, isVideoOff: voff } = waitingApproval;
          setWaitingApproval(null);

          const [banRes, countRes] = await Promise.all([
            supabase.rpc('validate_room_join', { p_room_id: room.id, p_password: null, p_user_id: userId! }),
            supabase.from('conference_participants').select('*', { count: 'exact', head: true }).eq('room_id', room.id).eq('status', 'joined'),
          ]);
          if (banRes.data && !banRes.data.allowed && banRes.data.reason === 'banned') {
            stream.getTracks().forEach(t => t.stop());
            setBanDetail({ reason: banRes.data.ban_reason ?? null, expiresAt: banRes.data.ban_expires_at ?? null });
            return;
          }
          if ((countRes.count ?? 0) >= room.max_participants) {
            stream.getTracks().forEach(t => t.stop());
            toast.error('ظرفیت اتاق پر شده است');
            return;
          }

          const peerId = `${userId}-${Date.now()}`;
          setMyPeerId(peerId);
          localStreamRef.current?.getTracks().forEach(t => t.stop());
          stream.getAudioTracks().forEach(t => { t.enabled = !mut; });
          stream.getVideoTracks().forEach(t => { t.enabled = !voff; });
          try {
            const { error } = await supabase.from('conference_participants').upsert([{
              room_id: room.id, user_id: userId, display_name: userName,
              role: 'member', status: 'joined', joined_at: new Date().toISOString(),
              is_muted: mut, is_video_off: voff, peer_id: peerId,
            }], { onConflict: 'room_id,user_id' });
            if (error) throw error;
            setLocalStream(stream);
            setActiveRoom({ ...room });
          } catch (e: any) {
            stream.getTracks().forEach(t => t.stop());
            toast.error('خطا در ورود: ' + (e.message || ''));
          }
        }}
        onRejected={() => { waitingApproval.stream.getTracks().forEach(t => t.stop()); setWaitingApproval(null); }}
        onCancel={() => { waitingApproval.stream.getTracks().forEach(t => t.stop()); setWaitingApproval(null); }}
      />
    );
  }

  if (activeRoom && localStream) {
    return (
      <>
        <ConferenceClientContext.Provider value={supabase}>
        <ConferenceRoomView
          room={activeRoom}
          currentUserId={userId!}
          currentUserName={userName}
          myPeerId={myPeerId}
          localStream={localStream}
          onLeave={handleLeave}
          onInvite={() => setInviteRoom(activeRoom)}
        />
        </ConferenceClientContext.Provider>
        {inviteRoom && userId && (
          <InviteModal room={inviteRoom} currentUserId={userId} onClose={() => setInviteRoom(null)} />
        )}
        {banDetail && (
          <BanDetailModal banDetail={banDetail} onClose={() => setBanDetail(null)} />
        )}
      </>
    );
  }

  if (showE2EE && userId) {
    return (
      <div className="h-[calc(100vh-120px)] min-h-[480px]">
        <E2EECallPage
          currentUserId={userId}
          currentUserName={userName}
          onBack={() => setShowE2EE(false)}
        />
      </div>
    );
  }

  return (
    <div className="space-y-6 relative" dir="rtl">
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl overflow-hidden opacity-[0.06] dark:opacity-[0.04]"
        aria-hidden="true"
      >
        <img
          src="/pexels-photo-4226140.jpg"
          alt=""
          className="w-full h-full object-cover"
        />
      </div>
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold dark:text-white flex items-center gap-2">
            <Video className="w-6 h-6 text-teal-500" /> ویدیو کنفرانس
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">جلسات آنلاین رمزنگاری‌شده WebRTC</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowE2EE(true)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800 text-sm font-medium transition-colors"
          >
            <ShieldCheck className="w-4 h-4" /> تماس E2EE
          </button>
          <button
            onClick={() => fetchRooms(userId || undefined)}
            aria-label="بارگذاری مجدد"
            className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
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
                <label className="flex items-center gap-2 cursor-pointer group select-none">
                  <div
                    onClick={() => setRequireApproval(v => !v)}
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 transition-colors ${requireApproval ? 'bg-teal-600 border-teal-600' : 'border-gray-400 dark:border-gray-500 group-hover:border-teal-500'}`}
                  >
                    {requireApproval && <Check className="w-2.5 h-2.5 text-white" />}
                  </div>
                  <span className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5 text-teal-500" />
                    تأیید میزبان برای ورود
                  </span>
                </label>
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
          <div className="bg-gradient-to-br from-teal-50 to-blue-50 dark:from-teal-900/20 dark:to-blue-900/20 rounded-2xl border border-teal-100 dark:border-teal-800/50 p-3 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-teal-700 dark:text-teal-300">امکانات</p>
              <button
                onClick={() => setShowE2EE(true)}
                className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 transition-colors text-white text-[10px] font-medium"
              >
                <ShieldCheck className="w-3 h-3 shrink-0" />
                تماس E2EE
                <span className="text-emerald-200 border border-emerald-400/50 rounded-full px-1 text-[9px]">جدید</span>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-x-2 gap-y-1 text-[11px] text-gray-600 dark:text-gray-400">
              {[
                'ویدیو چندنفره',
                'اشتراک صفحه',
                'چت داخلی',
                'نظرسنجی زنده',
                'وایت‌بورد',
                'واکنش Emoji',
                'لینک مهمان',
                'اتاق انتظار',
                'مدیریت نقش',
                'محدودیت صحبت',
                'حالت‌های نمایش',
                'کیفیت تطبیقی',
              ].map(label => (
                <div key={label} className="flex items-center gap-1 min-w-0">
                  <span className="w-1 h-1 rounded-full bg-teal-500 shrink-0" />
                  <span className="truncate">{label}</span>
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
                    onJoin={() => setPreJoinRoom(room)}
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

      {banDetail && (
        <BanDetailModal banDetail={banDetail} onClose={() => setBanDetail(null)} />
      )}

      {/* Pre-join device selection modal */}
      {preJoinRoom && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="تنظیم دستگاه قبل از ورود"
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
          dir="rtl"
        >
          <div className="bg-gray-950 rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800 sticky top-0 bg-gray-950 z-10">
              <div>
                <h2 className="font-bold text-white text-sm flex items-center gap-2">
                  <Video className="w-4 h-4 text-teal-500" />
                  تنظیمات قبل از ورود
                </h2>
                <p className="text-xs text-gray-500 mt-0.5">{preJoinRoom.name || 'جلسه ویدیویی'}</p>
              </div>
              <button
                onClick={() => setPreJoinRoom(null)}
                aria-label="بستن"
                className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5">
              <DeviceSelector
                onConfirm={(stream) => doJoin(preJoinRoom, stream)}
                submitLabel="ورود به جلسه"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
