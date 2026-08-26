import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CameraOff, Loader2, LogOut, Mic, MicOff, MonitorUp, RefreshCw, Users, Wifi, WifiOff } from 'lucide-react';
import { ConnectionQuality, Room, RoomEvent, Track } from 'livekit-client';
import { useConferenceClient } from '../../../components/VideoConference/conferenceClient';
import { requestLiveKitToken, resolveWaitingParticipant, type ConferenceRole } from '../services/conferenceApi';
import { LiveKitParticipantTile } from './LiveKitParticipantTile';
import { LiveKitConferenceTools } from './LiveKitConferenceTools';

interface LegacyRoomShape {
  id: string;
  name: string;
  host_id: string;
  max_participants?: number;
  allow_reactions?: boolean;
  allow_screen_share?: boolean;
}

interface Props {
  room: LegacyRoomShape;
  currentUserId: string;
  currentUserName: string;
  localStream: MediaStream;
  onLeave: () => void;
}

type UiState = 'joining' | 'waiting' | 'connected' | 'reconnecting' | 'failed';

type WaitingRow = {
  id: string;
  user_id: string;
  display_name: string;
  status: string;
  requested_at: string;
};

const ERROR_LABELS: Record<string, string> = {
  ROOM_FULL: 'ظرفیت جلسه تکمیل شده است.',
  ROOM_LOCKED: 'جلسه قفل شده است.',
  NOT_AUTHORIZED: 'اجازه ورود به این جلسه را ندارید.',
  BANNED: 'دسترسی شما به این جلسه مسدود شده است.',
  REJECTED: 'درخواست ورود شما رد شده است.',
  CONFERENCE_NOT_CONFIGURED: 'زیرساخت ویدیوکنفرانس هنوز پیکربندی نشده است.',
  TOKEN_FAILED: 'دریافت مجوز اتصال ناموفق بود.',
};

