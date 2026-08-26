import {
  AlertTriangle,
  Check,
  CircleDot,
  Gauge,
  LogIn,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Users,
  Video,
  VideoOff,
  X,
} from 'lucide-react';
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
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-bold ${enabled
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300'
      : 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-500'}`}>
      {icon}{label}
    </span>
  );
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
  isMuted,
  isVideoOff,
  onRefresh,
  onJoinCodeChange,
  onJoinByCode,
  onOpenCreate,
  onCloseCreate,
  onCreateNameChange,
  onRequireApprovalChange,
  onCreate,
  onToggleMuted,
  onToggleVideo,
  onJoinRoom,
  onInviteRoom,
}: Props) {
  const onlineParticipants = rooms.reduce((total, room) => total + (room.participant_count ?? 0), 0);
  const topology = config?.media_topology ?? null;
  const isSfu = topology === 'sfu';
  const topologyTitle = configError ? 'پیکربندی در دسترس نیست' : topology ? (isSfu ? 'LiveKit SFU' : 'WebRTC Mesh') : 'در حال دریافت';
  const topologyDescription = isSfu
    ? 'رسانه از سرور SFU عبور می‌کند؛ مناسب جلسه چندنفره سازمانی و قابلیت‌های مدیریتی.'
    : 'ارتباط رسانه مستقیم بین کاربران برقرار می‌شود؛ مناسب جلسات کوچک.';
  const capacity = config?.max_participants ?? null;

  return (
    <div className="space-y-4" dir="rtl">
      <section className="relative overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_18px_55px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:bg-slate-950">
        <div className="pointer-events-none absolute -left-20 -top-24 h-64 w-64 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-400/5" />
        <div className="pointer-events-none absolute -right-20 -bottom-24 h-64 w-64 rounded-full bg-violet-400/10 blur-3xl dark:bg-violet-400/5" />
        <div className="relative p-4 sm:p-5 lg:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-3.5">
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ring-1 ${isSfu
                ? 'bg-violet-50 text-violet-600 ring-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20'
                : 'bg-cyan-50 text-cyan-600 ring-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-500/20'}`}>
                {isSfu ? <Sparkles className="h-5 w-5" /> : <Video className="h-5 w-5" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-black tracking-tight text-slate-950 dark:text-white sm:text-2xl">ویدیو کنفرانس</h1>
                  <span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold ${isSfu
                    ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                    : 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300'}`}>
                    {topologyTitle}
                  </span>
                </div>
                <p className="mt-1.5 max-w-2xl text-xs leading-6 text-slate-500 dark:text-slate-400 sm:text-[13px]">
                  مرکز یکپارچه ایجاد، ورود و مدیریت جلسات آنلاین سازمانی؛ معماری و ظرفیت مستقیماً از تنظیمات مدیریت سامانه خوانده می‌شود.
                </p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onOpenCreate}
                disabled={configLoading || !!configError || !config}
                title={configError ? 'ابتدا خطای پیکربندی ویدیو کنفرانس را برطرف کنید' : undefined}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-extrabold text-white shadow-lg shadow-slate-950/10 transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-100 lg:flex-none"
              >
                <Plus className="h-4 w-4" /> جلسه جدید
              </button>
              <button
                type="button"
                onClick={onRefresh}
                aria-label="بروزرسانی اطلاعات ویدیو کنفرانس"
                title="بروزرسانی"
                className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <RefreshCw className={`h-4 w-4 ${(loading || configLoading) ? 'animate-spin' : ''}`} />
              </button>
            </div>
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

          <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 dark:text-slate-400"><Radio className="h-3.5 w-3.5 text-emerald-500" /> اتاق‌های فعال</div>
              <div className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{loading ? '—' : rooms.length}</div>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 dark:text-slate-400"><Users className="h-3.5 w-3.5 text-blue-500" /> حاضر در جلسات</div>
              <div className="mt-2 text-2xl font-black text-slate-950 dark:text-white">{loading ? '—' : onlineParticipants}</div>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 dark:text-slate-400"><Gauge className="h-3.5 w-3.5 text-violet-500" /> ظرفیت هر اتاق</div>
              <div className="mt-2 flex items-baseline gap-1"><span className="text-2xl font-black text-slate-950 dark:text-white">{configLoading ? '—' : configError ? 'خطا' : (capacity ?? '—')}</span>{capacity && <span className="text-[10px] text-slate-400">نفر</span>}</div>
            </div>
            <div className="rounded-2xl border border-slate-200/70 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/60">
              <div className="flex items-center gap-2 text-[10px] font-bold text-slate-500 dark:text-slate-400"><ShieldCheck className="h-3.5 w-3.5 text-cyan-500" /> معماری فعال</div>
              <div className="mt-2 text-sm font-black text-slate-950 dark:text-white">{configLoading ? 'در حال دریافت...' : topologyTitle}</div>
            </div>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="min-w-0 space-y-4">
          <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950 sm:p-5">
            <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-black text-slate-900 dark:text-white"><CircleDot className="h-4 w-4 text-emerald-500" /> جلسات در دسترس</h2>
                <p className="mt-1 text-[11px] text-slate-400">اتاق‌هایی که میزبان آن هستید یا قبلاً به آن‌ها دسترسی داشته‌اید.</p>
              </div>
              {!loading && rooms.length > 0 && <span className="w-fit rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{rooms.length} اتاق فعال</span>}
            </div>

            {loading ? (
              <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 dark:border-slate-800 dark:bg-slate-900/30">
                <div className="flex items-center gap-2 text-xs text-slate-400"><RefreshCw className="h-4 w-4 animate-spin" /> در حال دریافت اتاق‌ها...</div>
              </div>
            ) : rooms.length === 0 ? (
              <div className="flex min-h-52 flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/40 px-4 text-center dark:border-slate-800 dark:bg-slate-900/30">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-300 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:text-slate-600 dark:ring-slate-800"><Video className="h-5 w-5" /></div>
                <p className="mt-3 text-sm font-extrabold text-slate-700 dark:text-slate-200">جلسه فعالی برای شما وجود ندارد</p>
                <p className="mt-1 text-[11px] leading-5 text-slate-400">از بخش کناری با کد دعوت وارد شوید یا از دکمه «جلسه جدید» یک اتاق بسازید.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
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
        </main>

        <aside className="space-y-4 xl:sticky xl:top-0 xl:self-start">
          <section className={`rounded-[24px] border p-4 ${isSfu
            ? 'border-violet-200/80 bg-violet-50/60 dark:border-violet-500/20 dark:bg-violet-500/5'
            : 'border-cyan-200/80 bg-cyan-50/60 dark:border-cyan-500/20 dark:bg-cyan-500/5'}`}>
            <div className="flex items-start gap-3">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${isSfu ? 'bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300' : 'bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300'}`}>
                {isSfu ? <Sparkles className="h-4.5 w-4.5" /> : <MonitorUp className="h-4.5 w-4.5" />}
              </div>
              <div>
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">پروفایل رسانه سازمانی</div>
                <h3 className="mt-0.5 text-sm font-black text-slate-900 dark:text-white">{configLoading ? 'در حال دریافت...' : topologyTitle}</h3>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{topology ? topologyDescription : 'تنظیمات معماری در حال دریافت است.'}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <FeaturePill enabled={Boolean(config?.default_allow_chat)} icon={<MessageSquare className="h-3 w-3" />} label="چت" />
              <FeaturePill enabled={Boolean(config?.default_allow_screen_share)} icon={<MonitorUp className="h-3 w-3" />} label="اشتراک صفحه" />
              <FeaturePill enabled={Boolean(config?.default_allow_reactions)} icon={<Sparkles className="h-3 w-3" />} label="واکنش" />
              <FeaturePill enabled={Boolean(config?.recording_enabled)} icon={<CircleDot className="h-3 w-3" />} label="ضبط" />
              <FeaturePill enabled={Boolean(config?.default_waiting_room)} icon={<ShieldCheck className="h-3 w-3" />} label="اتاق انتظار" />
            </div>
            <div className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-[10px] text-slate-500 ring-1 ring-black/5 dark:bg-slate-950/40 dark:text-slate-400 dark:ring-white/5">
              ظرفیت مؤثر: <b className="text-slate-800 dark:text-slate-200">{capacity ?? '—'} نفر</b>
              {config?.room_default_ttl_hours ? <> · عمر پیش‌فرض اتاق: <b className="text-slate-800 dark:text-slate-200">{config.room_default_ttl_hours} ساعت</b></> : null}
            </div>
          </section>

          <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center gap-2"><LogIn className="h-4 w-4 text-blue-500" /><h3 className="text-sm font-black text-slate-900 dark:text-white">ورود با کد اتاق</h3></div>
            <p className="mt-1 text-[10px] text-slate-400">کد ۹ کاراکتری دعوت را وارد کنید.</p>
            <div className="mt-3 flex gap-2">
              <input
                value={joinCode}
                onChange={event => onJoinCodeChange(event.target.value.toUpperCase())}
                onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); onJoinByCode(); } }}
                placeholder="XXX-XXX-XXX"
                maxLength={11}
                dir="ltr"
                aria-label="کد اتاق"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-center font-mono text-sm tracking-[0.16em] text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-blue-950"
              />
              <button type="button" onClick={onJoinByCode} disabled={joining} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-white transition hover:bg-blue-700 disabled:opacity-50" aria-label="ورود با کد">
                {joining ? <RefreshCw className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
              </button>
            </div>
          </section>

          {showCreate && (
            <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-lg shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex items-center justify-between gap-3">
                <div><h3 className="text-sm font-black text-slate-900 dark:text-white">ایجاد جلسه جدید</h3><p className="mt-1 text-[10px] text-slate-400">اتاق با معماری {topologyTitle} ساخته می‌شود.</p></div>
                <button type="button" onClick={onCloseCreate} aria-label="بستن فرم ایجاد جلسه" className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
              </div>
              <form onSubmit={onCreate} className="mt-3 space-y-3">
                <input value={createName} onChange={event => onCreateNameChange(event.target.value)} placeholder="نام جلسه (اختیاری)" className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:border-slate-700 dark:bg-slate-900 dark:text-white dark:focus:ring-violet-950" />
                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 bg-slate-50/60 p-2.5 dark:border-slate-800 dark:bg-slate-900/60">
                  <input type="checkbox" checked={requireApproval} onChange={event => onRequireApprovalChange(event.target.checked)} className="h-4 w-4 accent-violet-600" />
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300">تأیید میزبان برای ورود</span>
                </label>
                <button type="submit" disabled={creating || configLoading || !config?.ok} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 py-2.5 text-sm font-extrabold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50">
                  {creating ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} ایجاد اتاق
                </button>
              </form>
            </section>
          )}

          <section className="rounded-[24px] border border-slate-200/80 bg-white p-4 dark:border-slate-800 dark:bg-slate-950">
            <h3 className="text-sm font-black text-slate-900 dark:text-white">وضعیت اولیه ورود</h3>
            <p className="mt-1 text-[10px] leading-4 text-slate-400">در صفحه پیش‌ورود امکان تغییر دوباره دستگاه‌ها وجود دارد.</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button type="button" onClick={onToggleMuted} aria-pressed={isMuted} className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-[11px] font-extrabold transition ${isMuted ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300' : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
                {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}{isMuted ? 'بی‌صدا' : 'میکروفن روشن'}
              </button>
              <button type="button" onClick={onToggleVideo} aria-pressed={isVideoOff} className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 text-[11px] font-extrabold transition ${isVideoOff ? 'border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300' : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'}`}>
                {isVideoOff ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4" />}{isVideoOff ? 'دوربین خاموش' : 'دوربین روشن'}
              </button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
