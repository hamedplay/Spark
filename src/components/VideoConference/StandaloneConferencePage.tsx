import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, Radio, ShieldAlert, Video, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { getAuthenticatedRTCConfig } from '../../lib/authenticatedRtcConfig';
import { ConferenceClientContext } from './conferenceClient';
import { ConferenceRoomView } from './ConferenceRoom';
import { PreflightDeviceSelector } from './PreflightDeviceSelector';
import { ApprovalWaitingGate } from './ApprovalGate';
import { InviteModal } from './Page/InviteModal';
import { BanDetailModal } from './Page/BanDetailModal';
import type { ConferenceRoom } from './types';

const JOIN_ERRORS: Record<string, string> = {
  room_full: 'ظرفیت اتاق پر شده است',
  room_locked: 'این اتاق قفل شده است',
  room_ended: 'این جلسه پایان یافته است',
  room_not_found: 'اتاق یافت نشد',
  not_authenticated: 'نشست کاربری معتبر نیست',
};

type RecordingConsentState = {
  loading: boolean;
  busy: boolean;
  required: boolean;
  recordingEnabled: boolean;
  recordingActive: boolean;
  accepted: boolean;
  status: 'pending' | 'accepted' | 'declined';
  errorMessage: string;
};

const EMPTY_RECORDING_CONSENT: RecordingConsentState = {
  loading: false,
  busy: false,
  required: false,
  recordingEnabled: false,
  recordingActive: false,
  accepted: false,
  status: 'pending',
  errorMessage: '',
};

function getRoomCode(): string {
  const prefix = '/conference/';
  if (!window.location.pathname.startsWith(prefix)) return '';
  const raw = window.location.pathname.slice(prefix.length).split('/')[0] || '';
  try {
    return decodeURIComponent(raw).trim().toUpperCase();
  } catch {
    return raw.trim().toUpperCase();
  }
}