export function LiveKitConferenceRoom({ room: sparkRoom, currentUserId, currentUserName, localStream, onLeave }: Props) {
  const conferenceClient = useConferenceClient();
  const roomRef = useRef<Room | null>(null);
  const [uiState, setUiState] = useState<UiState>('joining');
  const [errorMessage, setErrorMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [role, setRole] = useState<ConferenceRole>('member');
  const [micEnabled, setMicEnabled] = useState(() => localStream.getAudioTracks().some((track) => track.enabled));
  const [cameraEnabled, setCameraEnabled] = useState(() => localStream.getVideoTracks().some((track) => track.enabled));
  const [screenEnabled, setScreenEnabled] = useState(false);
  const [waitingRows, setWaitingRows] = useState<WaitingRow[]>([]);
  const [quality, setQuality] = useState<ConnectionQuality | 'unknown'>('unknown');
  const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState<string | null>(null);
  const [reaction, setReaction] = useState<string | null>(null);
  const connectingRef = useRef(false);

  const isManager = role === 'host' || role === 'admin' || role === 'moderator';

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setUiState('joining');
    setErrorMessage('');

    try {
      const join = await requestLiveKitToken(sparkRoom.id, conferenceClient);
      if (join.status === 'waiting') {
        setUiState('waiting');
        return;
      }
      if (join.status === 'rejected') {
        setUiState('failed');
        setErrorMessage(ERROR_LABELS[join.reason.toUpperCase()] || 'ورود به جلسه ناموفق بود.');
        return;
      }

      setRole(join.data.role);
      const nextRoom = new Room({
        adaptiveStream: true,
        dynacast: true,
        stopLocalTrackOnUnpublish: true,
      });
      roomRef.current = nextRoom;

      nextRoom.on(RoomEvent.ParticipantConnected, refresh);
      nextRoom.on(RoomEvent.ParticipantDisconnected, refresh);
      nextRoom.on(RoomEvent.TrackSubscribed, refresh);
      nextRoom.on(RoomEvent.TrackUnsubscribed, refresh);
      nextRoom.on(RoomEvent.TrackMuted, refresh);
      nextRoom.on(RoomEvent.TrackUnmuted, refresh);
      nextRoom.on(RoomEvent.Reconnecting, () => setUiState('reconnecting'));
      nextRoom.on(RoomEvent.Reconnected, () => setUiState('connected'));
      nextRoom.on(RoomEvent.Disconnected, () => setUiState((state) => state === 'failed' ? state : 'failed'));
      nextRoom.on(RoomEvent.ActiveSpeakersChanged, (participants) => {
        setActiveSpeakerIdentity(participants[0]?.identity ?? null);
      });
      nextRoom.on(RoomEvent.ConnectionQualityChanged, (nextQuality, participant) => {
        if (participant.identity === nextRoom.localParticipant.identity) setQuality(nextQuality);
      });
      nextRoom.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        if (topic !== 'spark-reaction') return;
        try {
          const value = JSON.parse(new TextDecoder().decode(payload));
          if (typeof value?.emoji === 'string') {
            setReaction(value.emoji);
            window.setTimeout(() => setReaction(null), 2500);
          }
        } catch { /* malformed ephemeral data is ignored */ }
      });

      const audioSettings = localStream.getAudioTracks()[0]?.getSettings();
      const videoSettings = localStream.getVideoTracks()[0]?.getSettings();
      localStream.getTracks().forEach((track) => track.stop());

      await nextRoom.connect(join.data.serverUrl, join.data.token, { autoSubscribe: true });
      nextRoom.localParticipant.setName(currentUserName);

      if (micEnabled) {
        await nextRoom.localParticipant.setMicrophoneEnabled(true, audioSettings?.deviceId ? { deviceId: audioSettings.deviceId } as any : undefined);
      }
      if (cameraEnabled) {
        await nextRoom.localParticipant.setCameraEnabled(
          true,
          videoSettings?.deviceId ? { deviceId: videoSettings.deviceId, resolution: { width: 1920, height: 1080, frameRate: 30 } } as any : undefined,
          { simulcast: true } as any,
        );
      }
      setUiState('connected');
      refresh();
    } catch (error) {
      console.error('[VideoConference][LiveKit] connect failed', error);
      setUiState('failed');
      setErrorMessage('اتصال رسانه‌ای برقرار نشد. تنظیمات LiveKit/TURN و شبکه را بررسی کنید.');
    } finally {
      connectingRef.current = false;
    }
  }, [cameraEnabled, currentUserName, localStream, micEnabled, refresh, sparkRoom.id]);

  useEffect(() => {
    void connect();
    return () => {
      const current = roomRef.current;
      roomRef.current = null;
      current?.removeAllListeners();
      current?.disconnect();
      localStream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (uiState !== 'waiting') return;
    const channel = conferenceClient.channel(`sfu-wait-${sparkRoom.id}-${currentUserId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'conference_waiting_room', filter: `room_id=eq.${sparkRoom.id}`,
      }, (payload) => {
        const row = payload.new as { user_id?: string; status?: string };
        if (row.user_id !== currentUserId) return;
        if (row.status === 'admitted') void connect();
        if (row.status === 'rejected') {
          setUiState('failed');
          setErrorMessage('درخواست ورود شما توسط میزبان رد شد.');
        }
      })
      .subscribe();
    return () => { void conferenceClient.removeChannel(channel); };
  }, [connect, currentUserId, sparkRoom.id, uiState]);

  useEffect(() => {
    if (!isManager || uiState !== 'connected') return;
    const load = async () => {
      const { data } = await conferenceClient.from('conference_waiting_room')
        .select('id,user_id,display_name,status,requested_at')
        .eq('room_id', sparkRoom.id)
        .eq('status', 'waiting')
        .order('requested_at', { ascending: true });
      setWaitingRows((data || []) as WaitingRow[]);
    };
    void load();
    const channel = conferenceClient.channel(`sfu-host-wait-${sparkRoom.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_waiting_room', filter: `room_id=eq.${sparkRoom.id}` }, load)
      .subscribe();
    return () => { void conferenceClient.removeChannel(channel); };
  }, [isManager, sparkRoom.id, uiState]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && roomRef.current && uiState === 'reconnecting') refresh();
    };
    const handleOnline = () => { if (uiState === 'failed' && !roomRef.current) void connect(); };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [connect, refresh, uiState]);

  const participantList = useMemo(() => {
    void revision;
    const current = roomRef.current;
    if (!current) return [];
    return [current.localParticipant, ...Array.from(current.remoteParticipants.values())];
  }, [revision]);

  const screenSharer = useMemo(() => participantList.find((participant: any) => {
    const publication = participant.getTrackPublication?.(Track.Source.ScreenShare);
    return publication?.track && !publication.isMuted;
  }), [participantList]);

  const toggleMic = async () => {
    const current = roomRef.current;
    if (!current) return;
    const next = !micEnabled;
    try {
      await current.localParticipant.setMicrophoneEnabled(next);
      setMicEnabled(next);
    } catch (error) { console.error('[VideoConference] microphone toggle failed', error); }
  };

  const toggleCamera = async () => {
    const current = roomRef.current;
    if (!current) return;
    const next = !cameraEnabled;
    try {
      await current.localParticipant.setCameraEnabled(next, undefined, next ? { simulcast: true } as any : undefined);
      setCameraEnabled(next);
    } catch (error) { console.error('[VideoConference] camera toggle failed', error); }
  };

  const toggleScreen = async () => {
    const current = roomRef.current;
    if (!current || !navigator.mediaDevices?.getDisplayMedia) return;
    const next = !screenEnabled;
    try {
      await current.localParticipant.setScreenShareEnabled(next);
      setScreenEnabled(next);
    } catch (error) { console.error('[VideoConference] screen share failed', error); }
  };

  const sendReaction = async (emoji: string) => {
    const current = roomRef.current;
    if (!current) return;
    try {
      await current.localParticipant.publishData(new TextEncoder().encode(JSON.stringify({ emoji, at: Date.now() })), {
        reliable: false,
        topic: 'spark-reaction',
      });
      setReaction(emoji);
      window.setTimeout(() => setReaction(null), 2500);
    } catch (error) { console.error('[VideoConference] reaction send failed', error); }
  };

  const leave = async () => {
    const current = roomRef.current;
    roomRef.current = null;
    current?.removeAllListeners();
    current?.disconnect();
    try { await conferenceClient.rpc('leave_conference_room', { p_room_id: sparkRoom.id }); } catch { /* UI leave still proceeds */ }
    onLeave();
  };

  if (uiState === 'joining') {
    return <div className="flex min-h-[70dvh] items-center justify-center gap-3 bg-slate-950 text-white" dir="rtl"><Loader2 className="h-6 w-6 animate-spin" /> در حال اتصال امن به جلسه…</div>;
  }

  if (uiState === 'waiting') {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 bg-slate-950 px-5 text-center text-white" dir="rtl">
        <Users className="h-12 w-12 text-amber-300" />
        <h2 className="text-lg font-bold">در انتظار تأیید میزبان</h2>
        <p className="max-w-md text-sm leading-7 text-slate-300">تا زمانی که میزبان شما را بپذیرد هیچ توکن رسانه‌ای صادر نمی‌شود و وارد اتاق LiveKit نخواهید شد.</p>
        <button onClick={onLeave} className="min-h-11 rounded-xl border border-slate-600 px-5 text-sm">انصراف</button>
      </div>
    );
  }

  if (uiState === 'failed') {
    return (
      <div className="flex min-h-[70dvh] flex-col items-center justify-center gap-4 bg-slate-950 px-5 text-center text-white" dir="rtl">
        <WifiOff className="h-12 w-12 text-rose-400" />
        <h2 className="text-lg font-bold">اتصال ویدیوکنفرانس برقرار نشد</h2>
        <p className="max-w-lg text-sm leading-7 text-slate-300">{errorMessage}</p>
        <div className="flex gap-2"><button onClick={() => void connect()} className="min-h-11 rounded-xl bg-violet-600 px-5 text-sm font-bold"><RefreshCw className="ml-2 inline h-4 w-4" />تلاش مجدد</button><button onClick={onLeave} className="min-h-11 rounded-xl border border-slate-600 px-5 text-sm">بازگشت</button></div>
      </div>
    );
  }

  const visibleParticipants = screenSharer ? [screenSharer] : participantList.slice(0, window.innerWidth < 768 ? 4 : 20);

  return (
    <div className="relative flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-slate-950 text-white" dir="rtl" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-3 sm:px-5">
        <div className="min-w-0"><h1 className="truncate text-sm font-bold sm:text-base">{sparkRoom.name}</h1><div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400"><Wifi className="h-3.5 w-3.5" />{uiState === 'reconnecting' ? 'در حال اتصال مجدد' : quality === ConnectionQuality.Poor ? 'شبکه ضعیف' : 'متصل'} · {participantList.length}/{sparkRoom.max_participants ?? 20}</div></div>
        {waitingRows.length > 0 && <span className="rounded-full bg-amber-400 px-2 py-1 text-xs font-bold text-slate-950">{waitingRows.length} در انتظار</span>}
      </header>

      {waitingRows.length > 0 && isManager && (
        <div className="max-h-40 overflow-y-auto border-b border-white/10 bg-slate-900/95 p-2">
          {waitingRows.map((row) => <div key={row.id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm"><span className="truncate">{row.display_name || 'شرکت‌کننده'}</span><div className="flex gap-2"><button onClick={() => void resolveWaitingParticipant(sparkRoom.id, row.user_id, true)} className="min-h-10 rounded-lg bg-emerald-600 px-3">پذیرش</button><button onClick={() => void resolveWaitingParticipant(sparkRoom.id, row.user_id, false)} className="min-h-10 rounded-lg bg-rose-600 px-3">رد</button></div></div>)}
        </div>
      )}

      <main className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4">
        <div className={`mx-auto grid h-full max-w-[1600px] gap-2 sm:gap-3 ${visibleParticipants.length <= 1 ? 'grid-cols-1' : visibleParticipants.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'}`}>
          {visibleParticipants.map((participant: any) => <LiveKitParticipantTile key={participant.identity} participant={participant} local={participant.identity === roomRef.current?.localParticipant.identity} active={participant.identity === activeSpeakerIdentity} />)}
        </div>
      </main>

      {reaction && <div className="pointer-events-none absolute inset-x-0 top-24 text-center text-6xl" aria-live="polite">{reaction}</div>}

      {roomRef.current && (
        <LiveKitConferenceTools
          room={roomRef.current}
          roomId={sparkRoom.id}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          role={role}
          onEnded={() => void leave()}
        />
      )}

      <footer className="flex min-h-[76px] items-center justify-center gap-2 border-t border-white/10 bg-slate-900/95 px-2 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:gap-3">
        <button aria-label={micEnabled ? 'قطع میکروفون' : 'فعال کردن میکروفون'} onClick={() => void toggleMic()} className={`flex h-12 w-12 items-center justify-center rounded-full ${micEnabled ? 'bg-slate-700' : 'bg-rose-600'}`}>{micEnabled ? <Mic /> : <MicOff />}</button>
        <button aria-label={cameraEnabled ? 'خاموش کردن دوربین' : 'فعال کردن دوربین'} onClick={() => void toggleCamera()} className={`flex h-12 w-12 items-center justify-center rounded-full ${cameraEnabled ? 'bg-slate-700' : 'bg-rose-600'}`}>{cameraEnabled ? <Camera /> : <CameraOff />}</button>
        {sparkRoom.allow_screen_share !== false && navigator.mediaDevices?.getDisplayMedia && <button aria-label="اشتراک صفحه" onClick={() => void toggleScreen()} className={`hidden h-12 w-12 items-center justify-center rounded-full sm:flex ${screenEnabled ? 'bg-violet-600' : 'bg-slate-700'}`}><MonitorUp /></button>}
        {sparkRoom.allow_reactions !== false && <button aria-label="واکنش تشویق" onClick={() => void sendReaction('👏')} className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-700 text-xl">👏</button>}
        <button aria-label="خروج از جلسه" onClick={() => void leave()} className="flex h-12 min-w-12 items-center justify-center rounded-full bg-rose-600 px-3"><LogOut /></button>
      </footer>
    </div>
  );
}
