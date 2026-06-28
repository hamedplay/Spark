import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Video, Mic, MicOff, VideoOff, Loader2, LogIn, AlertCircle, Shield, Lock } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ConferenceRoomView } from './ConferenceRoom';
import type { ConferenceRoom } from './types';

function generateGuestId() {
  return crypto.randomUUID();
}

interface Props {
  code: string;
}

export function GuestJoinPage({ code }: Props) {
  const [step, setStep] = useState<'form' | 'waiting' | 'in-room' | 'auth-joining'>('form');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [room, setRoom] = useState<ConferenceRoom | null>(null);
  const [roomLoading, setRoomLoading] = useState(true); // fix 7
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [joinAllowed, setJoinAllowed] = useState(false);
  const [meetingStartsIn, setMeetingStartsIn] = useState<number | null>(null);
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [myPeerId, setMyPeerId] = useState('');
  const [waitingRequestId, setWaitingRequestId] = useState<string | null>(null);
  const [showPlayButton, setShowPlayButton] = useState(false); // fix 9
  const [guestId] = useState(() => generateGuestId());
  // Auth user state — if logged in, skip the name form and auto-join
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authUserName, setAuthUserName] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  // Ref so doEnterRoom (which closes over stale state) always sees latest stream
  const previewStreamRef = useRef<MediaStream | null>(null);
  // fix 8: cooldown ref to prevent join spam
  const lastJoinAttemptRef = useRef<number>(0);
  // fix 5: consecutive poll error counter
  const pollErrorCountRef = useRef(0);

  // Keep ref in sync with state
  useEffect(() => { previewStreamRef.current = previewStream; }, [previewStream]);

  // fix 9: attach srcObject and handle Safari autoplay restriction
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !previewStream) return;
    el.srcObject = previewStream;
    el.play().catch((e: DOMException) => {
      if (e.name === 'NotAllowedError') setShowPlayButton(true);
    });
  }, [previewStream]);

  // Initial setup: camera preview + auth check + room load (fix 10: clean up intervals)
  useEffect(() => {
    let timeInterval: ReturnType<typeof setInterval> | null = null;

    // Start camera preview
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(s => setPreviewStream(s))
      .catch(() => {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(s => { setPreviewStream(s); setIsVideoOff(true); })
          .catch(() => {
            // fix 3: both denied — show clear message
            setIsVideoOff(true);
            setError('دسترسی به دوربین و میکروفن امکان‌پذیر نیست. لطفاً مجوزها را بررسی کنید.');
          });
      });

    // Check if user is already authenticated
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        const { data: profile } = await supabase.from('profiles').select('full_name, email').eq('user_id', user.id).maybeSingle();
        const name = profile?.full_name || profile?.email || 'کاربر';
        setAuthUserId(user.id);
        setAuthUserName(name);
        setDisplayName(name);
      }
    });

    // Load room info + check linked meeting start time
    setRoomLoading(true);
    supabase.from('conference_rooms').select('*')
      .eq('code', code.toUpperCase().trim())
      .neq('status', 'ended')
      .maybeSingle()
      .then(async ({ data }) => {
        setRoomLoading(false);
        if (!data) { setError('اتاقی با این کد یافت نشد یا جلسه پایان یافته است'); return; }
        setRoom(data as ConferenceRoom);

        // Check meeting start time
        const { data: meeting } = await supabase
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
            const meetingStart = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:00`);
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
        // fix 10: store interval ref for cleanup
        timeInterval = setInterval(checkTime, 30000);
      })
      .catch(() => {
        setRoomLoading(false);
        setError('خطا در بارگذاری اتاق. لطفاً صفحه را رفرش کنید.');
      });

    return () => {
      previewStreamRef.current?.getTracks().forEach(t => t.stop());
      if (timeInterval) clearInterval(timeInterval);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // fix 5: poll waiting room status with error tracking
  useEffect(() => {
    if (step !== 'waiting' || !waitingRequestId) return;
    pollErrorCountRef.current = 0;

    const interval = setInterval(async () => {
      try {
        const { data, error: pollErr } = await supabase.from('conference_waiting_room')
          .select('status').eq('id', waitingRequestId).maybeSingle();

        if (pollErr) throw pollErr;
        pollErrorCountRef.current = 0;

        if (data?.status === 'admitted') {
          clearInterval(interval);
          await doEnterRoom();
        } else if (data?.status === 'rejected') {
          clearInterval(interval);
          setStep('form');
          setError('متاسفانه میزبان درخواست ورود شما را رد کرد');
        }
      } catch (e) {
        console.error('waiting room poll error:', e);
        pollErrorCountRef.current += 1;
        if (pollErrorCountRef.current >= 5) {
          clearInterval(interval);
          setStep('form');
          setError('خطا در اتصال به سرور. لطفاً دوباره تلاش کنید.');
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, waitingRequestId]);

  // fix 2: get stream helper — check preview first, retry, then audio-only fallback
  const acquireStream = useCallback(async (): Promise<MediaStream | null> => {
    // Use existing preview if available
    const existing = previewStreamRef.current;
    if (existing && existing.getTracks().some(t => t.readyState === 'live')) {
      return existing;
    }
    // Retry up to 4 times (2s total)
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 500));
      const s = previewStreamRef.current;
      if (s && s.getTracks().some(t => t.readyState === 'live')) return s;
    }
    // Fallback: audio-only
    return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).catch(() => null);
  }, []);

  const doEnterRoom = useCallback(async (overrideName?: string) => {
    if (!room) { setStep('form'); setError('اتاق یافت نشد'); return; }

    const stream = await acquireStream();
    if (!stream) {
      setStep('form');
      setError('دسترسی به دوربین و میکروفن امکان‌پذیر نیست. لطفاً مجوزها را بررسی کنید.');
      return;
    }

    stream.getAudioTracks().forEach(t => { t.enabled = !isMuted; });
    stream.getVideoTracks().forEach(t => { t.enabled = !isVideoOff; });

    const participantId = authUserId || guestId;
    const participantName = overrideName || displayName;
    const peerId = `${participantId}-${Date.now()}`;
    setMyPeerId(peerId);

    const { error: upsertErr } = await supabase.from('conference_participants').upsert([{
      room_id: room.id,
      user_id: participantId,
      display_name: participantName,
      role: 'participant',
      status: 'joined',
      joined_at: new Date().toISOString(),
      is_muted: isMuted,
      is_video_off: isVideoOff,
      peer_id: peerId,
    }], { onConflict: 'room_id,user_id' });
    if (upsertErr) { setStep('form'); setError('خطا در ورود به اتاق: ' + upsertErr.message); setLoading(false); return; }

    setLocalStream(stream);
    setStep('in-room');
  }, [room, acquireStream, isMuted, isVideoOff, authUserId, guestId, displayName]);

  // fix 4: auto-join only when step === 'form' to allow re-join after leaving
  const autoJoinedRef = useRef(false);
  useEffect(() => {
    if (step !== 'form') return;
    if (!authUserId || !authUserName || !room || !joinAllowed || autoJoinedRef.current) return;
    autoJoinedRef.current = true;
    setStep('auth-joining');
    doEnterRoom(authUserName);
  }, [step, authUserId, authUserName, room, joinAllowed, doEnterRoom]);

  // fix 8: join with 2s cooldown
  const handleJoin = async () => {
    const now = Date.now();
    if (now - lastJoinAttemptRef.current < 2000) return;
    lastJoinAttemptRef.current = now;

    if (!displayName.trim()) { setError('لطفاً نام خود را وارد کنید'); return; }
    if (!room) { setError('اتاق یافت نشد'); return; }
    if (!joinAllowed) {
      setError(`جلسه هنوز شروع نشده است. ورود ${meetingStartsIn !== null ? `${meetingStartsIn} دقیقه دیگر` : 'تا ۱۰ دقیقه قبل از شروع'} فعال می‌شود`);
      return;
    }
    if (room.password && room.password !== password) { setError('رمز عبور اشتباه است'); return; }
    if (room.is_locked) { setError('این اتاق قفل شده است'); return; }

    setLoading(true);
    setError('');

    if (room.waiting_room_enabled) {
      const { data: req } = await supabase.from('conference_waiting_room').insert([{
        room_id: room.id, user_id: guestId, display_name: displayName,
      }]).select().single();
      if (req) {
        setWaitingRequestId(req.id);
        setStep('waiting');
      }
      setLoading(false);
      return;
    }

    await doEnterRoom();
    setLoading(false);
  };

  // fix 1: delete participant record on leave
  const handleLeave = async () => {
    // fix 1: remove participant from DB
    if (room && myPeerId) {
      await supabase.from('conference_participants')
        .delete().eq('room_id', room.id).eq('peer_id', myPeerId);
    }

    // Stop all active streams
    localStream?.getTracks().forEach(t => t.stop());
    previewStream?.getTracks().forEach(t => t.stop());

    // Reset room-join state so they can re-enter
    setStep('form');
    setLocalStream(null);
    setMyPeerId('');
    setPreviewStream(null);
    autoJoinedRef.current = false; // fix 4: allow re-join after leaving

    // Re-fetch the room (it may still be active if only participant left)
    if (room) {
      const { data: freshRoom } = await supabase
        .from('conference_rooms')
        .select('*')
        .eq('id', room.id)
        .neq('status', 'ended')
        .maybeSingle();

      if (!freshRoom) {
        window.location.href = window.location.origin;
        return;
      }
      setRoom(freshRoom as ConferenceRoom);
    }

    // Restart camera/mic preview
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then(s => { setPreviewStream(s); setIsVideoOff(false); })
      .catch(() => {
        navigator.mediaDevices.getUserMedia({ audio: true })
          .then(s => { setPreviewStream(s); setIsVideoOff(true); })
          .catch(() => { setIsVideoOff(true); });
      });
  };

  // ── Auth user loading ────────────────────────────────────────────────────
  if (step === 'auth-joining') {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4" dir="rtl">
        <div className="flex flex-col items-center gap-5 text-center">
          <Loader2 className="w-10 h-10 animate-spin text-teal-500" />
          <p className="text-white font-medium">در حال ورود به جلسه...</p>
          {authUserName && <p className="text-gray-400 text-sm">{authUserName}</p>}
          <button
            onClick={() => { autoJoinedRef.current = false; setStep('form'); }}
            className="mt-2 px-5 py-2 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition-colors"
          >
            انصراف
          </button>
        </div>
      </div>
    );
  }

  // ── In room ──────────────────────────────────────────────────────────────
  if (step === 'in-room' && room && localStream) {
    const activeUserId = authUserId || guestId;
    const activeUserName = authUserName || displayName;
    return (
      <div className="h-screen">
        <ConferenceRoomView
          room={room}
          currentUserId={activeUserId}
          currentUserName={activeUserName}
          myPeerId={myPeerId}
          localStream={localStream}
          onLeave={handleLeave}
        />
      </div>
    );
  }

  // ── Waiting room ─────────────────────────────────────────────────────────
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
          <button onClick={() => setStep('form')}
            className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 text-white rounded-xl text-sm transition-colors">
            انصراف
          </button>
        </div>
      </div>
    );
  }

  // ── Join form ────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4" dir="rtl">
      <div className="w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2 mb-3">
            <Video className="w-7 h-7 text-teal-500" />
            <span className="text-2xl font-bold text-white">ورود به جلسه</span>
          </div>
          {/* fix 7: show loading/error state for room */}
          {roomLoading ? (
            <div className="flex items-center justify-center gap-2 text-gray-400 text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-teal-500" />
              در حال بارگذاری اتاق...
            </div>
          ) : room ? (
            <div className="bg-gray-800 rounded-xl px-4 py-2 inline-block">
              <p className="text-teal-400 font-medium">{room.name || 'جلسه ویدیویی'}</p>
              <div className="flex items-center justify-center gap-2 mt-1">
                {room.is_locked && <span className="flex items-center gap-1 text-xs text-amber-400"><Lock className="w-3 h-3" /> قفل شده</span>}
                {room.waiting_room_enabled && <span className="flex items-center gap-1 text-xs text-blue-400"><Shield className="w-3 h-3" /> اتاق انتظار</span>}
              </div>
            </div>
          ) : null}
        </div>

        {/* Camera preview */}
        <div className="relative bg-gray-900 rounded-2xl overflow-hidden aspect-video w-full shadow-xl">
          {!isVideoOff && previewStream ? (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover scale-x-[-1]" />
              {/* fix 9: Safari autoplay fallback button */}
              {showPlayButton && (
                <button
                  onClick={() => { videoRef.current?.play().catch(() => {}); setShowPlayButton(false); }}
                  className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 text-white gap-2 text-sm"
                >
                  <Video className="w-8 h-8" />
                  کلیک برای پخش تصویر
                </button>
              )}
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950">
              <div className="w-16 h-16 rounded-full bg-gray-700 flex items-center justify-center">
                {displayName ? (
                  <span className="text-2xl font-bold text-white">{displayName[0].toUpperCase()}</span>
                ) : (
                  <VideoOff className="w-7 h-7 text-gray-500" />
                )}
              </div>
            </div>
          )}
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-2">
            {/* fix 6: aria-label + aria-pressed on mic button */}
            <button
              onClick={() => { const n = !isMuted; previewStream?.getAudioTracks().forEach(t => { t.enabled = !n; }); setIsMuted(n); }}
              aria-label={isMuted ? 'فعال کردن میکروفون' : 'قطع میکروفون'}
              aria-pressed={isMuted}
              className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all ${isMuted ? 'bg-red-600' : 'bg-gray-700/90 hover:bg-gray-600'}`}>
              {isMuted ? <MicOff className="w-4 h-4 text-white" /> : <Mic className="w-4 h-4 text-white" />}
            </button>
            {/* fix 6: aria-label + aria-pressed on video button */}
            <button
              onClick={() => { const n = !isVideoOff; previewStream?.getVideoTracks().forEach(t => { t.enabled = !n; }); setIsVideoOff(n); }}
              aria-label={isVideoOff ? 'فعال کردن دوربین' : 'قطع دوربین'}
              aria-pressed={isVideoOff}
              className={`w-10 h-10 rounded-full flex items-center justify-center shadow-lg transition-all ${isVideoOff ? 'bg-red-600' : 'bg-gray-700/90 hover:bg-gray-600'}`}>
              {isVideoOff ? <VideoOff className="w-4 h-4 text-white" /> : <Video className="w-4 h-4 text-white" />}
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5 space-y-4">
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

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-900/30 border border-red-700/50 rounded-xl text-red-300 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">نام شما</label>
            {authUserId ? (
              <div className="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-xl text-gray-200 text-sm flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-teal-600 flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {(authUserName || '?')[0].toUpperCase()}
                </span>
                {authUserName}
                <span className="mr-auto text-xs text-teal-400 bg-teal-900/30 px-2 py-0.5 rounded-full">کاربر سامانه</span>
              </div>
            ) : (
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleJoin()}
                placeholder="نام و نام خانوادگی"
                autoFocus
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
              />
            )}
          </div>

          {room?.password && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">رمز عبور جلسه</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="رمز عبور"
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
              />
            </div>
          )}

          <button
            onClick={handleJoin}
            disabled={loading || !room || !displayName.trim() || !joinAllowed}
            className="w-full py-3 bg-teal-500 hover:bg-teal-600 text-white rounded-xl font-semibold text-base transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg"
          >
            {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <LogIn className="w-5 h-5" />}
            {!joinAllowed ? 'جلسه هنوز شروع نشده' : room?.waiting_room_enabled ? 'درخواست ورود' : 'ورود به جلسه'}
          </button>

          <p className="text-center text-xs text-gray-500">
            ورود به عنوان مهمان — نیاز به ثبت‌نام ندارد
          </p>
        </div>
      </div>
    </div>
  );
}
