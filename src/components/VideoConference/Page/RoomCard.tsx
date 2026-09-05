import { useState } from 'react';
import type { MouseEvent } from 'react';
import {
  Check,
  Clock,
  Copy,
  Crown,
  Link2,
  Loader as Loader2,
  PhoneOff,
  Server,
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

  const meetingTime = room.meeting?.start_time && room.meeting?.end_time
    ? `${room.meeting.start_time.slice(0, 5)} - ${room.meeting.end_time.slice(0, 5)}`
    : moment(room.created_at).fromNow();
  const participantCount = room.participant_count ?? 0;
  const title = room.meeting?.subject || room.name || 'جلسه ویدیویی';

  return (
    <article className="group rounded-[18px] border border-slate-200/80 bg-white p-3.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-[0_10px_24px_rgba(37,99,235,0.08)] dark:border-slate-800 dark:bg-slate-950 dark:hover:border-blue-500/25">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-extrabold ${isActive
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300'
              : 'bg-blue-50 text-blue-700 dark:bg-blue-500/10 dark:text-blue-300'}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${isActive ? 'bg-emerald-500' : 'bg-blue-500'}`} />
              {isActive ? 'در حال برگزاری' : 'آماده ورود'}
            </span>
            {isHost && <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"><Crown className="h-3 w-3" /> میزبان</span>}
          </div>
          <h3 className="mt-2 truncate text-sm font-black text-slate-950 dark:text-white">{title}</h3>
        </div>
        <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${isSfu ? 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300' : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'}`}>
          {isSfu ? <Server className="h-4 w-4" /> : <Video className="h-4 w-4" />}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[10px] text-slate-500 dark:text-slate-400">
        <span className="inline-flex items-center gap-1.5"><Clock className="h-3.5 w-3.5 text-blue-500" />{meetingTime}</span>
        <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-slate-400" />{participantCount} از {room.max_participants} نفر</span>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
        <button onClick={copy} aria-label={`کپی کد اتاق ${room.code}`} className="inline-flex min-w-0 items-center gap-1.5 rounded-lg bg-slate-50 px-2 py-1.5 font-mono text-[10px] font-bold tracking-wider text-slate-500 transition hover:bg-slate-100 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800">
          {copied ? <Check className="h-3 w-3 shrink-0 text-emerald-500" /> : <Copy className="h-3 w-3 shrink-0" />}
          <span className="truncate">{room.code}</span>
        </button>
        <span className={`rounded-lg px-2 py-1.5 text-[9px] font-extrabold ${isSfu ? 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300' : 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300'}`}>{isSfu ? 'LiveKit' : 'Mesh'}</span>
      </div>

      <div className="mt-2.5 flex items-center gap-1.5">
        {isHost && (
          <button onClick={endRoom} disabled={ending} aria-label="اتمام جلسه آنلاین" title="اتمام جلسه آنلاین" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300">
            {ending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PhoneOff className="h-3.5 w-3.5" />}
          </button>
        )}
        <button onClick={(event) => { event.stopPropagation(); onInvite(); }} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-blue-200 bg-white px-2 text-[10px] font-extrabold text-blue-600 transition hover:bg-blue-50 dark:border-blue-500/20 dark:bg-slate-900 dark:text-blue-300 dark:hover:bg-blue-500/10"><Link2 className="h-3.5 w-3.5" /> دعوت</button>
        <button onClick={(event) => { event.stopPropagation(); onJoin(); }} disabled={joining} className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-2 text-[10px] font-extrabold text-white transition hover:bg-blue-700 disabled:opacity-50">{joining ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />} ورود</button>
      </div>
    </article>
  );
}
