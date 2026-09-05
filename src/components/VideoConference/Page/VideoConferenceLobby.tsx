import {
  AlertTriangle,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  CircleDot,
  Clock,
  Crown,
  Gauge,
  Hash,
  LogIn,
  MessageSquare,
  MonitorUp,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import toast from 'react-hot-toast';
import type { ConferenceRoom } from '../types';
import { RoomCard } from './RoomCard';

export type VideoConferenceRuntimeConfig = {
  ok: boolean;
  media_topology: 'mesh' | 'sfu';
  max_participants: number;
  configured_max_participants: number;
  mesh_max_participants: number;
  room_default_ttl_hours: number;
  recording_enabled: boolean;
  default_waiting_room: boolean;
  default_allow_chat: boolean;
  default_allow_reactions: boolean;
  default_allow_screen_share: boolean;
};

type LobbyRoom = ConferenceRoom & { participant_count?: number; meeting?: any };

type Props = {
  config: VideoConferenceRuntimeConfig | null;
  configLoading: boolean;
  configError: string | null;
  rooms: LobbyRoom[];
  loading: boolean;
  currentUserId: string;
  joiningRoomId: string | null;
  joinCode: string;
  joining: boolean;
  showCreate: boolean;
  createName: string;
  creating: boolean;
  requireApproval: boolean;
  isMuted: boolean;
  isVideoOff: boolean;
  onRefresh: () => void;
  onJoinCodeChange: (value: string) => void;
  onJoinByCode: () => void;
  onOpenCreate: () => void;
  onCloseCreate: () => void;
  onCreateNameChange: (value: string) => void;
  onRequireApprovalChange: (value: boolean) => void;
  onCreate: (event: FormEvent) => void;
  onToggleMuted: () => void;
  onToggleVideo: () => void;
  onJoinRoom: (room: LobbyRoom) => void;
  onInviteRoom: (room: LobbyRoom) => void;
};

function FeaturePill({ enabled, icon, label }: { enabled: boolean; icon: ReactNode; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[11px] font-bold ${enabled
      ? 'border-blue-100 bg-blue-50 text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300'
      : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-500'}`}>
      {icon}{label}
    </span>
  );
}

function roomStatus(room: LobbyRoom) {
  if (room.status === 'active') {
    return {
      label: 'در حال برگزاری',
      className: 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
      dotClassName: 'bg-emerald-500',
    };
  }
  return {
    label: 'آماده ورود',
    className: 'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20',
    dotClassName: 'bg-blue-500',
  };
}

function parseMeetingDate(value?: string | null): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function formatRoomTime(room: LobbyRoom): string {
  const start = room.meeting?.start_time?.slice?.(0, 5);
  const end = room.meeting?.end_time?.slice?.(0, 5);
  const meetingDate = parseMeetingDate(room.meeting?.request_date);
  let dayLabel = '';

  if (meetingDate) {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (sameLocalDay(meetingDate, now)) dayLabel = 'امروز';
    else if (sameLocalDay(meetingDate, tomorrow)) dayLabel = 'فردا';
    else {
      try {
        dayLabel = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'short', day: 'numeric' }).format(meetingDate);
      } catch {
        dayLabel = meetingDate.toLocaleDateString('fa-IR');
      }
    }
  }

  const timeRange = start && end ? `${start} - ${end}` : start || end || '';
  if (dayLabel || timeRange) return [dayLabel, timeRange].filter(Boolean).join(' · ');

  const createdAt = new Date(room.created_at);
  if (!Number.isNaN(createdAt.getTime())) {
    try {
      return new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(createdAt);
    } catch {
      return createdAt.toLocaleString('fa-IR');
    }
  }
  return 'زمان نامشخص';
}

function normalizeConferenceCode(value: string): string | null {
  const stripped = value.trim().replace(/[-\s]/g, '').toUpperCase();
  if (stripped.length !== 9) return null;
  return stripped.replace(/(.{3})(.{3})(.{3})/, '$1-$2-$3');
}

