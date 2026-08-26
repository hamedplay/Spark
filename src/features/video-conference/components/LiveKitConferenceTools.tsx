import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Circle, Hand, Lock, MessageCircle, MicOff, MoreVertical, Radio, Settings2, Square, Unlock, UserMinus, Users, Video } from 'lucide-react';
import { useConferenceClient } from '../../../components/VideoConference/conferenceClient';
import { runHostAction, setRaiseHand, setRecording, type ConferenceRole, type HostAction } from '../services/conferenceApi';

type RoomLike = any;
type Panel = 'chat' | 'participants' | 'devices' | null;

interface ConferenceMessageRow {
  id: string;
  user_id: string;
  display_name: string;
  body: string;
  created_at: string | null;
  is_deleted: boolean;
}

interface ParticipantRow {
  user_id: string;
  display_name: string;
  role: string;
  is_muted: boolean;
  is_hand_raised: boolean;
  hand_raised_at: string | null;
  status: string;
}

interface RecordingRow {
  id: string;
  status: string;
  created_at: string;
}

interface MediaDeviceOption {
  deviceId: string;
  label: string;
}

export function LiveKitConferenceTools({
  room,
  roomId,
  currentUserId,
  currentUserName,
  role,
  onEnded,
}: {
  room: RoomLike;
  roomId: string;
  currentUserId: string;
  currentUserName: string;
  role: ConferenceRole;
  onEnded: () => void;
}) {
  const conferenceClient = useConferenceClient();
  const [panel, setPanel] = useState<Panel>(null);
  const [messages, setMessages] = useState<ConferenceMessageRow[]>([]);
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [message, setMessage] = useState('');
  const [raised, setRaised] = useState(false);
  const [locked, setLocked] = useState(false);
  const [recording, setRecordingState] = useState<RecordingRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceOption[]>([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');

  const isManager = role === 'host' || role === 'admin' || role === 'moderator';

  const refreshParticipants = useCallback(async () => {
    const { data, error } = await conferenceClient.from('conference_participants')
      .select('user_id,display_name,role,is_muted,is_hand_raised,hand_raised_at,status')
      .eq('room_id', roomId)
      .eq('status', 'joined')
      .order('hand_raised_at', { ascending: true, nullsFirst: false });
    if (!error) {
      const rows = (data || []) as ParticipantRow[];
      setParticipants(rows);
      setRaised(Boolean(rows.find((row) => row.user_id === currentUserId)?.is_hand_raised));
    }
  }, [currentUserId, roomId]);

  const refreshMessages = useCallback(async () => {
    const { data, error } = await conferenceClient.from('conference_messages')
      .select('id,user_id,display_name,body,created_at,is_deleted')
      .eq('room_id', roomId)
      .order('created_at', { ascending: true })
      .limit(200);
    if (!error) setMessages((data || []) as ConferenceMessageRow[]);
  }, [roomId]);

  const refreshRoomState = useCallback(async () => {
    const { data } = await conferenceClient.from('conference_rooms').select('is_locked').eq('id', roomId).maybeSingle();
    if (data) setLocked(Boolean(data.is_locked));
    const { data: recordingRows } = await conferenceClient.from('conference_recordings')
      .select('id,status,created_at').eq('room_id', roomId)
      .in('status', ['queued', 'recording', 'processing'])
      .order('created_at', { ascending: false }).limit(1);
    setRecordingState((recordingRows?.[0] as RecordingRow | undefined) || null);
  }, [roomId]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const map = (kind: MediaDeviceKind) => devices.filter((d) => d.kind === kind).map((d, index) => ({
      deviceId: d.deviceId,
      label: d.label || `${kind === 'audioinput' ? 'میکروفون' : kind === 'videoinput' ? 'دوربین' : 'خروجی صدا'} ${index + 1}`,
    }));
    setAudioInputs(map('audioinput'));
    setVideoInputs(map('videoinput'));
    setAudioOutputs(map('audiooutput'));
  }, []);

  useEffect(() => {
    void refreshParticipants();
    void refreshMessages();
    void refreshRoomState();
    void refreshDevices();

    const channel = conferenceClient.channel(`sfu-collab-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_messages', filter: `room_id=eq.${roomId}` }, () => void refreshMessages())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_participants', filter: `room_id=eq.${roomId}` }, () => void refreshParticipants())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conference_rooms', filter: `id=eq.${roomId}` }, () => void refreshRoomState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_recordings', filter: `room_id=eq.${roomId}` }, () => void refreshRoomState())
      .subscribe();

    const onDeviceChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => {
      void conferenceClient.removeChannel(channel);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
    };
  }, [refreshDevices, refreshMessages, refreshParticipants, refreshRoomState, roomId]);

  const raisedParticipants = useMemo(
    () => participants.filter((p) => p.is_hand_raised).sort((a, b) => String(a.hand_raised_at).localeCompare(String(b.hand_raised_at))),
    [participants],
  );

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault();
    const body = message.trim();
    if (!body || body.length > 4000) return;
    setMessage('');
    const { error } = await conferenceClient.from('conference_messages').insert({
      room_id: roomId,
      user_id: currentUserId,
      display_name: currentUserName.slice(0, 60),
      body,
      role: role === 'admin' || role === 'moderator' ? role : 'user',
    });
    if (error) {
      console.error('[VideoConference] chat send failed', error);
      setMessage(body);
    }
  };

  const toggleRaise = async () => {
    const next = !raised;
    setBusy('raise');
    try {
      await setRaiseHand(roomId, next, conferenceClient);
      setRaised(next);
    } catch (error) {
      console.error('[VideoConference] raise hand failed', error);
    } finally {
      setBusy(null);
    }
  };

  const hostAction = async (action: HostAction, targetUserId?: string) => {
    setBusy(`${action}:${targetUserId || ''}`);
    try {
      await runHostAction(roomId, action, targetUserId, conferenceClient);
      if (action === 'lock') setLocked(true);
      if (action === 'unlock') setLocked(false);
      if (action === 'end') onEnded();
      await refreshParticipants();
      await refreshRoomState();
    } catch (error) {
      console.error('[VideoConference] host action failed', { action, error });
    } finally {
      setBusy(null);
    }
  };

  const toggleRecording = async () => {
    setBusy('recording');
    try {
      await setRecording(roomId, recording ? 'stop' : 'start', conferenceClient);
      await refreshRoomState();
    } catch (error) {
      console.error('[VideoConference] recording action failed', error);
    } finally {
      setBusy(null);
    }
  };

  const switchDevice = async (kind: MediaDeviceKind, deviceId: string) => {
    if (!deviceId) return;
    setBusy(`device:${kind}`);
    try {
      await room.switchActiveDevice(kind, deviceId, true);
      if (kind === 'audioinput') setSelectedMic(deviceId);
      if (kind === 'videoinput') setSelectedCamera(deviceId);
      if (kind === 'audiooutput') setSelectedSpeaker(deviceId);
    } catch (error) {
      console.error('[VideoConference] device switch failed', { kind, error });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {recording && (
        <div className="absolute left-3 top-[68px] z-30 flex items-center gap-2 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg" aria-live="polite">
          <Circle className="h-3 w-3 fill-current" /> ضبط جلسه
        </div>
      )}

      <div className="absolute bottom-[88px] left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-slate-900/90 p-1.5 shadow-xl backdrop-blur" dir="rtl">
        <button onClick={() => setPanel(panel === 'chat' ? null : 'chat')} className="relative flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10" aria-label="گفتگوی جلسه">
          <MessageCircle className="h-5 w-5" />
          {messages.length > 0 && <span className="absolute -left-1 -top-1 min-w-4 rounded-full bg-violet-500 px-1 text-[9px]">{messages.length > 99 ? '99+' : messages.length}</span>}
        </button>
        <button onClick={() => void toggleRaise()} disabled={busy === 'raise'} className={`flex h-11 w-11 items-center justify-center rounded-xl ${raised ? 'bg-amber-500 text-slate-950' : 'hover:bg-white/10'}`} aria-label={raised ? 'پایین آوردن دست' : 'بالا بردن دست'}><Hand className="h-5 w-5" /></button>
        <button onClick={() => setPanel(panel === 'participants' ? null : 'participants')} className="relative flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10" aria-label="شرکت‌کنندگان"><Users className="h-5 w-5" />{raisedParticipants.length > 0 && <span className="absolute -left-1 -top-1 rounded-full bg-amber-500 px-1.5 text-[9px] font-bold text-slate-950">{raisedParticipants.length}</span>}</button>
        <button onClick={() => setPanel(panel === 'devices' ? null : 'devices')} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10" aria-label="انتخاب دستگاه"><Settings2 className="h-5 w-5" /></button>
        {isManager && <button onClick={() => void toggleRecording()} disabled={busy === 'recording'} className={`flex h-11 w-11 items-center justify-center rounded-xl ${recording ? 'bg-rose-600' : 'hover:bg-white/10'}`} aria-label={recording ? 'توقف ضبط' : 'شروع ضبط'}>{recording ? <Square className="h-4 w-4 fill-current" /> : <Radio className="h-5 w-5" />}</button>}
        {isManager && <button onClick={() => void hostAction(locked ? 'unlock' : 'lock')} className="flex h-11 w-11 items-center justify-center rounded-xl hover:bg-white/10" aria-label={locked ? 'باز کردن قفل جلسه' : 'قفل جلسه'}>{locked ? <Unlock className="h-5 w-5" /> : <Lock className="h-5 w-5" />}</button>}
        {role === 'host' && <button onClick={() => void hostAction('end')} className="flex h-11 items-center justify-center rounded-xl bg-rose-700 px-3 text-xs font-bold" aria-label="پایان جلسه برای همه">پایان برای همه</button>}
      </div>

      {panel && (
        <aside className="absolute inset-x-2 bottom-[146px] z-40 max-h-[55dvh] overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:left-4 sm:w-[380px]" dir="rtl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <strong className="text-sm">{panel === 'chat' ? 'گفتگوی جلسه' : panel === 'participants' ? 'شرکت‌کنندگان' : 'دستگاه‌های رسانه‌ای'}</strong>
            <button onClick={() => setPanel(null)} className="h-9 rounded-lg px-3 text-xs text-slate-300 hover:bg-white/10">بستن</button>
          </div>

          {panel === 'chat' && (
            <div className="flex max-h-[48dvh] flex-col">
              <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                {messages.length === 0 && <p className="py-8 text-center text-xs text-slate-400">هنوز پیامی ارسال نشده است.</p>}
                {messages.map((item) => <div key={item.id} className={`rounded-xl px-3 py-2 text-sm ${item.user_id === currentUserId ? 'mr-8 bg-violet-600/40' : 'ml-8 bg-slate-800'}`}><div className="mb-1 text-[10px] font-bold text-slate-300">{item.display_name || 'کاربر'}</div><p className="break-words leading-6">{item.is_deleted ? 'پیام حذف شده است' : item.body}</p><time className="mt-1 block text-[9px] text-slate-400">{item.created_at ? new Date(item.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : ''}</time></div>)}
              </div>
              <form onSubmit={(e) => void sendMessage(e)} className="flex gap-2 border-t border-white/10 p-3"><input value={message} onChange={(e) => setMessage(e.target.value)} maxLength={4000} placeholder="پیام…" className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm outline-none focus:border-violet-500" /><button type="submit" className="min-h-11 rounded-xl bg-violet-600 px-4 text-xs font-bold">ارسال</button></form>
            </div>
          )}

          {panel === 'participants' && (
            <div className="max-h-[48dvh] overflow-y-auto p-2">
              {participants.map((participant) => <div key={participant.user_id} className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 hover:bg-white/5"><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate text-sm font-semibold">{participant.display_name || 'شرکت‌کننده'}</span>{participant.is_hand_raised && <Hand className="h-4 w-4 text-amber-400" />}{participant.is_muted && <MicOff className="h-4 w-4 text-slate-400" />}</div><span className="text-[10px] text-slate-400">{participant.role === 'host' ? 'میزبان' : participant.role === 'admin' ? 'هم‌میزبان' : participant.role === 'moderator' ? 'مدیر جلسه' : 'شرکت‌کننده'}</span></div>{isManager && participant.user_id !== currentUserId && <div className="flex shrink-0 items-center gap-1"><button onClick={() => void hostAction('mute', participant.user_id)} className="h-9 rounded-lg bg-slate-800 px-2 text-[10px]">قطع صدا</button>{participant.is_hand_raised && <button onClick={() => void hostAction('lower-hand', participant.user_id)} className="h-9 rounded-lg bg-slate-800 px-2 text-[10px]">پایین دست</button>}<button onClick={() => void hostAction(participant.role === 'admin' ? 'demote' : 'promote', participant.user_id)} className="h-9 rounded-lg bg-slate-800 px-2 text-[10px]">{participant.role === 'admin' ? 'عادی' : 'هم‌میزبان'}</button><button onClick={() => void hostAction('remove', participant.user_id)} className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-700" aria-label="حذف شرکت‌کننده"><UserMinus className="h-4 w-4" /></button></div>}</div>)}
            </div>
          )}

          {panel === 'devices' && (
            <div className="space-y-3 p-4 text-xs">
              <label className="block"><span className="mb-1.5 flex items-center gap-2 font-bold"><MicOff className="h-4 w-4" /> میکروفون</span><select value={selectedMic} onChange={(e) => void switchDevice('audioinput', e.target.value)} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3"><option value="">انتخاب…</option>{audioInputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
              <label className="block"><span className="mb-1.5 flex items-center gap-2 font-bold"><Video className="h-4 w-4" /> دوربین</span><select value={selectedCamera} onChange={(e) => void switchDevice('videoinput', e.target.value)} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3"><option value="">انتخاب…</option>{videoInputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>
              {audioOutputs.length > 0 && <label className="block"><span className="mb-1.5 flex items-center gap-2 font-bold"><MoreVertical className="h-4 w-4" /> خروجی صدا</span><select value={selectedSpeaker} onChange={(e) => void switchDevice('audiooutput', e.target.value)} className="min-h-11 w-full rounded-xl border border-white/10 bg-slate-950 px-3"><option value="">انتخاب…</option>{audioOutputs.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label}</option>)}</select></label>}
              <p className="leading-6 text-slate-400">تعویض دستگاه بدون خروج از اتاق انجام می‌شود. انتخاب خروجی صدا فقط در مرورگرهایی نمایش داده می‌شود که آن را پشتیبانی کنند.</p>
            </div>
          )}
        </aside>
      )}
    </>
  );
}
