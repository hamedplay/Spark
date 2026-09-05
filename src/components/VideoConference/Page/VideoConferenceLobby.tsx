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
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold ${enabled
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

  const timeRange = start && end ? `${start} تا ${end}` : start || end || '';
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
  onJoinByCode,
  onOpenCreate,
  onCloseCreate,
  onCreateNameChange,
  onRequireApprovalChange,
  onCreate,
  onJoinRoom,
  onInviteRoom,
}: Props) {
  const [showMyMeetings, setShowMyMeetings] = useState(false);
  const onlineParticipants = rooms.reduce((total, room) => total + (room.participant_count ?? 0), 0);
  const topology = config?.media_topology ?? null;
  const isSfu = topology === 'sfu';
  const topologyTitle = configError ? 'پیکربندی در دسترس نیست' : topology ? (isSfu ? 'LiveKit SFU' : 'WebRTC Mesh') : 'در حال دریافت';
  const topologyDescription = isSfu
    ? 'رسانه از سرور SFU عبور می‌کند؛ مناسب جلسه چندنفره سازمانی، اشتراک صفحه و کنترل‌های مدیریتی.'
    : 'ارتباط رسانه مستقیم بین کاربران برقرار می‌شود؛ مناسب جلسات کوچک و کم‌تعداد.';
  const capacity = config?.max_participants ?? null;

  return (
    <div className="space-y-4 pb-4" dir="rtl">
      <section className="relative overflow-hidden rounded-[28px] border border-blue-100/80 bg-gradient-to-l from-indigo-50 via-blue-50 to-cyan-50 shadow-[0_18px_55px_rgba(37,99,235,0.08)] dark:border-blue-500/15 dark:from-slate-950 dark:via-slate-950 dark:to-blue-950/40">
        <div className="pointer-events-none absolute -left-20 -top-24 h-72 w-72 rounded-full bg-blue-400/15 blur-3xl dark:bg-blue-400/8" />
        <div className="pointer-events-none absolute -right-20 -bottom-28 h-72 w-72 rounded-full bg-violet-400/15 blur-3xl dark:bg-violet-400/8" />
        <div className="relative flex min-h-[178px] items-center justify-between gap-6 p-5 sm:p-6 lg:p-7">
          <div className="max-w-3xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-white/75 px-3 py-1.5 text-[11px] font-extrabold text-blue-700 shadow-sm backdrop-blur dark:border-blue-500/20 dark:bg-slate-900/70 dark:text-blue-300">
              <Video className="h-3.5 w-3.5" /> مرکز جلسات آنلاین سازمانی
            </div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950 dark:text-white sm:text-3xl">ویدیو کنفرانس</h1>
            <p className="mt-2 text-sm font-bold text-slate-700 dark:text-slate-200 sm:text-[15px]">مرکز برگزاری، پیوستن و مدیریت جلسات آنلاین سازمان شما</p>
            <p className="mt-2 max-w-2xl text-xs leading-6 text-slate-500 dark:text-slate-400 sm:text-[13px]">
              جلسات مجازی، همکاری تیمی و اشتراک دانش را در یک محیط امن و یکپارچه مدیریت کنید.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onOpenCreate}
                disabled={configLoading || !!configError || !config}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-blue-600/15 transition hover:-translate-y-0.5 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              >
                <Plus className="h-4 w-4" /> جلسه جدید
              </button>
              <button
                type="button"
                onClick={onRefresh}
                aria-label="بروزرسانی اطلاعات ویدیو کنفرانس"
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/80 bg-white/75 px-3.5 py-2.5 text-xs font-bold text-slate-600 shadow-sm backdrop-blur transition hover:bg-white dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:bg-slate-900"
              >
                <RefreshCw className={`h-4 w-4 ${(loading || configLoading) ? 'animate-spin' : ''}`} /> بروزرسانی
              </button>
            </div>
          </div>

          <div className="hidden w-[290px] shrink-0 items-center justify-center lg:flex">
            <div className="relative h-36 w-64 rounded-[26px] border border-white/80 bg-white/75 p-4 shadow-xl shadow-blue-900/10 backdrop-blur dark:border-slate-700 dark:bg-slate-900/75">
              <div className="absolute -right-4 top-5 flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/25"><Video className="h-5 w-5" /></div>
              <div className="absolute -left-3 bottom-5 flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-600/20"><MessageSquare className="h-4 w-4" /></div>
              <div className="grid h-full grid-cols-2 gap-2 rounded-2xl bg-gradient-to-br from-blue-50 to-violet-50 p-2 dark:from-slate-800 dark:to-slate-800/70">
                {['م', 'س', 'ع', 'ن'].map((label, index) => (
                  <div key={label + index} className="flex items-center justify-center rounded-xl border border-white/80 bg-white text-base font-black text-blue-700 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-blue-300">{label}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
        <section className={`rounded-[26px] border p-4 sm:p-5 ${isSfu
          ? 'border-violet-200/80 bg-gradient-to-br from-white to-violet-50/70 dark:border-violet-500/20 dark:from-slate-950 dark:to-violet-950/10'
          : 'border-cyan-200/80 bg-gradient-to-br from-white to-cyan-50/70 dark:border-cyan-500/20 dark:from-slate-950 dark:to-cyan-950/10'}`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-md">
              <div className="flex items-center gap-3">
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isSfu ? 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' : 'bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300'}`}>
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-black text-slate-950 dark:text-white">پروفایل رسانه سازمانی</h2>
                  <p className="mt-0.5 text-[11px] text-slate-400">زیرساخت و قابلیت‌های ویدیو کنفرانس سازمان شما</p>
                </div>
              </div>
              <p className="mt-3 text-xs leading-6 text-slate-500 dark:text-slate-400">{topology ? topologyDescription : 'تنظیمات معماری و ظرفیت از مدیریت سامانه در حال دریافت است.'}</p>
            </div>

            <div className="grid flex-1 grid-cols-2 gap-2 lg:max-w-2xl lg:grid-cols-4">
              <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400"><Sparkles className="h-3.5 w-3.5 text-violet-500" /> معماری فعال</div>
                <div className="mt-1.5 truncate text-sm font-black text-slate-900 dark:text-white">{configLoading ? '...' : topologyTitle}</div>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400"><Gauge className="h-3.5 w-3.5 text-blue-500" /> ظرفیت هر اتاق</div>
                <div className="mt-1.5 text-sm font-black text-slate-900 dark:text-white">{configLoading ? '—' : configError ? 'خطا' : `${capacity ?? '—'} نفر`}</div>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400"><Radio className="h-3.5 w-3.5 text-fuchsia-500" /> اتاق‌های فعال</div>
                <div className="mt-1.5 text-sm font-black text-slate-900 dark:text-white">{loading ? '—' : rooms.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-200/70 bg-white/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/70">
                <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400"><Users className="h-3.5 w-3.5 text-emerald-500" /> حاضر در جلسات</div>
                <div className="mt-1.5 text-sm font-black text-slate-900 dark:text-white">{loading ? '—' : onlineParticipants}</div>
              </div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-200/70 pt-4 dark:border-slate-800">
            <span className="ml-1 text-[11px] font-extrabold text-slate-500 dark:text-slate-400">قابلیت‌ها:</span>
            <FeaturePill enabled={Boolean(config?.default_allow_chat)} icon={<MessageSquare className="h-3.5 w-3.5" />} label="چت" />
            <FeaturePill enabled={Boolean(config?.default_allow_screen_share)} icon={<MonitorUp className="h-3.5 w-3.5" />} label="اشتراک صفحه" />
            <FeaturePill enabled={Boolean(config?.default_allow_reactions)} icon={<Sparkles className="h-3.5 w-3.5" />} label="واکنش" />
            <FeaturePill enabled={Boolean(config?.recording_enabled)} icon={<CircleDot className="h-3.5 w-3.5" />} label="ضبط" />
            <FeaturePill enabled={Boolean(config?.default_waiting_room)} icon={<ShieldCheck className="h-3.5 w-3.5" />} label="اتاق انتظار" />
            {config?.room_default_ttl_hours ? <span className="mr-auto text-[10px] text-slate-400">عمر پیش‌فرض اتاق: <b className="text-slate-600 dark:text-slate-300">{config.room_default_ttl_hours} ساعت</b></span> : null}
          </div>

          {configError && !configLoading && (
            <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-amber-900 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="min-w-0">
                  <div className="text-xs font-extrabold">پیکربندی ویدیو کنفرانس از سرور دریافت نشد</div>
                  <div className="mt-1 break-words text-[10px] leading-5 opacity-80">{configError}</div>
                </div>
              </div>
              <button type="button" onClick={onRefresh} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-300/70 bg-white/70 px-3 py-2 text-[11px] font-extrabold transition hover:bg-white dark:border-amber-400/20 dark:bg-slate-950/30 dark:hover:bg-slate-950/50">
                <RefreshCw className="h-3.5 w-3.5" /> تلاش مجدد
              </button>
            </div>
          )}
        </section>

        <section className="rounded-[26px] border border-blue-200/80 bg-gradient-to-b from-blue-50/90 to-white p-4 shadow-[0_12px_35px_rgba(37,99,235,0.08)] dark:border-blue-500/20 dark:from-blue-950/20 dark:to-slate-950 sm:p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-600/20"><LogIn className="h-5 w-5" /></div>
            <div>
              <h2 className="text-base font-black text-slate-950 dark:text-white">ورود با کد اتاق</h2>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">کد دعوت جلسه را وارد کنید و مستقیم وارد پیش‌ورود شوید.</p>
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-blue-100 bg-white p-2 shadow-inner dark:border-blue-500/20 dark:bg-slate-900">
            <input
              value={joinCode}
              onChange={event => onJoinCodeChange(event.target.value.toUpperCase())}
              onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onJoinByCode(); } }}
              placeholder="XXX-XXX-XXX"
              maxLength={11}
              dir="ltr"
              aria-label="کد اتاق"
              className="w-full rounded-xl border-0 bg-transparent px-3 py-3 text-center font-mono text-lg font-black tracking-[0.16em] text-slate-900 outline-none placeholder:text-slate-300 dark:text-white dark:placeholder:text-slate-600"
            />
          </div>
          <button
            type="button"
            onClick={onJoinByCode}
            disabled={joining}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3 text-sm font-extrabold text-white shadow-lg shadow-blue-600/15 transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {joining ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />} ورود به جلسه
          </button>
        </section>
      </div>

      {showCreate && (
        <section className="rounded-[26px] border border-violet-200/80 bg-white p-4 shadow-[0_12px_35px_rgba(76,29,149,0.06)] dark:border-violet-500/20 dark:bg-slate-950 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"><Plus className="h-5 w-5" /></div>
              <div><h3 className="text-sm font-black text-slate-900 dark:text-white">ایجاد جلسه جدید</h3><p className="mt-1 text-[11px] text-slate-400">اتاق با معماری {topologyTitle} ساخته می‌شود.</p></div>
            </div>
            <button type="button" onClick={onCloseCreate} aria-label="بستن فرم ایجاد جلسه" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
          </div>
          <form onSubmit={onCreate} className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(240px,0.45fr)_170px] lg:items-center">
            <input value={createName} onChange={event => onCreateNameChange(event.target.value)} placeholder="نام جلسه (اختیاری)" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-violet-950" />
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/60">
              <input type="checkbox" checked={requireApproval} onChange={event => onRequireApprovalChange(event.target.checked)} className="h-4 w-4 accent-violet-600" />
              <span className="text-xs font-bold text-slate-600 dark:text-slate-300">تأیید میزبان برای ورود</span>
            </label>
            <button type="submit" disabled={creating || configLoading || !config?.ok} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-3 text-sm font-extrabold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
              {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} ایجاد اتاق
            </button>
          </form>
        </section>
      )}

      <section className="overflow-hidden rounded-[26px] border border-slate-200/80 bg-white shadow-[0_10px_34px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950">
        <button
          type="button"
          onClick={() => setShowMyMeetings(value => !value)}
          aria-expanded={showMyMeetings}
          className="flex w-full items-center justify-between gap-4 p-4 text-right transition hover:bg-slate-50/80 dark:hover:bg-slate-900/60 sm:p-5"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300"><CalendarDays className="h-5 w-5" /></div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-black text-slate-950 dark:text-white">جلسات آنلاین من</h2>
                {!loading && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{rooms.length} جلسه</span>}
              </div>
              <p className="mt-1 text-[11px] text-slate-400">جلسات مرتبط با شما و وضعیت فعلی هر اتاق را مشاهده کنید.</p>
            </div>
          </div>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
            {showMyMeetings ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </button>

        {showMyMeetings && (
          <div className="border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800 sm:px-5 sm:pb-5">
            {loading ? (
              <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-slate-400"><RefreshCw className="h-4 w-4 animate-spin" /> در حال دریافت جلسات شما...</div>
            ) : rooms.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 px-4 py-7 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900/30">در حال حاضر جلسه آنلاینی مرتبط با حساب شما وجود ندارد.</div>
            ) : (
              <div className="space-y-2">
                {rooms.map(room => {
                  const status = roomStatus(room);
                  const isHost = room.host_id === currentUserId;
                  return (
                    <div key={room.id} className="grid grid-cols-1 gap-3 rounded-2xl border border-slate-100 bg-slate-50/55 p-3 transition hover:border-blue-100 hover:bg-blue-50/35 dark:border-slate-800 dark:bg-slate-900/45 dark:hover:border-blue-500/20 dark:hover:bg-blue-500/5 lg:grid-cols-[minmax(180px,1.5fr)_minmax(150px,1fr)_minmax(125px,0.8fr)_minmax(110px,0.7fr)_minmax(90px,0.55fr)_auto] lg:items-center">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-slate-900 dark:text-white">{room.meeting?.subject || room.name || 'جلسه ویدیویی'}</div>
                        <div className="mt-1 font-mono text-[10px] tracking-wider text-slate-400">{room.code}</div>
                      </div>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-300"><Clock className="h-3.5 w-3.5 text-blue-500" /> {formatRoomTime(room)}</div>
                      <div><span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[10px] font-extrabold ring-1 ${status.className}`}><span className={`h-1.5 w-1.5 rounded-full ${status.dotClassName}`} />{status.label}</span></div>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-300">{isHost ? <Crown className="h-3.5 w-3.5 text-amber-500" /> : <Users className="h-3.5 w-3.5 text-slate-400" />}{isHost ? 'میزبان' : 'مشارکت‌کننده'}</div>
                      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500 dark:text-slate-300"><Users className="h-3.5 w-3.5 text-emerald-500" /> {room.participant_count ?? 0} نفر</div>
                      <div className="flex items-center gap-2 lg:justify-end">
                        <button type="button" onClick={() => onInviteRoom(room)} className="inline-flex h-9 items-center justify-center rounded-xl border border-blue-200 bg-white px-3 text-[11px] font-extrabold text-blue-600 transition hover:bg-blue-50 dark:border-blue-500/20 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-500/10">دعوت</button>
                        <button type="button" onClick={() => onJoinRoom(room)} disabled={joiningRoomId === room.id} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3 text-[11px] font-extrabold text-white transition hover:bg-blue-700 disabled:opacity-50">
                          {joiningRoomId === room.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />} ورود
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-[26px] border border-slate-200/80 bg-white p-4 shadow-[0_10px_34px_rgba(15,23,42,0.04)] dark:border-slate-800 dark:bg-slate-950 sm:p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300"><Users className="h-4 w-4" /></div>
              <h2 className="text-base font-black text-slate-950 dark:text-white">جلسات در دسترس</h2>
            </div>
            <p className="mt-1.5 text-[11px] text-slate-400">اتاق‌هایی که میزبان آن هستید یا قبلاً به آن‌ها دسترسی داشته‌اید.</p>
          </div>
          {!loading && rooms.length > 0 && <span className="w-fit rounded-full bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{rooms.length} اتاق فعال</span>}
        </div>

        {loading ? (
          <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/30">
            <div className="flex items-center gap-2 text-xs text-slate-400"><RefreshCw className="h-4 w-4 animate-spin" /> در حال دریافت اتاق‌ها...</div>
          </div>
        ) : rooms.length === 0 ? (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 px-4 text-center dark:border-slate-800 dark:bg-slate-900/30">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-300 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-600 dark:ring-slate-800"><Video className="h-5 w-5" /></div>
            <p className="mt-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">جلسه فعالی برای شما وجود ندارد</p>
            <p className="mt-1 text-[11px] leading-5 text-slate-400">با کد دعوت وارد شوید یا از دکمه «جلسه جدید» یک اتاق بسازید.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {rooms.map(room => (
              <RoomCard
                key={room.id}
                room={room}
                currentUserId={currentUserId}
                onJoin={() => onJoinRoom(room)}
                onInvite={() => onInviteRoom(room)}
                joining={joiningRoomId === room.id}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
