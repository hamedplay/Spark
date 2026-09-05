import { useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Check,
  ChevronLeft,
  Clock,
  Copy,
  Crown,
  Lock,
  LockOpen,
  Loader as Loader2,
  MessageSquare,
  MonitorUp,
  PhoneOff,
  Radio,
  Server,
  UserPlus,
  Users,
  Video,
} from 'lucide-react';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import type { ConferenceRoom } from '../types';

export function RoomCard({ room, currentUserId, onJoin, onInvite, joining }: {
  room: ConferenceRoom & { participant_count?: number; meeting?: any };
  currentUserId: string;
  onJoin: () => void;
  onInvite: () => void;
  joining: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [ending, setEnding] = useState(false);
  const isHost = room.host_id === currentUserId;
  const isSfu = room.media_topology === 'sfu';
  const isActive = room.status === 'active';

  const copy = (event: MouseEvent) => {
    event.stopPropagation();
    navigator.clipboard.writeText(room.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const endRoom = async (event: MouseEvent) => {
    event.stopPropagation();
    if (!isHost || ending) return;
    if (!window.confirm('جلسه آنلاین برای همه پایان یابد؟')) return;

    setEnding(true);
    try {
      const { data, error } = await supabase.rpc('end_conference_room', {
        p_room_id: room.id,
        p_reason: 'ended_from_lobby',
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.reason || 'وضعیت جلسه به پایان‌یافته تغییر نکرد');
      toast.success('جلسه آنلاین پایان یافت');
    } catch (error: any) {
      console.error('endRoom error:', error);
      toast.error('خطا در اتمام جلسه آنلاین: ' + (error?.message || ''));
    } finally {
      setEnding(false);
    }
  };

  const openConference = (event: MouseEvent) => {
    event.stopPropagation();
    onJoin();
  };

  const meetingTime = room.meeting?.start_time && room.meeting?.end_time
    ? `${room.meeting.start_time.slice(0, 5)} تا ${room.meeting.end_time.slice(0, 5)}`
    : null;
  const participantCount = room.participant_count ?? 0;
  const capacityPercent = room.max_participants > 0
    ? Math.min(100, Math.round((participantCount / room.max_participants) * 100))
    : 0;
  const title = room.meeting?.subject || room.name || 'جلسه ویدیویی';

  return (
    <article className="group relative overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-4 shadow-[0_12px_34px_rgba(15,23,42,0.05)] transition duration-200 hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_18px_44px_rgba(37,99,235,0.10)] dark:border-slate-800 dark:bg-slate-950 dark:hover:border-blue-500/25 sm:p-4.5">
      <div className={`pointer-events-none absolute -left-10 -top-12 h-32 w-32 rounded-full blur-3xl ${isSfu ? 'bg-violet-400/10' : 'bg-cyan-400/10'}`} />
      <div className="pointer-events-none absolute -bottom-16 -right-10 h-28 w-28 rounded-full bg-blue-400/5 blur-3xl" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold ring-1 ${isActive
              ? 'bg-emerald-50 text-emerald-700 ring-emerald-100 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20'
              : 'bg-blue-50 text-blue-700 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-blue-500'}`} />
              {isActive ? 'در حال برگزاری' : 'آماده ورود'}
            </span>
            {isHost && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700 ring-1 ring-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20">
                <Crown className="h-3 w-3" /> میزبان
              </span>
            )}
          </div>
          <h3 className="truncate text-[15px] font-black text-slate-950 dark:text-white sm:text-base">{title}</h3>
          {room.meeting?.subject && room.name && room.meeting.subject !== room.name && (
            <p className="mt-1 truncate text-[11px] text-slate-400">اتاق: {room.name}</p>
          )}
        </div>

        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${isSfu
          ? 'bg-violet-50 text-violet-600 ring-1 ring-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20'
          : 'bg-cyan-50 text-cyan-600 ring-1 ring-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-500/20'}`}>
          {isSfu ? <Server className="h-5 w-5" /> : <Video className="h-5 w-5" />}
        </div>
      </div>

      <div className="relative mt-4 grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl border border-slate-100 bg-slate-50/75 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/65">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400"><Users className="h-3.5 w-3.5" /> شرکت‌کنندگان</div>
          <div className="mt-1.5 flex items-baseline gap-1"><span className="text-base font-black text-slate-900 dark:text-white">{participantCount}</span><span className="text-[10px] text-slate-400">از {room.max_participants} نفر</span></div>
        </div>
        <div className="rounded-2xl border border-slate-100 bg-slate-50/75 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/65">
          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400"><Clock className="h-3.5 w-3.5" /> زمان</div>
          <div className="mt-1.5 truncate text-[11px] font-extrabold text-slate-700 dark:text-slate-200">{meetingTime || moment(room.created_at).fromNow()}</div>
        </div>
      </div>

      <div className="relative mt-3 flex flex-wrap gap-1.5">
        <span className={`inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] font-bold ${isSfu
          ? 'bg-violet-50 text-violet-700 dark:bg-violet-500/10 dark:text-violet-300'
          : 'bg-cyan-50 text-cyan-700 dark:bg-cyan-500/10 dark:text-cyan-300'}`}>
          <Server className="h-3 w-3" /> {isSfu ? 'LiveKit SFU' : 'WebRTC Mesh'}
        </span>
        {room.chat_enabled && <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300"><MessageSquare className="h-3 w-3" /> چت</span>}
        {room.allow_screen_share && <span className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-300"><MonitorUp className="h-3 w-3" /> اشتراک صفحه</span>}
      </div>

      <div className="relative mt-4 rounded-2xl border border-slate-100 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-900/40">
        <div className="mb-2 flex items-center justify-between text-[10px] text-slate-400">
          <span className="flex items-center gap-1.5"><Radio className="h-3.5 w-3.5" /> ظرفیت اتاق</span>
          <span className={`inline-flex items-center gap-1 font-bold ${room.is_locked ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-300'}`}>
            {room.is_locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}{room.is_locked ? 'قفل' : 'باز'}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-200/80 dark:bg-slate-800">
          <div className={`h-full rounded-full transition-all ${capacityPercent >= 90 ? 'bg-rose-500' : isSfu ? 'bg-violet-500' : 'bg-blue-500'}`} style={{ width: `${capacityPercent}%` }} />
        </div>
      </div>

      <div className="relative mt-4 flex flex-col gap-2.5 border-t border-slate-100 pt-3.5 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <button onClick={copy} aria-label={`کپی کد اتاق ${room.code}`} className="flex min-w-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-[11px] text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 sm:justify-start">
          {copied ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate tracking-wider">{room.code}</span>
        </button>

        <div className="flex items-center gap-2">
          {isHost && (
            <button onClick={endRoom} disabled={ending} aria-label="اتمام جلسه آنلاین" title="اتمام جلسه آنلاین" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15">
              {ending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PhoneOff className="h-4 w-4" />}
            </button>
          )}
          <button onClick={(event) => { event.stopPropagation(); onInvite(); }} aria-label="دعوت از شرکت‌کنندگان" title="دعوت" className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-blue-200 bg-blue-50 px-3 text-[11px] font-extrabold text-blue-600 transition hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15 sm:flex-none">
            <UserPlus className="h-3.5 w-3.5" /> دعوت
          </button>
          <button onClick={openConference} disabled={joining} aria-label="ورود به اتاق" className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-3.5 text-[11px] font-extrabold text-white shadow-sm shadow-blue-600/15 transition hover:bg-blue-700 disabled:opacity-50 sm:flex-none">
            {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronLeft className="h-3.5 w-3.5" />} ورود
          </button>
        </div>
      </div>
    </article>
  );
}
