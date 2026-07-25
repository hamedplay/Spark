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
  return (
    <div className="mt-4">
      {/* Participant status panel (visible to meeting creator) */}
      {isCreator && Object.keys(participantStatuses).length > 0 ? (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">وضعیت شرکت‌کنندگان</p>
          <div className="flex flex-wrap gap-2">
            {participantUserIds.map((uid: string) => {
              const entry = participantStatuses[uid];
              const statusColor = !entry || entry.status === 'pending'
                ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800'
                : entry.status === 'accepted'
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300 border-green-200 dark:border-green-800'
                : entry.status === 'delegated'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                : 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300 border-red-200 dark:border-red-800';
              const statusLabel = !entry || entry.status === 'pending' ? 'در انتظار'
                : entry.status === 'accepted' ? 'پذیرفته'
                : entry.status === 'delegated' ? `واگذار شد${entry.delegate_to && delegateNames[entry.delegate_to] ? ` → ${delegateNames[entry.delegate_to]}` : ''}`
                : 'رد کرده';
              // Find display name from meeting.participants array (index-based fallback)
              const participantIdx = participantUserIds.indexOf(uid);
              const displayName = meeting.participants[participantIdx] || uid;
              return (
                <span key={uid} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${statusColor}`}>
                  <User className="w-3 h-3 shrink-0" />
                  <span>{displayName}</span>
                  <span className="opacity-70">|</span>
                  <span>{statusLabel}</span>
                </span>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {meeting.participants.map((participant, index) => (
            <span key={index} className="inline-flex items-center px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 rounded-full text-sm">
              <User className="w-4 h-4 ml-1 flex-shrink-0" />
              {participant}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