function openStandaloneConferenceSession(code: string): boolean {
  const normalized = normalizeConferenceCode(code);
  if (!normalized) {
    toast.error('کد اتاق باید ۹ کاراکتر باشد (مثلاً XXX-XXX-XXX)');
    return false;
  }

  const url = new URL(`/conference/${encodeURIComponent(normalized)}`, window.location.origin);
  const target = `spark-conference-${normalized.replace(/[^A-Z0-9]/g, '')}`;
  const sessionWindow = window.open(url.toString(), target);
  if (!sessionWindow) {
    toast.error('مرورگر اجازه باز کردن صفحه مستقل جلسه را نداد. Pop-up را برای Spark مجاز کنید.');
    return false;
  }

  try {
    sessionWindow.opener = null;
    sessionWindow.focus();
  } catch { /* best effort */ }
  return true;
}

export function VideoConferenceLobby({
  config,
  configLoading,
  configError,
  rooms,
  loading,
  currentUserId,
  joiningRoomId,
  joinCode,
  joining,
  showCreate,
  createName,
  creating,
  requireApproval,
  onRefresh,
  onJoinCodeChange,
  onOpenCreate,
  onCloseCreate,
  onCreateNameChange,
  onRequireApprovalChange,
  onCreate,
  onInviteRoom,
}: Props) {
  const [showMyMeetings, setShowMyMeetings] = useState(true);
  const onlineParticipants = rooms.reduce((total, room) => total + (room.participant_count ?? 0), 0);
  const topology = config?.media_topology ?? null;
  const isSfu = topology === 'sfu';
  const topologyTitle = configError ? 'پیکربندی در دسترس نیست' : topology ? (isSfu ? 'LiveKit SFU' : 'WebRTC Mesh') : 'در حال دریافت';
  const capacity = config?.max_participants ?? null;

  const handleJoinByCode = () => {
    if (openStandaloneConferenceSession(joinCode)) onJoinCodeChange('');
  };

  return (
    <div className="space-y-4 pb-4" dir="rtl">
      <section className="relative overflow-hidden rounded-[26px] border border-blue-100/80 bg-[linear-gradient(115deg,#dbeafe_0%,#eef2ff_45%,#ede9fe_100%)] shadow-[0_12px_36px_rgba(37,99,235,0.08)] dark:border-blue-500/15 dark:bg-[linear-gradient(115deg,#0f172a_0%,#111827_45%,#172554_100%)]">
        <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(135deg,rgba(255,255,255,.75)_0,rgba(255,255,255,0)_36%)]" />
        <div className="relative grid min-h-[184px] grid-cols-1 items-center gap-6 px-5 py-5 lg:grid-cols-[280px_minmax(0,1fr)_220px] lg:px-7">
          <div className="hidden lg:flex lg:justify-self-start">
            <div className="relative h-[148px] w-[260px] rounded-[26px] border border-white/80 bg-white/70 p-3 shadow-[0_14px_30px_rgba(37,99,235,0.12)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/70">
              <div className="absolute -right-3 top-4 flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/25"><Video className="h-5 w-5" /></div>
              <div className="absolute -right-3 bottom-4 flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-600/20"><MessageSquare className="h-4 w-4" /></div>
              <div className="grid h-full grid-cols-2 gap-2 rounded-[18px] bg-gradient-to-br from-blue-50 to-violet-50 p-2 dark:from-slate-800 dark:to-slate-800/70">
                {['ع', 'ن', 'م', 'س'].map((label, index) => (
                  <div key={label + index} className="flex items-center justify-center rounded-xl border border-white/90 bg-white text-lg font-black text-blue-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300">{label}</div>
                ))}
              </div>
            </div>
          </div>

          <div className="text-center lg:text-right">
            <h1 className="text-3xl font-black tracking-tight text-slate-950 dark:text-white sm:text-4xl">ویدیو کنفرانس</h1>
            <p className="mt-2 text-sm font-extrabold text-slate-800 dark:text-slate-100 sm:text-base">مرکز برگزاری، پیوستن و مدیریت جلسات آنلاین سازمان شما</p>
            <p className="mx-auto mt-3 max-w-2xl text-xs leading-6 text-slate-500 dark:text-slate-400 lg:mx-0 sm:text-[13px]">
              با اسپارک، ارتباطات سازمانی خود را ساده‌تر، سریع‌تر و مؤثرتر کنید. جلسات مجازی، همکاری تیمی و اشتراک دانش را در یک محیط امن و یکپارچه مدیریت کنید.
            </p>
          </div>

          <div className="hidden h-full items-center justify-center lg:flex">
            <div className="-rotate-6 text-center font-serif text-[21px] font-bold leading-9 text-blue-600/90 dark:text-blue-300">
              با هم،<br />دورترها نزدیک‌ترند...
              <div className="mx-auto mt-1 h-1 w-24 -rotate-3 rounded-full bg-blue-600/70" />
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(310px,0.72fr)]">
        <section className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 sm:p-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)] lg:items-start">
            <div>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"><ShieldCheck className="h-5 w-5" /></div>
                  <div>
                    <h2 className="text-base font-black text-slate-950 dark:text-white">پروفایل رسانه سازمانی</h2>
                    <p className="mt-0.5 text-[10px] text-slate-400">زیرساخت و قابلیت‌های ویدیو کنفرانس سازمان شما</p>
                  </div>
                </div>
                <button type="button" onClick={onRefresh} aria-label="بروزرسانی" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-blue-600 dark:hover:bg-slate-800"><RefreshCw className={`h-4 w-4 ${(loading || configLoading) ? 'animate-spin' : ''}`} /></button>
              </div>
              <p className="mt-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">معماری و ظرفیت جلسات به‌صورت مستقیم از تنظیمات مدیریت سامانه خوانده می‌شود و قابلیت‌های فعال همین‌جا نمایش داده می‌شوند.</p>
            </div>

            <div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-xl bg-blue-50/80 px-3 py-2.5 dark:bg-blue-500/10">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400"><Sparkles className="h-3.5 w-3.5 text-violet-500" /> معماری فعال</div>
                  <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{configLoading ? '—' : topologyTitle}</div>
                </div>
                <div className="rounded-xl bg-sky-50/80 px-3 py-2.5 dark:bg-sky-500/10">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400"><Gauge className="h-3.5 w-3.5 text-blue-500" /> ظرفیت هر اتاق</div>
                  <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{configLoading ? '—' : configError ? 'خطا' : `${capacity ?? '—'} نفر`}</div>
                </div>
                <div className="rounded-xl bg-violet-50/80 px-3 py-2.5 dark:bg-violet-500/10">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400"><Radio className="h-3.5 w-3.5 text-violet-500" /> اتاق‌های فعال</div>
                  <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{loading ? '—' : rooms.length}</div>
                </div>
                <div className="rounded-xl bg-emerald-50/80 px-3 py-2.5 dark:bg-emerald-500/10">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400"><Users className="h-3.5 w-3.5 text-emerald-500" /> حاضر در جلسات</div>
                  <div className="mt-1 text-sm font-black text-slate-950 dark:text-white">{loading ? '—' : onlineParticipants}</div>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-extrabold text-slate-600 dark:text-slate-300">قابلیت‌ها:</span>
                <FeaturePill enabled={Boolean(config?.default_allow_chat)} icon={<MessageSquare className="h-3.5 w-3.5" />} label="چت" />
                <FeaturePill enabled={Boolean(config?.default_allow_screen_share)} icon={<MonitorUp className="h-3.5 w-3.5" />} label="اشتراک صفحه" />
                <FeaturePill enabled={Boolean(config?.default_allow_reactions)} icon={<Sparkles className="h-3.5 w-3.5" />} label="واکنش" />
                <FeaturePill enabled={Boolean(config?.recording_enabled)} icon={<CircleDot className="h-3.5 w-3.5" />} label="ضبط" />
                <FeaturePill enabled={Boolean(config?.default_waiting_room)} icon={<Users className="h-3.5 w-3.5" />} label="اتاق انتظار" />
              </div>
            </div>
          </div>

          {configError && !configLoading && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{configError}</span></div>
          )}
        </section>

        <section className="rounded-[22px] border border-blue-200/80 bg-gradient-to-b from-blue-50/80 to-white p-4 shadow-[0_8px_24px_rgba(37,99,235,0.06)] dark:border-blue-500/20 dark:from-blue-950/20 dark:to-slate-950 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white shadow-lg shadow-blue-600/20"><LogIn className="h-5 w-5" /></div>
            <div>
              <h2 className="text-base font-black text-slate-950 dark:text-white">ورود با کد اتاق</h2>
              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">برای پیوستن به یک جلسه، کد اتاق را وارد کنید.</p>
            </div>
          </div>
          <div className="mt-4 flex items-center rounded-xl border border-slate-200 bg-white px-3 shadow-inner dark:border-slate-700 dark:bg-slate-900">
            <Hash className="h-4 w-4 shrink-0 text-slate-300" />
            <input
              value={joinCode}
              onChange={event => onJoinCodeChange(event.target.value.toUpperCase())}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); handleJoinByCode(); } }}
              placeholder="XXX-XXX-XXX"
              maxLength={11}
              dir="ltr"
              aria-label="کد اتاق"
              className="w-full border-0 bg-transparent px-3 py-3 text-center font-mono text-base font-black tracking-[0.15em] text-slate-900 outline-none placeholder:text-slate-300 dark:text-white dark:placeholder:text-slate-600"
            />
          </div>
          <button type="button" onClick={handleJoinByCode} disabled={joining} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-extrabold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            {joining ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} ورود به جلسه
          </button>
        </section>
      </div>

      <section className="overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950">
        <button type="button" onClick={() => setShowMyMeetings(value => !value)} aria-expanded={showMyMeetings} className="flex w-full items-center justify-between gap-4 px-4 py-3.5 text-right transition hover:bg-slate-50/70 dark:hover:bg-slate-900/60 sm:px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"><CalendarDays className="h-5 w-5" /></div>
            <div>
              <h2 className="text-base font-black text-slate-950 dark:text-white">جلسات آنلاین من</h2>
              <p className="mt-0.5 text-[10px] text-slate-400">جلسات شما در حال برگزاری یا برنامه‌ریزی‌شده</p>
            </div>
          </div>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400">{showMyMeetings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</div>
        </button>

        {showMyMeetings && (
          <div className="border-t border-slate-100 px-3 pb-3 dark:border-slate-800 sm:px-4 sm:pb-4">
            {loading ? (
              <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-slate-400"><RefreshCw className="h-4 w-4 animate-spin" /> در حال دریافت جلسات شما...</div>
            ) : rooms.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-400">در حال حاضر جلسه آنلاینی مرتبط با حساب شما وجود ندارد.</div>
            ) : (
              <div className="overflow-x-auto pt-3">
                <div className="min-w-[900px] overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800">
                  <div className="grid grid-cols-[1.55fr_1fr_.85fr_.8fr_.75fr_.85fr_150px] bg-slate-50 px-3 py-2 text-[10px] font-bold text-slate-400 dark:bg-slate-900/80">
                    <div>موضوع جلسه</div><div>زمان</div><div>وضعیت</div><div>نقش من</div><div>تعداد شرکت‌کنندگان</div><div>کد اتاق</div><div>اقدامات</div>
                  </div>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {rooms.map(room => {
                      const status = roomStatus(room);
                      const isHost = room.host_id === currentUserId;
                      return (
                        <div key={room.id} className="grid grid-cols-[1.55fr_1fr_.85fr_.8fr_.75fr_.85fr_150px] items-center px-3 py-2.5 text-[11px] transition hover:bg-blue-50/35 dark:hover:bg-blue-500/5">
                          <div className="truncate font-extrabold text-slate-800 dark:text-slate-100">{room.meeting?.subject || room.name || 'جلسه ویدیویی'}</div>
                          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-300"><Clock className="h-3.5 w-3.5 text-blue-500" /> {formatRoomTime(room)}</div>
                          <div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold ring-1 ${status.className}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} />{status.label}</span></div>
                          <div className="flex items-center gap-1.5 font-bold text-slate-600 dark:text-slate-300">{isHost ? <Crown className="h-3.5 w-3.5 text-amber-500" /> : <Users className="h-3.5 w-3.5 text-slate-400" />}{isHost ? 'میزبان' : 'مشارکت‌کننده'}</div>
                          <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-300"><Users className="h-3.5 w-3.5" /> {room.participant_count ?? 0} نفر</div>
                          <div className="font-mono text-[10px] font-bold tracking-wider text-slate-500 dark:text-slate-300">{room.code}</div>
                          <div className="flex items-center gap-1.5">
                            <button type="button" onClick={() => openStandaloneConferenceSession(room.code)} disabled={joiningRoomId === room.id} className="inline-flex h-8 items-center justify-center gap-1 rounded-lg bg-blue-600 px-2.5 text-[10px] font-extrabold text-white hover:bg-blue-700 disabled:opacity-50">{joiningRoomId === room.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />} ورود</button>
                            <button type="button" onClick={() => onInviteRoom(room)} className="inline-flex h-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 px-2.5 text-[10px] font-extrabold text-blue-600 hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">دعوت</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_285px]">
        <section className="rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 sm:p-5">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"><Users className="h-5 w-5" /></div>
              <div><h2 className="text-base font-black text-slate-950 dark:text-white">جلسات در دسترس</h2><p className="mt-0.5 text-[10px] text-slate-400">جلسات عمومی و فعال سازمان که می‌توانید به آن‌ها بپیوندید.</p></div>
            </div>
            {!loading && rooms.length > 0 && <span className="text-[10px] font-bold text-blue-600 dark:text-blue-300">{rooms.length} جلسه فعال</span>}
          </div>

          {loading ? (
            <div className="flex min-h-32 items-center justify-center gap-2 text-xs text-slate-400"><RefreshCw className="h-4 w-4 animate-spin" /> در حال دریافت اتاق‌ها...</div>
          ) : rooms.length === 0 ? (
            <div className="flex min-h-32 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/40 px-4 text-center dark:border-slate-800 dark:bg-slate-900/30"><Video className="h-6 w-6 text-slate-300" /><p className="mt-2 text-xs font-bold text-slate-500">جلسه فعالی برای شما وجود ندارد</p></div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {rooms.map(room => <RoomCard key={room.id} room={room} currentUserId={currentUserId} onJoin={() => openStandaloneConferenceSession(room.code)} onInvite={() => onInviteRoom(room)} joining={joiningRoomId === room.id} />)}
            </div>
          )}
        </section>

        <aside className="rounded-[22px] border border-blue-100 bg-blue-50/45 p-4 shadow-[0_8px_24px_rgba(37,99,235,0.04)] dark:border-blue-500/15 dark:bg-blue-500/5 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300"><Plus className="h-5 w-5" /></div>
            <div><h3 className="text-base font-black text-slate-950 dark:text-white">ایجاد جلسه جدید</h3><p className="mt-0.5 text-[10px] text-slate-400">به‌راحتی یک جلسه جدید ایجاد کنید و دیگران را دعوت نمایید.</p></div>
          </div>

          {!showCreate ? (
            <button type="button" onClick={onOpenCreate} disabled={configLoading || !!configError || !config} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-white py-2.5 text-xs font-extrabold text-blue-600 transition hover:bg-blue-50 disabled:opacity-50 dark:border-blue-500/20 dark:bg-slate-950 dark:text-blue-300 dark:hover:bg-blue-500/10"><Plus className="h-4 w-4" /> ایجاد جلسه</button>
          ) : (
            <form onSubmit={onCreate} className="mt-4 space-y-2.5">
              <div className="flex items-center justify-between"><span className="text-[10px] font-bold text-slate-500">تنظیمات جلسه</span><button type="button" onClick={onCloseCreate} aria-label="انصراف" className="rounded-lg p-1.5 text-slate-400 hover:bg-white dark:hover:bg-slate-900"><X className="h-4 w-4" /></button></div>
              <input value={createName} onChange={event => onCreateNameChange(event.target.value)} placeholder="نام جلسه (اختیاری)" className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white" />
              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-white/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/70"><input type="checkbox" checked={requireApproval} onChange={event => onRequireApprovalChange(event.target.checked)} className="h-4 w-4 accent-blue-600" /><span className="text-[11px] font-bold text-slate-600 dark:text-slate-300">تأیید میزبان برای ورود</span></label>
              <button type="submit" disabled={creating || configLoading || !config?.ok} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-xs font-extrabold text-white hover:bg-blue-700 disabled:opacity-50">{creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} ایجاد اتاق</button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
