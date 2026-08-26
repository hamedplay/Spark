import { useState } from 'react';
import {
  Check,
  ChevronLeft,
  Clock,
  Copy,
  Crown,
  Lock,
  LockOpen,
  Loader as Loader2,
  PhoneOff,
  Radio,
  Server,
  UserPlus,
  Users,
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

  const copy = (event: React.MouseEvent) => {
    event.stopPropagation();
    navigator.clipboard.writeText(room.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const endRoom = async (event: React.MouseEvent) => {
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

  const openConference = (event: React.MouseEvent) => {
    event.stopPropagation();
    onJoin();
  };

  const meetingTime = room.meeting?.start_time && room.meeting?.end_time
    ? `${room.meeting.start_time.slice(0, 5)} - ${room.meeting.end_time.slice(0, 5)}`
    : null;
  const participantCount = room.participant_count ?? 0;
  const capacityPercent = room.max_participants > 0
    ? Math.min(100, Math.round((participantCount / room.max_participants) * 100))
    : 0;

  return (
    <article className="group relative overflow-hidden rounded-[22px] border border-slate-200/80 bg-white p-4 shadow-[0_10px_32px_rgba(15,23,42,0.05)] transition duration-200 hover:-translate-y-0.5 hover:border-violet-200 hover:shadow-[0_18px_42px_rgba(15,23,42,0.09)] dark:border-slate-800 dark:bg-slate-950 dark:hover:border-violet-500/25">
      <div className={`pointer-events-none absolute -left-10 -top-12 h-28 w-28 rounded-full blur-3xl ${isSfu ? 'bg-violet-400/10' : 'bg-cyan-400/10'}`} />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.45)]" />
            <h3 className="truncate text-sm font-black text-slate-900 dark:text-white sm:text-[15px]">{room.name || 'جلسه ویدیویی'}</h3>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[9px] font-extrabold ${isSfu
              ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-100 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-500/20'
              : 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100 dark:bg-cyan-500/10 dark:text-cyan-300 dark:ring-cyan-500/20'}`}>
              <Server className="h-3 w-3" /> {isSfu ? 'LiveKit SFU' : 'WebRTC Mesh'}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><Radio className="h-3 w-3" /> فعال</span>
            {isHost && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[9px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"><Crown className="h-3 w-3" /> میزبان</span>}
          </div>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isSfu ? 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300' : 'bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300'}`}>
          {isSfu ? <Server className="h-4 w-4" /> : <Users className="h-4 w-4" />}
        </div>
      </div>

      <div className="relative mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400"><Users className="h-3 w-3" /> شرکت‌کنندگان</div>
          <div className="mt-1 flex items-baseline gap-1"><span className="text-sm font-black text-slate-900 dark:text-white">{participantCount}</span><span className="text-[9px] text-slate-400">از {room.max_participants} نفر</span></div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="flex items-center gap-1.5 text-[9px] font-bold text-slate-400"><Clock className="h-3 w-3" /> زمان</div>
          <div className="mt-1 truncate text-[10px] font-extrabold text-slate-700 dark:text-slate-200">{meetingTime || moment(room.created_at).fromNow()}</div>
        </div>
      </div>

      <div className="relative mt-3">
        <div className="mb-1.5 flex items-center justify-between text-[9px] text-slate-400">
          <span>ظرفیت اتاق</span>
          <span className={`inline-flex items-center gap-1 font-bold ${room.is_locked ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-300'}`}>
            {room.is_locked ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}{room.is_locked ? 'قفل' : 'باز'}
          </span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
          <div className={`h-full rounded-full transition-all ${capacityPercent >= 90 ? 'bg-rose-500' : isSfu ? 'bg-violet-500' : 'bg-cyan-500'}`} style={{ width: `${capacityPercent}%` }} />
        </div>
      </div>

      <div className="relative mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button onClick={copy} aria-label={`کپی کد اتاق ${room.code}`} className="flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 font-mono text-[10px] text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
          {copied ? <Check className="h-3 w-3 shrink-0 text-emerald-500" /> : <Copy className="h-3 w-3 shrink-0" />}
          <span className="truncate tracking-wider">{room.code}</span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          {isHost && (
            <button onClick={endRoom} disabled={ending} aria-label="اتمام جلسه آنلاین" title="اتمام جلسه آنلاین" className="flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 text-[10px] font-bold text-rose-600 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/15">
              {ending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
            </button>
          )}
          <button onClick={(event) => { event.stopPropagation(); onInvite(); }} aria-label="دعوت از شرکت‌کنندگان" title="دعوت" className="flex h-8 items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2 text-[10px] font-bold text-blue-600 transition hover:bg-blue-100 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300 dark:hover:bg-blue-500/15">
            <UserPlus className="h-3.5 w-3.5" /><span className="hidden sm:inline">دعوت</span>
          </button>
          <button onClick={openConference} disabled={joining} aria-label="ورود به اتاق" className={`flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-extrabold text-white shadow-sm transition disabled:opacity-50 ${isSfu ? 'bg-violet-600 hover:bg-violet-700' : 'bg-cyan-600 hover:bg-cyan-700'}`}>
            {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronLeft className="h-3.5 w-3.5" />} ورود
          </button>
        </div>
      </div>
    </article>
  );
}
