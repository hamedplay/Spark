import { User } from 'lucide-react';
import { Meeting } from '../../../../types';
import type { ParticipantStatusEntry } from '../../types/meetingCard';

interface ParticipantStatusPanelProps {
  meeting: Meeting;
  participantUserIds: string[];
  participantStatuses: Record<string, ParticipantStatusEntry>;
  delegateNames: Record<string, string>;
  isCreator: boolean;
}

export function ParticipantStatusPanel({ meeting, participantUserIds, participantStatuses, delegateNames, isCreator }: ParticipantStatusPanelProps) {
  const hasStatuses = isCreator && Object.keys(participantStatuses).length > 0;
  const totalParticipants = meeting.participants.length;

  return (
    <div className="mt-2.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">شرکت‌کنندگان</p>
        <span className="text-[9px] text-slate-400 dark:text-slate-500">{totalParticipants.toLocaleString('fa-IR')} نفر</span>
      </div>

      {hasStatuses ? (
        <div className="flex flex-wrap gap-1.5">
          {participantUserIds.slice(0, 4).map((uid: string) => {
            const entry = participantStatuses[uid];
            const statusColor = !entry || entry.status === 'pending'
              ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300'
              : entry.status === 'accepted'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300'
              : entry.status === 'delegated'
              ? 'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300'
              : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300';
            const statusLabel = !entry || entry.status === 'pending' ? 'در انتظار'
              : entry.status === 'accepted' ? 'پذیرفته'
              : entry.status === 'delegated' ? `واگذار${entry.delegate_to && delegateNames[entry.delegate_to] ? ` به ${delegateNames[entry.delegate_to]}` : ''}`
              : 'رد کرده';
            const participantIdx = participantUserIds.indexOf(uid);
            const displayName = meeting.participants[participantIdx] || uid;

            return (
              <span key={uid} className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-[9px] font-bold ${statusColor}`}>
                <User className="h-3 w-3 flex-shrink-0" />
                <span className="max-w-[7rem] truncate">{displayName}</span>
                <span className="opacity-50">•</span>
                <span className="truncate">{statusLabel}</span>
              </span>
            );
          })}
          {participantUserIds.length > 4 && (
            <span className="inline-flex items-center rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[9px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
              +{(participantUserIds.length - 4).toLocaleString('fa-IR')}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {meeting.participants.slice(0, 4).map((participant, index) => (
            <span key={index} className="inline-flex max-w-full items-center gap-1 rounded-lg border border-indigo-100 bg-indigo-50/70 px-2 py-1 text-[9px] font-bold text-indigo-700 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300">
              <User className="h-3 w-3 flex-shrink-0" />
              <span className="max-w-[8rem] truncate">{participant}</span>
            </span>
          ))}
          {meeting.participants.length > 4 && (
            <span className="inline-flex items-center rounded-lg border border-slate-200 bg-white/70 px-2 py-1 text-[9px] font-bold text-slate-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
              +{(meeting.participants.length - 4).toLocaleString('fa-IR')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
