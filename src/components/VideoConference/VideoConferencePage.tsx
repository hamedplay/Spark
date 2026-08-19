import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, Plus, LogIn, Check, Loader as Loader2, Mic, MicOff, VideoOff, Users, RefreshCw, Globe, Calendar, Shield, X, Radio } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getAuthenticatedRTCConfig } from '../../lib/authenticatedRtcConfig';
import { ConferenceClientContext } from './conferenceClient';
import { ConferenceRoomView } from './ConferenceRoom';
import { DeviceSelector } from './DeviceSelector';
import { ApprovalWaitingGate } from './ApprovalGate';
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
            loadRTCConfig={getAuthenticatedRTCConfig}
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

  const onlineParticipants = rooms.reduce((total, room) => total + (room.participant_count ?? 0), 0);

  return (
    <div className="h-full min-h-0 space-y-5 overflow-y-auto pb-5" dir="rtl">
      {/* Page header */}
      <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_35px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400">
              <Video className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-slate-900 dark:text-white sm:text-2xl">ویدیو کنفرانس</h2>
              <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400 sm:text-sm">
                ایجاد، ورود و مدیریت جلسات آنلاین چندنفره سازمانی
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-stretch sm:self-auto">
            <button
              onClick={() => setShowCreate(true)}
              className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-teal-700 sm:flex-none"
            >
              <Plus className="h-4 w-4" /> جلسه جدید
            </button>
            <button
              onClick={() => fetchRooms(userId || undefined)}
              aria-label="بارگذاری مجدد اتاق‌ها"
              title="بارگذاری مجدد"
              className="rounded-xl border border-slate-200 bg-white p-2.5 text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <Radio className="h-3.5 w-3.5 text-teal-500" /> اتاق فعال
            </div>
            <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{loading ? '—' : rooms.length}</p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/70">
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <Users className="h-3.5 w-3.5 text-blue-500" /> حاضر در جلسات
            </div>
            <p className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">{loading ? '—' : onlineParticipants}</p>
          </div>
          <div className="col-span-2 rounded-xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/70 sm:col-span-1">
            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400">
              <Shield className="h-3.5 w-3.5 text-violet-500" /> بستر ارتباط
            </div>
            <p className="mt-1 text-sm font-bold text-slate-800 dark:text-slate-200">WebRTC سازمانی</p>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        {/* Actions panel */}
        <aside className="space-y-4">
          {/* Join by code */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400">
                <LogIn className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">ورود با کد اتاق</h3>
                <p className="text-[10px] text-slate-400">کد ۹ کاراکتری دعوت را وارد کنید</p>
              </div>
            </div>
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
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-center font-mono text-sm tracking-widest text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-950"
              />
              <button
                onClick={handleJoinByCode}
                disabled={joining}
                aria-label="ورود با کد"
                className="rounded-xl bg-blue-600 px-4 text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              </button>
            </div>
          </section>

          {/* Create room */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="mb-3 flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-600 dark:bg-teal-500/10 dark:text-teal-400">
                <Plus className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">جلسه جدید</h3>
                <p className="text-[10px] text-slate-400">یک اتاق جدید با کد یکتا بسازید</p>
              </div>
            </div>

            {!showCreate ? (
              <button
                onClick={() => setShowCreate(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-teal-700"
              >
                <Video className="h-4 w-4" /> شروع جلسه
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
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-sm text-slate-900 outline-none focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-teal-950"
                />
                <label className="flex cursor-pointer select-none items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-900/60">
                  <input
                    type="checkbox"
                    checked={requireApproval}
                    onChange={e => setRequireApproval(e.target.checked)}
                    className="h-4 w-4 accent-teal-600"
                  />
                  <span className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <Shield className="h-3.5 w-3.5 text-teal-500" /> تأیید میزبان برای ورود
                  </span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={creating}
                    className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-teal-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-teal-700 disabled:opacity-50"
                  >
                    {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} ایجاد اتاق
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCreate(false)}
                    aria-label="انصراف"
                    className="rounded-xl border border-slate-200 bg-white px-3 text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </form>
            )}
          </section>

          {/* Media toggles */}
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <h3 className="mb-1 text-sm font-bold text-slate-900 dark:text-white">وضعیت اولیه ورود</h3>
            <p className="mb-3 text-[10px] leading-4 text-slate-400">میکروفن و دوربین پیش از ورود نهایی دوباره قابل انتخاب هستند.</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setIsMuted(m => !m)}
                aria-pressed={isMuted}
                aria-label={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'}
                className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition-colors ${isMuted ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-400' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
                {isMuted ? 'بی‌صدا' : 'میکروفن روشن'}
              </button>
              <button
                onClick={() => setIsVideoOff(v => !v)}
                aria-pressed={isVideoOff}
                aria-label={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'}
                className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-xs font-bold transition-colors ${isVideoOff ? 'border-red-200 bg-red-50 text-red-600 dark:border-red-900/60 dark:bg-red-950/25 dark:text-red-400' : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'}`}
              >
                {isVideoOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}
                {isVideoOff ? 'دوربین خاموش' : 'دوربین روشن'}
              </button>
            </div>
          </section>
        </aside>

        {/* Rooms panel */}
        <main className="min-w-0">
          <section className="h-full rounded-[24px] border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 sm:p-5">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Globe className="h-4 w-4 text-teal-500" /> اتاق‌های در دسترس
                  {!loading && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {rooms.length} اتاق
                    </span>
                  )}
                </h3>
                <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">اتاق‌هایی که میزبان آن هستید یا برای شما دعوت ثبت شده است.</p>
              </div>
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500">
                <Calendar className="h-3.5 w-3.5" /> بروزرسانی خودکار وضعیت اتاق‌ها
              </div>
            </div>

            {loading ? (
              <div className="flex min-h-[330px] items-center justify-center">
                <div className="flex flex-col items-center gap-2 text-slate-400">
                  <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
                  <span className="text-xs">در حال دریافت اتاق‌ها...</span>
                </div>
              </div>
            ) : rooms.length === 0 ? (
              <div className="flex min-h-[330px] flex-col items-center justify-center gap-3 px-4 text-center text-slate-400">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                  <Video className="h-8 w-8 opacity-40" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">اتاق فعالی برای شما وجود ندارد</p>
                  <p className="mt-1 text-xs text-slate-400">جلسه جدید بسازید یا با کد دعوت وارد یک اتاق شوید.</p>
                </div>
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-1 flex items-center gap-2 rounded-xl bg-teal-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-teal-700"
                >
                  <Plus className="h-4 w-4" /> جلسه جدید
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
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
          </section>
        </main>
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
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          dir="rtl"
        >
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-gray-950 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-950 px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-white">
                  <Video className="h-4 w-4 text-teal-500" /> تنظیمات قبل از ورود
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">{preJoinRoom.name || 'جلسه ویدیویی'}</p>
              </div>
              <button
                onClick={() => setPreJoinRoom(null)}
                aria-label="بستن"
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800"
              >
                <X className="h-4 w-4" />
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