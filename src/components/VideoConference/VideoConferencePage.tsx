import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { getAuthenticatedRTCConfig } from '../../lib/authenticatedRtcConfig';
import { ConferenceClientContext } from './conferenceClient';
import { ConferenceRoomView } from './ConferenceRoom';
import { PreflightDeviceSelector } from './PreflightDeviceSelector';
import { ApprovalWaitingGate } from './ApprovalGate';
import type { ConferenceRoom } from './types';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';

import { InviteModal } from './Page/InviteModal';
import { RoomCard } from './Page/RoomCard';
import { BanDetailModal } from './Page/BanDetailModal';
import { ConferenceArchiveList } from './Page/ConferenceArchiveList';
import { VideoConferenceLobby, type VideoConferenceRuntimeConfig } from './Page/VideoConferenceLobby';

type LobbyRoom = ConferenceRoom & { participant_count?: number; meeting?: any };

const JOIN_ERRORS: Record<string, string> = {
  room_full: 'ظرفیت اتاق پر شده است',
  room_locked: 'این اتاق قفل شده است',
  room_ended: 'این جلسه پایان یافته است',
  room_not_found: 'اتاق یافت نشد',
  not_authenticated: 'نشست کاربری معتبر نیست',
};

export function VideoConferencePage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [userName, setUserName] = useState('');
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
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
  const [runtimeConfig, setRuntimeConfig] = useState<VideoConferenceRuntimeConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const joiningRef = useRef(false);
  const activeRoomRef = useRef<ConferenceRoom | null>(null);
  const userIdRef = useRef<string | null>(null);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  // Best-effort leave on browser/tab close. Heartbeat is owned by ConferenceRoomCore only.
  useEffect(() => {
    const handleUnload = () => {
      const room = activeRoomRef.current;
      if (!room || !userIdRef.current) return;
      void supabase.rpc('leave_conference_room', { p_room_id: room.id });
    };
    window.addEventListener('pagehide', handleUnload);
    window.addEventListener('beforeunload', handleUnload);
    return () => {
      window.removeEventListener('pagehide', handleUnload);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, []);

  const isRoomActive = (room: any): boolean => {
    if (room.status === 'ended') return false;
    if (room.expires_at && new Date(room.expires_at).getTime() <= Date.now()) return false;
    if (room.meeting?.request_date && room.meeting?.end_time) {
      try {
        const localDate = new Date(room.meeting.request_date);
        const y = localDate.getFullYear();
        const mo = String(localDate.getMonth() + 1).padStart(2, '0');
        const d = String(localDate.getDate()).padStart(2, '0');
        const endDt = new Date(`${y}-${mo}-${d}T${room.meeting.end_time}:00`);
        if (!isNaN(endDt.getTime()) && endDt < new Date()) return false;
      } catch { /* DB lifecycle remains authoritative */ }
    }
    return true;
  };

  const fetchRuntimeConfig = useCallback(async () => {
    setConfigLoading(true);
    setConfigError(null);
    try {
      const { data, error } = await supabase.rpc('get_video_conference_runtime_config');
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason || 'CONFIG_UNAVAILABLE');
      setRuntimeConfig(data as VideoConferenceRuntimeConfig);
    } catch (error: any) {
      console.error('video conference runtime config error:', error);
      setRuntimeConfig(null);
      setConfigError(error?.message || 'دریافت پیکربندی ویدیو کنفرانس ناموفق بود');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const fetchRooms = useCallback(async (_uid?: string) => {
    setLoading(true);
    try {
      // RLS already returns only rooms hosted by or joined by the current user.
      const { data: rd, error: rdErr } = await supabase
        .from('conference_rooms')
        .select('id, name, code, host_id, status, max_participants, is_locked, waiting_room_enabled, allow_reactions, allow_screen_share, allow_chat, chat_enabled, record_enabled, speaking_limit_enabled, require_approval, created_at, ended_at, expires_at, meeting_id, media_topology, ended_reason, meeting:meeting_id(request_date, start_time, end_time, subject)')
        .neq('status', 'ended')
        .order('created_at', { ascending: false });
      if (rdErr) throw rdErr;
      const active = (rd || []).filter(isRoomActive);
      if (!active.length) { setRooms([]); return; }

      const activeIds = active.map(r => r.id);
      const { data: countRows, error: cErr } = await supabase
        .from('conference_participants')
        .select('room_id')
        .in('room_id', activeIds)
        .eq('status', 'joined');
      if (cErr) throw cErr;
      const countMap: Record<string, number> = {};
      (countRows || []).forEach(row => { countMap[row.room_id] = (countMap[row.room_id] || 0) + 1; });
      setRooms(active.map(r => ({ ...r, participant_count: countMap[r.id] ?? 0 })) as LobbyRoom[]);
    } catch (e: any) {
      console.error('fetchRooms error:', e);
      toast.error('خطا در بارگذاری اتاق‌ها: ' + (e.message || ''));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setNotLoggedIn(true); setLoading(false); return; }
        if (user.is_anonymous === true) {
          await supabase.auth.signOut();
          setNotLoggedIn(true);
          setLoading(false);
          return;
        }
        setUserId(user.id);
        const { data: p } = await supabase.from('profiles').select('full_name, email').eq('user_id', user.id).maybeSingle();
        setUserName(p?.full_name || p?.email || 'کاربر');

        const linkedCode = new URLSearchParams(window.location.search).get('conference');
        if (linkedCode) {
          const normalized = linkedCode.trim().toUpperCase();
          const { data: linkedRoom, error: resolveError } = await supabase.rpc('resolve_conference_room', { p_code: normalized });
          if (resolveError) throw resolveError;
          if (!linkedRoom) {
            toast.error('اتاقی با این کد یافت نشد');
          } else {
            const room = linkedRoom as unknown as ConferenceRoom;
            const { data: access, error: accessError } = await supabase.rpc('check_conference_join', { p_room_id: room.id });
            if (accessError) throw accessError;
            if (access?.allowed) setPreJoinRoom(room);
            else toast.error(JOIN_ERRORS[access?.reason] || 'شما مجوز ورود به این جلسه را ندارید');
          }
        }
        await Promise.all([fetchRooms(user.id), fetchRuntimeConfig()]);
      } catch (e) {
        console.error('init error:', e);
        toast.error('خطا در بارگذاری اطلاعات');
        setLoading(false);
      }
    })();
  }, [fetchRooms, fetchRuntimeConfig]);

  useEffect(() => {
    if (!userId) return;
    const timer = window.setInterval(() => { void fetchRuntimeConfig(); }, 30000);
    return () => window.clearInterval(timer);
  }, [userId, fetchRuntimeConfig]);

  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel('conf-rooms-lobby')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_rooms' }, () => {
        if (!activeRoomRef.current) fetchRooms(userIdRef.current || undefined);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [userId, fetchRooms]);

  const enterRoom = async (room: ConferenceRoom, stream: MediaStream, muted: boolean, videoOff: boolean) => {
    if (!userId) return false;
    setJoiningRoomId(room.id);
    const peerId = `${userId}-${Date.now()}`;
    setMyPeerId(peerId);
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    stream.getAudioTracks().forEach(t => { t.enabled = !muted; });
    stream.getVideoTracks().forEach(t => { t.enabled = !videoOff; });
    try {
      const { data: result, error } = await supabase.rpc('join_conference_room', {
        p_room_id: room.id,
        p_peer_id: peerId,
        p_display_name: userName,
        p_is_muted: muted,
        p_is_video_off: videoOff,
      });
      if (error) throw error;
      if (!result?.allowed) {
        if (result?.reason === 'banned') setBanDetail({ reason: result.ban_reason ?? null, expiresAt: result.ban_expires_at ?? null });
        throw new Error(JOIN_ERRORS[result?.reason] || 'ورود به جلسه مجاز نیست');
      }
      setLocalStream(stream);
      setActiveRoom({ ...room });
      setJoinCode('');
      setPreJoinRoom(null);
      return true;
    } catch (e: any) {
      stream.getTracks().forEach(t => t.stop());
      toast.error('خطا در ورود به اتاق: ' + (e.message || ''));
      return false;
    } finally {
      setJoiningRoomId(null);
    }
  };

  const doJoin = async (room: ConferenceRoom, stream: MediaStream) => {
    if (!userId || joiningRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
    joiningRef.current = true;
    try {
      const { data: validation, error } = await supabase.rpc('check_conference_join', { p_room_id: room.id });
      if (error) throw error;
      if (!validation?.allowed) {
        stream.getTracks().forEach(t => t.stop());
        if (validation?.reason === 'banned') {
          setBanDetail({ reason: validation.ban_reason ?? null, expiresAt: validation.ban_expires_at ?? null });
          setPreJoinRoom(null);
        } else {
          toast.error(JOIN_ERRORS[validation?.reason] || 'ورود به جلسه امکان‌پذیر نیست');
        }
        return;
      }
      if (room.require_approval && room.host_id !== userId) {
        setWaitingApproval({ room, stream, isMuted, isVideoOff });
        setPreJoinRoom(null);
        return;
      }
      await enterRoom(room, stream, isMuted, isVideoOff);
    } catch (e: any) {
      stream.getTracks().forEach(t => t.stop());
      toast.error('خطا در بررسی دسترسی جلسه: ' + (e.message || ''));
    } finally {
      joiningRef.current = false;
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    const conferenceWindow = window.open('about:blank', '_blank');
    if (conferenceWindow) conferenceWindow.opener = null;
    setCreating(true);
    try {
      const fallbackName = `جلسه ${moment().format('jYYYY/jMM/jDD HH:mm')}`;
      const { data: result, error } = await supabase.rpc('create_conference_room', {
        p_name: createName.trim() || fallbackName,
        p_require_approval: requireApproval,
      });
      if (error) throw error;
      if (!result?.ok || !result?.room) throw new Error(result?.reason || 'ROOM_CREATE_FAILED');
      const room = result.room as ConferenceRoom;
      setCreateName(''); setRequireApproval(false); setShowCreate(false);
      const url = new URL(window.location.href);
      url.search = '';
      url.hash = '';
      url.searchParams.set('conference', room.code);
      if (conferenceWindow && !conferenceWindow.closed) {
        conferenceWindow.location.replace(url.toString());
      } else {
        const opened = window.open(url.toString(), '_blank', 'noopener,noreferrer');
        if (!opened) window.location.assign(url.toString());
      }
    } catch (e: any) {
      conferenceWindow?.close();
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
      const { data: room, error } = await supabase.rpc('resolve_conference_room', { p_code: formatted });
      if (error) throw error;
      if (!room) { toast.error('اتاقی با این کد یافت نشد'); return; }
      setPreJoinRoom(room as unknown as ConferenceRoom);
    } catch (e: any) {
      toast.error('خطا در ورود با کد: ' + (e.message || ''));
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async () => {
    try {
      if (activeRoom) await supabase.rpc('leave_conference_room', { p_room_id: activeRoom.id });
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
        <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center"><Video className="w-8 h-8 text-gray-400" /></div>
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
          await enterRoom(room, stream, mut, voff);
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
        {inviteRoom && userId && <InviteModal room={inviteRoom} currentUserId={userId} onClose={() => setInviteRoom(null)} />}
        {banDetail && <BanDetailModal banDetail={banDetail} onClose={() => setBanDetail(null)} />}
      </>
    );
  }

  const refreshLobby = () => {
    void Promise.all([fetchRooms(userId || undefined), fetchRuntimeConfig()]);
  };

  return (
    <div className="h-full min-h-0 space-y-4 overflow-y-auto pb-5" dir="rtl">
      <VideoConferenceLobby
        config={runtimeConfig}
        configLoading={configLoading}
        configError={configError}
        rooms={rooms}
        loading={loading}
        currentUserId={userId || ''}
        joiningRoomId={joiningRoomId}
        joinCode={joinCode}
        joining={joining}
        showCreate={showCreate}
        createName={createName}
        creating={creating}
        requireApproval={requireApproval}
        isMuted={isMuted}
        isVideoOff={isVideoOff}
        onRefresh={refreshLobby}
        onJoinCodeChange={setJoinCode}
        onJoinByCode={handleJoinByCode}
        onOpenCreate={() => setShowCreate(true)}
        onCloseCreate={() => setShowCreate(false)}
        onCreateNameChange={setCreateName}
        onRequireApprovalChange={setRequireApproval}
        onCreate={handleCreate}
        onToggleMuted={() => setIsMuted(value => !value)}
        onToggleVideo={() => setIsVideoOff(value => !value)}
        onJoinRoom={room => setPreJoinRoom(room)}
        onInviteRoom={room => setInviteRoom(room)}
      />

      <ConferenceArchiveList />

      {inviteRoom && userId && <InviteModal room={inviteRoom} currentUserId={userId} onClose={() => setInviteRoom(null)} />}
      {banDetail && <BanDetailModal banDetail={banDetail} onClose={() => setBanDetail(null)} />}

      {preJoinRoom && (
        <div role="dialog" aria-modal="true" aria-label="تنظیم دستگاه قبل از ورود" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" dir="rtl">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-gray-950 shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-800 bg-gray-950 px-5 py-4"><div><h2 className="flex items-center gap-2 text-sm font-bold text-white"><Video className="h-4 w-4 text-teal-500" /> تنظیمات قبل از ورود</h2><p className="mt-0.5 text-xs text-gray-500">{preJoinRoom.name || 'جلسه ویدیویی'}</p></div><button onClick={() => setPreJoinRoom(null)} aria-label="بستن" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800"><X className="h-4 w-4" /></button></div>
            <div className="p-5"><PreflightDeviceSelector onConfirm={(stream) => doJoin(preJoinRoom, stream)} loadRTCConfig={getAuthenticatedRTCConfig} client={supabase} roomId={preJoinRoom.id} userId={userId} submitLabel="ورود به جلسه" /></div>
          </div>
        </div>
      )}
    </div>
  );
}
