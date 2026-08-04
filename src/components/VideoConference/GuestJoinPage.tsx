import { useState, useEffect, useRef, useCallback } from 'react';
import { Video, Loader as Loader2, CircleAlert as AlertCircle, Shield, Lock, Users, ShieldOff, Clock } from 'lucide-react';
import { guestSupabase } from '../../lib/supabase';
import { ConferenceRoomView } from './ConferenceRoom';
import { DeviceSelector } from './DeviceSelector';
import { ConferenceClientContext } from './conferenceClient';
import type { ConferenceRoom } from './types';

const GUEST_ID_KEY = 'conf_guest_id';

function getOrCreateGuestId(): string {
  try {
    const stored = localStorage.getItem(GUEST_ID_KEY);
    if (stored) return stored;
  } catch { /* localStorage unavailable */ }
  const id = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem(GUEST_ID_KEY, id); } catch { /* ignore */ }
  return id;
}

interface Props {
  code: string;
}

interface RoomPublic {
  id: string;
  name: string;
  code: string;
  host_id: string;
  status: string;
  max_participants: number;
  is_locked: boolean;
  has_password: boolean;
  waiting_room_enabled: boolean;
  allow_reactions: boolean;
  allow_screen_share: boolean;
  allow_chat: boolean;
  record_enabled: boolean;
  meeting_id: string | null;
  created_at: string;
  ended_at: string | null;
  participant_count: number;
}

// 5-minute waiting room timeout
const WAITING_TIMEOUT_MS = 5 * 60 * 1000;

