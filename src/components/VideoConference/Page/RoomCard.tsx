import { useState } from 'react';
import {
  Copy,
  Check,
  Clock,
  Crown,
  Users,
  Lock,
  LockOpen,
  ChevronLeft,
  UserPlus,
  Loader as Loader2,
  Radio,
} from 'lucide-react';
import moment from 'moment-jalaali';
import type { ConferenceRoom } from '../types';

export function RoomCard({ room, currentUserId, onJoin, onInvite, joining }: {
  room: ConferenceRoom & { participant_count?: number; meeting?: any };
  currentUserId: string;
  onJoin: () => void;
  onInvite: () => void;
  joining: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const isHost = room.host_id === currentUserId;

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(room.code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const meetingTime = room.meeting?.start_time && room.meeting?.end_time
    ? `${room.meeting.start_time.slice(0, 5)} - ${room.meeting.end_time.slice(0, 5)}`
    : null;

  const participantCount = room.participant_count ?? 0;
  const capacityPercent = room.max_participants > 0
    ? Math.min(100, Math.round((participantCount / room.max_participants) * 100))
    : 0;

  return (
    <article className="conference-room-card group relative overflow-hidden rounded-2xl border border-slate-700/60 bg-slate-950/35 p-3.5 shadow-[0_16px_45px_rgba(0,0,0,0.14)] backdrop-blur-sm transition duration-200 hover:-translate-y-0.5 hover:border-teal-500/35 hover:bg-slate-950/55 hover:shadow-[0_20px_50px_rgba(0,0,0,0.2)]">
      <div className="pointer-events-none absolute -left-10 -top-10 h-24 w-24 rounded-full bg-teal-500/10 blur-3xl transition group-hover:bg-teal-500/15" />

      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.7)]" />
            <h3 className="truncate text-sm font-extrabold text-white sm:text-[15px]">
              {room.name || 'جلسه ویدیویی'}
            </h3>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-400">
            <span className="flex items-center gap-1 text-emerald-300">
              <Radio className="h-3 w-3" /> فعال
            </span>
            {meetingTime && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> {meetingTime}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" /> {moment(room.created_at).fromNow()}
            </span>
          </div>
        </div>

        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ring-1 ${
            isHost
              ? 'bg-amber-500/15 text-amber-300 ring-amber-400/20'
              : 'bg-teal-500/15 text-teal-300 ring-teal-400/20'
          }`}
          title={isHost ? 'شما میزبان هستید' : 'دعوت‌شده'}
        >
          {isHost ? <Crown className="h-4 w-4" /> : <Users className="h-4 w-4" />}
        </div>
      </div>

      <div className="relative mt-3 rounded-xl border border-slate-700/50 bg-slate-900/55 p-2.5">
        <div className="flex items-center justify-between gap-3 text-[10px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-cyan-300" />
            <span className="font-semibold text-slate-200">{participantCount}</span>
            <span>از {room.max_participants} نفر</span>
          </span>
          <span className={`flex items-center gap-1 ${room.is_locked ? 'text-rose-300' : 'text-emerald-300'}`}>
            {room.is_locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
            {room.is_locked ? 'قفل' : 'باز'}
          </span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-l from-teal-400 to-cyan-400 transition-all"
            style={{ width: `${capacityPercent}%` }}
          />
        </div>
      </div>

      <div className="relative mt-3 flex items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
        <button
          onClick={copy}
          aria-label={`کپی کد اتاق ${room.code}`}
          className="flex min-w-0 items-center gap-1.5 rounded-lg border border-slate-700/70 bg-slate-900/70 px-2.5 py-1.5 font-mono text-[10px] text-slate-300 transition hover:border-slate-600 hover:bg-slate-800"
        >
          {copied ? <Check className="h-3 w-3 shrink-0 text-emerald-400" /> : <Copy className="h-3 w-3 shrink-0" />}
          <span className="truncate tracking-wider">{room.code}</span>
        </button>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onInvite(); }}
            aria-label="دعوت از شرکت‌کنندگان"
            title="دعوت"
            className="flex h-8 items-center gap-1.5 rounded-lg border border-blue-500/25 bg-blue-500/10 px-2.5 text-[10px] font-bold text-blue-300 transition hover:bg-blue-500/15"
          >
            <UserPlus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">دعوت</span>
          </button>
          <button
            onClick={onJoin}
            disabled={joining}
            aria-label="ورود به اتاق"
            aria-pressed={joining}
            className="flex h-8 items-center gap-1.5 rounded-lg bg-gradient-to-l from-teal-600 to-cyan-600 px-3 text-[11px] font-extrabold text-white shadow-[0_8px_20px_rgba(13,148,136,0.2)] transition hover:from-teal-500 hover:to-cyan-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            ورود
          </button>
        </div>
      </div>
    </article>
  );
}