function createSessionId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export default function StandaloneConferencePage() {
  const roomCode = getRoomCode();
  const sessionIdRef = useRef(createSessionId());
  const sessionKey = roomCode ? `spark:conference-session:${roomCode}` : '';

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [finishedMessage, setFinishedMessage] = useState('');
  const [userId, setUserId] = useState('');
  const [userName, setUserName] = useState('');
  const [room, setRoom] = useState<ConferenceRoom | null>(null);
  const [activeRoom, setActiveRoom] = useState<ConferenceRoom | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [waitingApproval, setWaitingApproval] = useState<{
    room: ConferenceRoom;
    stream: MediaStream;
    isMuted: boolean;
    isVideoOff: boolean;
  } | null>(null);
  const [inviteRoom, setInviteRoom] = useState<ConferenceRoom | null>(null);
  const [banDetail, setBanDetail] = useState<{ reason: string | null; expiresAt: string | null } | null>(null);
  const [recordingConsent, setRecordingConsent] = useState<RecordingConsentState>(EMPTY_RECORDING_CONSENT);

  const activeRoomRef = useRef<ConferenceRoom | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const userIdRef = useRef('');
  const closingRef = useRef(false);

  useEffect(() => { activeRoomRef.current = activeRoom; }, [activeRoom]);
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

  const clearSessionMarker = useCallback(() => {
    if (!sessionKey) return;
    try {
      if (sessionStorage.getItem(sessionKey) === sessionIdRef.current) {
        sessionStorage.removeItem(sessionKey);
      }
    } catch { /* sessionStorage is best effort */ }
  }, [sessionKey]);

  const finishSession = useCallback((message: string) => {
    if (closingRef.current) return;
    closingRef.current = true;
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setActiveRoom(null);
    setFinishedMessage(message);
    clearSessionMarker();

    window.setTimeout(() => {
      window.close();
      window.setTimeout(() => { closingRef.current = false; }, 250);
    }, 50);
  }, [clearSessionMarker]);

  const readRecordingConsentState = useCallback(async (roomId: string) => {
    const { data, error } = await supabase.rpc('get_conference_recording_consent_state', { p_room_id: roomId });
    if (error) throw error;
    if (!data?.ok) throw new Error(String(data?.reason || 'RECORDING_CONSENT_LOAD_FAILED'));
    return {
      required: data.required === true,
      recordingEnabled: data.recordingEnabled === true,
      recordingActive: data.recordingActive === true,
      accepted: data.accepted === true,
      status: data.myStatus === 'accepted' || data.myStatus === 'declined' ? data.myStatus : 'pending',
    } as const;
  }, []);

  const loadRecordingConsent = useCallback(async (roomId: string) => {
    setRecordingConsent(current => ({ ...current, loading: true, errorMessage: '' }));
    try {
      const next = await readRecordingConsentState(roomId);
      setRecordingConsent({ ...EMPTY_RECORDING_CONSENT, ...next });
    } catch (error) {
      console.error('standalone recording consent load failed', error);
      setRecordingConsent({
        ...EMPTY_RECORDING_CONSENT,
        errorMessage: 'دریافت وضعیت رضایت ضبط ناموفق بود.',
      });
    }
  }, [readRecordingConsentState]);

  useEffect(() => {
    if (!roomCode) {
      setErrorMessage('کد اتاق معتبر نیست.');
      setLoading(false);
      return;
    }

    try { sessionStorage.setItem(sessionKey, sessionIdRef.current); } catch { /* best effort */ }

    let cancelled = false;
    void (async () => {
      try {
        const { data: { user }, error: userError } = await supabase.auth.getUser();
        if (userError) throw userError;
        if (!user || user.is_anonymous === true) throw new Error('برای ورود به جلسه باید وارد سامانه شوید.');
        if (cancelled) return;

        setUserId(user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('full_name, email')
          .eq('user_id', user.id)
          .maybeSingle();
        if (cancelled) return;
        setUserName(profile?.full_name || profile?.email || 'کاربر');

        const { data: resolvedRoom, error: resolveError } = await supabase.rpc('resolve_conference_room', { p_code: roomCode });
        if (resolveError) throw resolveError;
        if (!resolvedRoom) throw new Error('این اتاق وجود ندارد یا جلسه پایان یافته است.');
        const nextRoom = resolvedRoom as unknown as ConferenceRoom;

        const { data: access, error: accessError } = await supabase.rpc('check_conference_join', { p_room_id: nextRoom.id });
        if (accessError) throw accessError;
        if (!access?.allowed) {
          if (access?.reason === 'banned') {
            setBanDetail({ reason: access.ban_reason ?? null, expiresAt: access.ban_expires_at ?? null });
          }
          throw new Error(JOIN_ERRORS[access?.reason] || 'شما مجوز ورود به این جلسه را ندارید.');
        }

        if (cancelled) return;
        setRoom(nextRoom);
        await loadRecordingConsent(nextRoom.id);
      } catch (error: any) {
        if (!cancelled) setErrorMessage(error?.message || 'بارگذاری جلسه ناموفق بود.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [loadRecordingConsent, roomCode, sessionKey]);

  useEffect(() => {
    if (!room?.id) return;
    const channel = supabase
      .channel(`standalone-room-lifecycle-${room.id}-${sessionIdRef.current}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conference_rooms', filter: `id=eq.${room.id}` },
        payload => {
          const status = (payload.new as { status?: string } | null)?.status;
          if (status === 'ended') finishSession('جلسه پایان یافت.');
        },
      )
      .subscribe();

    return () => { void supabase.removeChannel(channel); };
  }, [finishSession, room?.id]);

  useEffect(() => {
    const handlePageHide = () => {
      const currentRoom = activeRoomRef.current;
      if (currentRoom && userIdRef.current) {
        void supabase.rpc('leave_conference_room', { p_room_id: currentRoom.id });
      }
      clearSessionMarker();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => window.removeEventListener('pagehide', handlePageHide);
  }, [clearSessionMarker]);

  const updateRecordingConsent = useCallback(async (accepted: boolean) => {
    if (!room || recordingConsent.busy) return;
    setRecordingConsent(current => ({ ...current, busy: true, errorMessage: '' }));
    try {
      const { data, error } = await supabase.rpc('set_conference_recording_consent', {
        p_room_id: room.id,
        p_consented: accepted,
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(String(data?.reason || 'RECORDING_CONSENT_SAVE_FAILED'));
      const next = await readRecordingConsentState(room.id);
      setRecordingConsent({ ...EMPTY_RECORDING_CONSENT, ...next });
    } catch (error) {
      console.error('standalone recording consent save failed', error);
      setRecordingConsent(current => ({ ...current, errorMessage: 'ثبت وضعیت رضایت ضبط ناموفق بود.' }));
    } finally {
      setRecordingConsent(current => ({ ...current, busy: false }));
    }
  }, [readRecordingConsentState, recordingConsent.busy, room]);

  const enterRoom = useCallback(async (
    targetRoom: ConferenceRoom,
    stream: MediaStream,
    muted: boolean,
    videoOff: boolean,
  ) => {
    if (!userId) {
      stream.getTracks().forEach(track => track.stop());
      return false;
    }

    const peerId = `${userId}-${sessionIdRef.current}`;
    stream.getAudioTracks().forEach(track => { track.enabled = !muted; });
    stream.getVideoTracks().forEach(track => { track.enabled = !videoOff; });

    try {
      const consent = await readRecordingConsentState(targetRoom.id);
      if (consent.required && consent.recordingActive && !consent.accepted) {
        stream.getTracks().forEach(track => track.stop());
        toast.error('این جلسه در حال ضبط است؛ برای ورود ابتدا رضایت ضبط را تأیید کنید.');
        await loadRecordingConsent(targetRoom.id);
        return false;
      }

      const { data: result, error } = await supabase.rpc('join_conference_room', {
        p_room_id: targetRoom.id,
        p_peer_id: peerId,
        p_display_name: userName,
        p_is_muted: muted,
        p_is_video_off: videoOff,
      });
      if (error) throw error;
      if (!result?.allowed) {
        if (result?.reason === 'banned') {
          setBanDetail({ reason: result.ban_reason ?? null, expiresAt: result.ban_expires_at ?? null });
        }
        throw new Error(JOIN_ERRORS[result?.reason] || 'ورود به جلسه مجاز نیست');
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setMyPeerId(peerId);
      setActiveRoom(targetRoom);
      return true;
    } catch (error: any) {
      stream.getTracks().forEach(track => track.stop());
      toast.error('خطا در ورود به اتاق: ' + (error?.message || ''));
      return false;
    }
  }, [loadRecordingConsent, readRecordingConsentState, userId, userName]);

  const doJoin = useCallback(async (stream: MediaStream) => {
    if (!room || !userId) {
      stream.getTracks().forEach(track => track.stop());
      return;
    }

    try {
      const { data: validation, error } = await supabase.rpc('check_conference_join', { p_room_id: room.id });
      if (error) throw error;
      if (!validation?.allowed) {
        stream.getTracks().forEach(track => track.stop());
        if (validation?.reason === 'banned') {
          setBanDetail({ reason: validation.ban_reason ?? null, expiresAt: validation.ban_expires_at ?? null });
        }
        throw new Error(JOIN_ERRORS[validation?.reason] || 'ورود به جلسه امکان‌پذیر نیست');
      }

      if (room.require_approval && room.host_id !== userId && room.media_topology !== 'sfu') {
        setWaitingApproval({ room, stream, isMuted, isVideoOff });
        return;
      }

      await enterRoom(room, stream, isMuted, isVideoOff);
    } catch (error: any) {
      stream.getTracks().forEach(track => track.stop());
      toast.error(error?.message || 'بررسی دسترسی جلسه ناموفق بود.');
    }
  }, [enterRoom, isMuted, isVideoOff, room, userId]);

  const handleConferenceLeave = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(track => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setActiveRoom(null);
    finishSession('از جلسه خارج شدید.');
  }, [finishSession]);

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-950 text-white" dir="rtl">
        <div className="flex items-center gap-3 text-sm font-bold"><Loader2 className="h-5 w-5 animate-spin text-blue-400" /> در حال آماده‌سازی جلسه...</div>
      </div>
    );
  }

  if (finishedMessage || errorMessage || !room) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-slate-950 p-6 text-white" dir="rtl">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-7 text-center shadow-2xl">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-500/10 text-blue-400"><Video className="h-7 w-7" /></div>
          <h1 className="mt-4 text-lg font-black">{finishedMessage || 'امکان ورود به جلسه وجود ندارد'}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{errorMessage || 'این صفحه مربوط به Session مستقل جلسه است و پس از پایان دیگر قابل استفاده نیست.'}</p>
          <button type="button" onClick={() => window.close()} className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-extrabold text-white hover:bg-blue-700">بستن صفحه</button>
        </div>
        {banDetail && <BanDetailModal banDetail={banDetail} onClose={() => setBanDetail(null)} />}
      </div>
    );
  }

  if (waitingApproval) {
    return (
      <div className="fixed inset-0 bg-slate-950" dir="rtl">
        <ApprovalWaitingGate
          roomId={waitingApproval.room.id}
          userId={userId}
          displayName={userName}
          onApproved={async () => {
            const current = waitingApproval;
            setWaitingApproval(null);
            await enterRoom(current.room, current.stream, current.isMuted, current.isVideoOff);
          }}
          onRejected={() => {
            waitingApproval.stream.getTracks().forEach(track => track.stop());
            setWaitingApproval(null);
            finishSession('درخواست ورود به جلسه رد شد.');
          }}
          onCancel={() => {
            waitingApproval.stream.getTracks().forEach(track => track.stop());
            setWaitingApproval(null);
            finishSession('ورود به جلسه لغو شد.');
          }}
        />
      </div>
    );
  }

  if (activeRoom && localStream) {
    return (
      <div className="fixed inset-0 overflow-hidden bg-slate-950" dir="rtl">
        <ConferenceClientContext.Provider value={supabase}>
          <ConferenceRoomView
            room={activeRoom}
            currentUserId={userId}
            currentUserName={userName}
            myPeerId={myPeerId}
            localStream={localStream}
            onLeave={handleConferenceLeave}
            onInvite={() => setInviteRoom(activeRoom)}
            loadRTCConfig={getAuthenticatedRTCConfig}
          />
        </ConferenceClientContext.Provider>
        {inviteRoom && <InviteModal room={inviteRoom} currentUserId={userId} onClose={() => setInviteRoom(null)} />}
        {banDetail && <BanDetailModal banDetail={banDetail} onClose={() => setBanDetail(null)} />}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-slate-950 p-4" dir="rtl">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-800 bg-gray-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
          <div>
            <h1 className="flex items-center gap-2 text-sm font-bold text-white"><Video className="h-4 w-4 text-teal-500" /> تنظیمات قبل از ورود</h1>
            <p className="mt-0.5 text-xs text-gray-500">{room.name || 'جلسه ویدیویی'} · {room.code}</p>
          </div>
          <button type="button" onClick={() => finishSession('ورود به جلسه لغو شد.')} aria-label="بستن" className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-800"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5">
          <PreflightDeviceSelector
            onConfirm={stream => {
              if (recordingConsent.required && recordingConsent.recordingActive && !recordingConsent.accepted) {
                stream.getTracks().forEach(track => track.stop());
                toast.error('برای ورود به جلسه در حال ضبط، ابتدا رضایت ضبط را تأیید کنید.');
                return;
              }
              void doJoin(stream);
            }}
            loadRTCConfig={getAuthenticatedRTCConfig}
            client={supabase}
            roomId={room.id}
            userId={userId}
            mediaTopology={room.media_topology}
            submitLabel="ورود به جلسه"
            submitDisabled={recordingConsent.loading || (recordingConsent.required && recordingConsent.recordingActive && !recordingConsent.accepted)}
          >
            {recordingConsent.recordingEnabled && recordingConsent.required && (
              <div className={`rounded-xl border p-3 text-xs ${recordingConsent.recordingActive ? 'border-rose-400/30 bg-rose-500/10 text-rose-100' : 'border-amber-400/25 bg-amber-500/10 text-amber-100'}`}>
                <div className="flex items-start gap-2">
                  {recordingConsent.recordingActive ? <Radio className="mt-0.5 h-4 w-4 shrink-0" /> : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-bold">رضایت ضبط جلسه</div>
                    <p className="mt-1 leading-5 opacity-90">
                      {recordingConsent.recordingActive
                        ? 'این جلسه هم‌اکنون در حال ضبط سروری است. برای ورود باید رضایت ضبط صدا و تصویر خود را ثبت کنید.'
                        : 'این جلسه قابلیت ضبط سروری دارد. می‌توانید اکنون وضعیت رضایت خود را ثبت کنید.'}
                    </p>
                    {recordingConsent.errorMessage && <div className="mt-2 text-rose-300">{recordingConsent.errorMessage}</div>}
                    <div className="mt-3 flex gap-2">
                      <button type="button" disabled={recordingConsent.busy} onClick={() => void updateRecordingConsent(true)} className={`flex min-h-9 items-center gap-1.5 rounded-lg px-3 font-bold ${recordingConsent.accepted ? 'bg-emerald-600 text-white' : 'bg-white/10 hover:bg-white/15'} disabled:opacity-50`}>
                        {recordingConsent.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} موافقم
                      </button>
                      <button type="button" disabled={recordingConsent.busy} onClick={() => void updateRecordingConsent(false)} className="min-h-9 rounded-lg border border-white/15 px-3 font-bold disabled:opacity-50">موافق نیستم</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </PreflightDeviceSelector>
        </div>
      </div>
      {banDetail && <BanDetailModal banDetail={banDetail} onClose={() => setBanDetail(null)} />}
    </div>
  );
}