export function GuestJoinPage({ code }: Props) {
  const [step, setStep] = useState<'form' | 'waiting' | 'in-room'>('form');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [room, setRoom] = useState<RoomPublic | null>(null);
  const [roomLoading, setRoomLoading] = useState(true);
  const [error, setError] = useState('');
  const [banDetail, setBanDetail] = useState<{ reason: string | null; expiresAt: string | null } | null>(null);
  const [banNow, setBanNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  const [joinAllowed, setJoinAllowed] = useState(false);
  const [meetingStartsIn, setMeetingStartsIn] = useState<number | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [waitingRequestId, setWaitingRequestId] = useState<string | null>(null);
  const [isMuted] = useState(false);
  const [isVideoOff] = useState(false);

  // Stable guest ID persisted across refreshes (prevents ban bypass)
  const [guestId] = useState(() => getOrCreateGuestId());

  const lastJoinAttemptRef = useRef<number>(0);

  // Refs for stable access inside async realtime callbacks
  const localStreamRef = useRef<MediaStream | null>(null);
  const doEnterRoomRef = useRef<((stream: MediaStream, overrideName?: string) => Promise<void>) | null>(null);

  // ── Room loading (fully anonymous — no auth.getUser, no profiles query) ─────
  useEffect(() => {
    let timeInterval: ReturnType<typeof setInterval> | null = null;

    setRoomLoading(true);
    guestSupabase
      .from('conference_rooms')
      .select('id, name, code, host_id, status, max_participants, is_locked, waiting_room_enabled, allow_reactions, allow_screen_share, allow_chat, record_enabled, meeting_id, created_at, ended_at')
      .eq('code', code.toUpperCase().trim())
      .neq('status', 'ended')
      .maybeSingle()
      .then(async ({ data, error: fetchErr }) => {
        setRoomLoading(false);
        if (fetchErr || !data) { setError('اتاقی با این کد یافت نشد یا جلسه پایان یافته است'); return; }

        const { data: hasPwd } = await guestSupabase.rpc('room_has_password', { p_room_id: data.id });

        const { count } = await guestSupabase
          .from('conference_participants')
          .select('*', { count: 'exact', head: true })
          .eq('room_id', data.id)
          .eq('status', 'joined');

        const roomData: RoomPublic = {
          ...data,
          has_password: hasPwd === true,
          participant_count: count ?? 0,
        };
        setRoom(roomData);

        const { data: meeting } = await guestSupabase
          .from('meetings')
          .select('start_time, request_date')
          .eq('conference_room_id', data.id)
          .maybeSingle();

        if (!meeting?.start_time || !meeting?.request_date) {
          setJoinAllowed(true);
          return;
        }

        const checkTime = () => {
          try {
            const dateStr = meeting.request_date.slice(0, 10);
            const [h, min] = meeting.start_time.split(':').map(Number);
            const meetingStart = new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`);
            const tenMinBefore = new Date(meetingStart.getTime() - 10 * 60 * 1000);
            const now = new Date();
            if (now >= tenMinBefore) {
              setJoinAllowed(true);
              setMeetingStartsIn(null);
            } else {
              setJoinAllowed(false);
              setMeetingStartsIn(Math.ceil((tenMinBefore.getTime() - now.getTime()) / 60000));
            }
          } catch {
            setJoinAllowed(true);
          }
        };

        checkTime();
        timeInterval = setInterval(checkTime, 30000);
      })
      .catch(() => {
        setRoomLoading(false);
        setError('خطا در بارگذاری اتاق. لطفاً صفحه را رفرش کنید.');
      });

    return () => { if (timeInterval) clearInterval(timeInterval); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Keep refs current whenever state changes
  useEffect(() => { localStreamRef.current = localStream; }, [localStream]);

  // ── Ban check on load + realtime watch ────────────────────────────────────
  useEffect(() => {
    if (!room) return;
    const userId = guestId;

    const checkBan = async () => {
      const { data } = await guestSupabase
        .from('banned_users')
        .select('reason, expires_at')
        .eq('room_id', room.id)
        .eq('user_id', userId)
        .maybeSingle();

      if (!data) { setBanDetail(null); return; }

      const stillActive = !data.expires_at || new Date(data.expires_at) > new Date();
      if (stillActive) {
        setBanDetail({ reason: data.reason ?? null, expiresAt: data.expires_at ?? null });
      } else {
        setBanDetail(null);
      }
    };

    checkBan();

    // Watch for ban being added or removed for this user in realtime
    const ch = guestSupabase
      .channel(`my-ban-${room.id}-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'banned_users', filter: `room_id=eq.${room.id}` },
        ({ eventType, new: newRow, old: oldRow }) => {
          const affected = (eventType === 'DELETE' ? oldRow : newRow) as { user_id?: string; reason?: string | null; expires_at?: string | null } | undefined;
          if (!affected || affected.user_id !== userId) return;

          if (eventType === 'DELETE') {
            setBanDetail(null);
            return;
          }
          const active = !affected.expires_at || new Date(affected.expires_at) > new Date();
          if (active) {
            setBanDetail({ reason: affected.reason ?? null, expiresAt: affected.expires_at ?? null });
          } else {
            setBanDetail(null);
          }
        }
      )
      .subscribe();

    return () => { ch.unsubscribe(); };
  }, [room, guestId]);

  // Tick every 30s to keep countdown fresh when user is on ban screen
  useEffect(() => {
    if (!banDetail?.expiresAt) return;
    const t = setInterval(() => {
      const remaining = new Date(banDetail.expiresAt!).getTime() - Date.now();
      if (remaining <= 0) {
        setBanDetail(null); // auto-clear when expired
        clearInterval(t);
      } else {
        setBanNow(Date.now());
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [banDetail]);

  const doEnterRoom = useCallback(async (stream: MediaStream, overrideName?: string) => {
    if (!room) { setStep('form'); setError('اتاق یافت نشد'); return; }

    // Re-check capacity right before entering
    const { count } = await guestSupabase
      .from('conference_participants')
      .select('*', { count: 'exact', head: true })
      .eq('room_id', room.id)
      .eq('status', 'joined');
    if ((count ?? 0) >= room.max_participants) {
      setStep('form');
      setError('ظرفیت اتاق پر شده است');
      return;
    }

    stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    stream.getVideoTracks().forEach(t => { t.enabled = !isVideoOff; });

    const participantId = guestId;
    const participantName = overrideName || displayName;
    const peerId = `${participantId}-${Date.now()}`;
    setMyPeerId(peerId);

    const { error: upsertErr } = await guestSupabase.from('conference_participants').upsert([{
      room_id: room.id,
      user_id: participantId,
      display_name: participantName,
      role: 'guest',
      status: 'joined',
      joined_at: new Date().toISOString(),
      is_muted: isMuted,
      is_video_off: isVideoOff,
      peer_id: peerId,
    }], { onConflict: 'room_id,user_id' });

    if (upsertErr) {
      setStep('form');
      setError('خطا در ورود به اتاق: ' + upsertErr.message);
      setLoading(false);
      return;
    }

    setLocalStream(stream);
    setStep('in-room');
  }, [room, isMuted, isVideoOff, guestId, displayName]);

  // Keep doEnterRoom ref current
  useEffect(() => { doEnterRoomRef.current = doEnterRoom; }, [doEnterRoom]);

  // ── Waiting room realtime subscription ─────────────────────────────────────
  useEffect(() => {
    if (step !== 'waiting' || !waitingRequestId) return;

    let expired = false;

    const ch = guestSupabase
      .channel(`waiting-${waitingRequestId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conference_waiting_room',
          filter: `id=eq.${waitingRequestId}`,
        },
        async ({ new: row }) => {
          if (expired) return;
          if (row.status === 'admitted') {
            guestSupabase.removeChannel(ch);
            const stream = localStreamRef.current;
            if (stream && doEnterRoomRef.current) {
              await doEnterRoomRef.current(stream);
            } else {
              setStep('form');
              setError('خطا در ورود: جریان رسانه موجود نیست');
            }
          } else if (row.status === 'rejected') {
            guestSupabase.removeChannel(ch);
            setStep('form');
            setError('متاسفانه میزبان درخواست ورود شما را رد کرد');
          }
        }
      )
      .subscribe();

    // 5-minute timeout
    const timeout = setTimeout(async () => {
      expired = true;
      guestSupabase.removeChannel(ch);
      // Clean up the waiting room record
      if (waitingRequestId) {
        await guestSupabase.from('conference_waiting_room').delete().eq('id', waitingRequestId);
      }
      setWaitingRequestId(null);
      setStep('form');
      setError('زمان انتظار به پایان رسید. لطفاً دوباره تلاش کنید.');
    }, WAITING_TIMEOUT_MS);

    return () => {
      expired = true;
      guestSupabase.removeChannel(ch);
      clearTimeout(timeout);
    };
  }, [step, waitingRequestId]);

  const handleJoin = async (stream: MediaStream) => {
    const now = Date.now();
    if (now - lastJoinAttemptRef.current < 2000) return;
    lastJoinAttemptRef.current = now;

    if (!displayName.trim()) { setError('لطفاً نام خود را وارد کنید'); return; }
    if (!room) { setError('اتاق یافت نشد'); return; }
    if (!joinAllowed) {
      setError(`جلسه هنوز شروع نشده است. ورود ${meetingStartsIn !== null ? `${meetingStartsIn} دقیقه دیگر` : 'تا ۱۰ دقیقه قبل از شروع'} فعال می‌شود`);
      return;
    }

    setLoading(true);
    setError('');
    setBanDetail(null);

    const { data: validation, error: rpcErr } = await guestSupabase.rpc('validate_room_join', {
      p_room_id: room.id,
      p_password: room.has_password ? password : null,
      p_user_id: guestId,
    });

    if (rpcErr || !validation) {
      setError('خطا در اتصال به سرور. لطفاً دوباره تلاش کنید.');
      setLoading(false);
      return;
    }

    if (!validation.allowed) {
      if (validation.reason === 'banned') {
        setBanDetail({
          reason: validation.ban_reason ?? null,
          expiresAt: validation.ban_expires_at ?? null,
        });
      } else {
        setBanDetail(null);
        const msgs: Record<string, string> = {
          wrong_password: 'رمز عبور اشتباه است',
          room_locked: 'این اتاق قفل شده است',
          room_full: 'ظرفیت اتاق پر شده است',
          room_ended: 'این جلسه پایان یافته است',
          room_not_found: 'اتاقی با این کد یافت نشد',
        };
        setError(msgs[validation.reason] || 'ورود به اتاق امکان‌پذیر نیست');
      }
      setLoading(false);
      return;
    }

    if (room.waiting_room_enabled) {
      const { data: req, error: waitErr } = await guestSupabase
        .from('conference_waiting_room')
        .insert([{ room_id: room.id, user_id: guestId, display_name: displayName }])
        .select()
        .single();

      if (waitErr || !req) {
        setError('خطا در ثبت درخواست ورود. لطفاً دوباره تلاش کنید.');
        setLoading(false);
        return;
      }

      // CRITICAL: store stream in state (and ref) before entering waiting step
      setLocalStream(stream);
      localStreamRef.current = stream;
      setWaitingRequestId(req.id);
      setStep('waiting');
      setLoading(false);
      return;
    }

    await doEnterRoom(stream);
    setLoading(false);
  };

  const handleCancelWaiting = async () => {
    if (waitingRequestId) {
      await guestSupabase.from('conference_waiting_room').delete().eq('id', waitingRequestId);
      setWaitingRequestId(null);
    }
    setStep('form');
  };

  const handleLeave = async () => {
    if (room && myPeerId) {
      await guestSupabase.from('conference_participants')
        .delete().eq('room_id', room.id).eq('peer_id', myPeerId);
    }

    localStream?.getTracks().forEach(t => t.stop());

    setStep('form');
    setLocalStream(null);
    setMyPeerId('');

    if (room) {
      const { data: freshRoom } = await guestSupabase
        .from('conference_rooms')
        .select('id, name, code, host_id, status, max_participants, is_locked, waiting_room_enabled, allow_reactions, allow_screen_share, allow_chat, record_enabled, meeting_id, created_at, ended_at')
        .eq('id', room.id)
        .neq('status', 'ended')
        .maybeSingle();

      if (!freshRoom) { window.location.href = window.location.origin; return; }
      const { data: hasPwd } = await guestSupabase.rpc('room_has_password', { p_room_id: freshRoom.id });
      setRoom({ ...freshRoom, has_password: hasPwd === true, participant_count: 0 });
    }
  };

  // ── In room ─────────────────────────────────────────────────────────────────
  if (step === 'in-room' && room && localStream) {
    const activeUserId = guestId;
    const activeUserName = displayName;
    return (
      <ConferenceClientContext.Provider value={guestSupabase}>
        <div className="h-screen">
          <ConferenceRoomView
            room={room as unknown as ConferenceRoom}
            currentUserId={activeUserId}
            currentUserName={activeUserName}
            myPeerId={myPeerId}
            localStream={localStream}
            onLeave={handleLeave}
          />
        </div>
      </ConferenceClientContext.Provider>
    );
  }

  // ── Waiting room ────────────────────────────────────────────────────────────
  if (step === 'waiting') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4" dir="rtl">
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-8 w-full max-w-sm text-center space-y-6">
          <div className="w-16 h-16 rounded-full border-4 border-teal-500 border-t-transparent animate-spin mx-auto" />
          <div>
            <h2 className="text-xl font-bold text-white mb-2">در اتاق انتظار هستید</h2>
            <p className="text-gray-400 text-sm">منتظر تأیید میزبان باشید...</p>
          </div>
          <div className="bg-gray-800 rounded-xl px-4 py-3">
            <p className="text-gray-400 text-xs">نام شما</p>
            <p className="text-white font-medium">{displayName}</p>
          </div>
          <button
            onClick={handleCancelWaiting}
            className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-sm transition-colors"
          >
            انصراف
          </button>
        </div>
      </div>
    );
  }

  // ── Join form ───────────────────────────────────────────────────────────────
  const isSubmitDisabled = loading || !room || !displayName.trim() || !joinAllowed;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      dir="rtl"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)' }}
    >
      {/* تصویر پس‌زمینه */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-10"
        style={{ backgroundImage: `url('/pexels-photo-3183150.jpg')` }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-gray-950/60 via-gray-950/40 to-gray-950/80" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center mb-2">
          <div className="inline-flex items-center gap-2 mb-3">
            <Video className="w-7 h-7 text-teal-500" />
            <span className="text-2xl font-bold text-white">ورود به جلسه</span>
          </div>
          {roomLoading ? (
            <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
              در حال بارگذاری اتاق...
            </div>
          ) : room ? (
            <div className="bg-gray-800 rounded-xl px-4 py-2 inline-block">
              <p className="text-teal-400 font-medium">{room.name || 'جلسه ویدیویی'}</p>
              <div className="flex items-center justify-center gap-3 mt-1">
                {room.is_locked && <span className="flex items-center gap-1 text-xs text-amber-400"><Lock className="w-3 h-3" /> قفل شده</span>}
                {room.waiting_room_enabled && <span className="flex items-center gap-1 text-xs text-blue-400"><Shield className="w-3 h-3" /> اتاق انتظار</span>}
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <Users className="w-3 h-3" /> {room.participant_count} / {room.max_participants} نفر
                </span>
              </div>
            </div>
          ) : null}
        </div>

        {/* DeviceSelector with extra fields embedded */}
        <DeviceSelector
          onConfirm={(stream) => {
            handleJoin(stream);
          }}
          submitLabel={
            loading ? 'در حال ورود...' :
            !joinAllowed ? 'جلسه هنوز شروع نشده' :
            room?.waiting_room_enabled ? 'درخواست ورود' : 'ورود به جلسه'
          }
          submitDisabled={isSubmitDisabled}
        >
          {/* Errors and join timing */}
          {!joinAllowed && room && (
            <div className="flex items-start gap-2 p-3 bg-amber-900/30 border border-amber-700/50 rounded-xl text-amber-300 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">جلسه هنوز شروع نشده است</p>
                {meetingStartsIn !== null && (
                  <p className="text-xs text-amber-400 mt-0.5">ورود {meetingStartsIn} دقیقه دیگر فعال می‌شود</p>
                )}
              </div>
            </div>
          )}

          {banDetail && (
            <div className="p-4 bg-red-950/60 border border-red-700/60 rounded-xl space-y-2" dir="rtl">
              <div className="flex items-center gap-2 text-red-400">
                <ShieldOff className="w-4 h-4 flex-shrink-0" />
                <span className="font-semibold text-sm">دسترسی شما مسدود شده است</span>
              </div>
              {banDetail.reason && (
                <p className="text-red-300 text-sm bg-red-900/30 rounded-lg px-3 py-2">
                  <span className="text-red-400 text-xs block mb-0.5">دلیل:</span>
                  {banDetail.reason}
                </p>
              )}
              {banDetail.expiresAt ? (
                <div className="flex items-center gap-1.5 text-amber-400 text-xs">
                  <Clock className="w-3.5 h-3.5 flex-shrink-0" />
                  {(() => {
                    const diff = Math.ceil((new Date(banDetail.expiresAt).getTime() - banNow) / 60000);
                    if (diff <= 0) return 'مسدودیت منقضی شده — لطفاً دوباره تلاش کنید';
                    if (diff < 60) return `رفع مسدودیت پس از ${diff} دقیقه`;
                    const h = Math.floor(diff / 60);
                    const m = diff % 60;
                    return `رفع مسدودیت پس از ${h} ساعت${m ? ` و ${m} دقیقه` : ''}`;
                  })()}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 text-red-500 text-xs">
                  <ShieldOff className="w-3.5 h-3.5 flex-shrink-0" />
                  مسدودیت دائمی
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Name input */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">نام شما</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !isSubmitDisabled && localStream) {
                  handleJoin(localStream);
                }
              }}
              placeholder="نام و نام خانوادگی"
              autoFocus
              maxLength={60}
              className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
            />
          </div>

          {/* Password field */}
          {room?.has_password && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">رمز عبور جلسه</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !isSubmitDisabled && localStream) {
                    handleJoin(localStream);
                  }
                }}
                placeholder="رمز عبور"
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
              />
            </div>
          )}

          <p className="text-center text-xs text-gray-500">
            ورود به عنوان مهمان — نیاز به ثبت‌نام ندارد
          </p>
        </DeviceSelector>
      </div>
    </div>
  );
}
