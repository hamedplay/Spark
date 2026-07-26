import { useState } from 'react';
import { Copy, Check, Clock, Crown, Users, Lock, Clock as Unlock, ChevronRight, UserPlus, Loader as Loader2 } from 'lucide-react';
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
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  const meetingTime = room.meeting?.start_time && room.meeting?.end_time
    ? `${room.meeting.start_time} - ${room.meeting.end_time}`
    : null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-lg transition-all">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-800 dark:text-white truncate">{room.name || 'جلسه ویدیویی'}</h3>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-green-600 dark:text-green-400 font-medium">فعال</span>
            </div>
            {meetingTime && (
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <Clock className="w-3 h-3" />{meetingTime}
              </span>
            )}
          </div>
        </div>
        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${isHost ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-teal-100 dark:bg-teal-900/30'}`}>
          {isHost ? <Crown className="w-4 h-4 text-amber-600 dark:text-amber-400" /> : <Users className="w-4 h-4 text-teal-600 dark:text-teal-400" />}
        </div>
      </div>

      <div className="flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400 mb-4">
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          <span>{room.participant_count ?? 0} / {room.max_participants}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" />
          <span>{moment(room.created_at).fromNow()}</span>
        </div>
        {room.is_locked ? (
          <Lock className="w-3.5 h-3.5 text-red-400" />
        ) : (
          <Unlock className="w-3.5 h-3.5 text-green-400" />
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          onClick={copy}
          aria-label={`کپی کد اتاق ${room.code}`}
          className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg text-xs font-mono transition-colors"
        >
          {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
          {room.code}
        </button>
        <div className="flex gap-1.5">
          <button
            onClick={(e) => { e.stopPropagation(); onInvite(); }}
            aria-label="دعوت از شرکت‌کنندگان"
            className="flex items-center gap-1 px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-medium transition-colors border border-blue-200 dark:border-blue-700"
          >
            <UserPlus className="w-3 h-3" /> دعوت
          </button>
          <button
            onClick={onJoin}
            disabled={joining}
            aria-label="ورود به اتاق"
            aria-pressed={joining}
            className="flex items-center gap-1 px-3 py-1.5 bg-teal-500 hover:bg-teal-600 text-white rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
          >
            {joining ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ChevronRight className="w-3.5 h-3.5" />}
            ورود
          </button>
        </div>
      </div>
    </div>
  );
}
