import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Loader as Loader2, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { InformeeAddParticipantModal } from './InformeeAddParticipantModal';
import {
  fetchInformeeMeetings,
  type InformeeMeetingOption,
} from '../repositories/meetingInformeeParticipantsRepository';

interface Props {
  currentUserId: string;
}

function formatDate(value: string | null): string {
  if (!value) return 'تاریخ نامشخص';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'تاریخ نامشخص';
  return new Intl.DateTimeFormat('fa-IR-u-ca-persian-nu-latn', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Tehran',
  }).format(date);
}

export function InformeeParticipantAccess({ currentUserId }: Props) {
  const [meetings, setMeetings] = useState<InformeeMeetingOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showMeetingPicker, setShowMeetingPicker] = useState(false);
  const [selectedMeeting, setSelectedMeeting] = useState<InformeeMeetingOption | null>(null);

  const loadMeetings = useCallback(async () => {
    try {
      const rows = await fetchInformeeMeetings(currentUserId);
      setMeetings(rows);
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => { void loadMeetings(); }, [loadMeetings]);

  const openAccess = () => {
    if (meetings.length === 1) {
      setSelectedMeeting(meetings[0]);
      return;
    }
    setShowMeetingPicker(true);
  };

  const handleParticipantAdded = (participantUserId: string) => {
    setMeetings(prev => prev.map(meeting => meeting.id === selectedMeeting?.id
      ? {
          ...meeting,
          participantUserIds: meeting.participantUserIds.includes(participantUserId)
            ? meeting.participantUserIds
            : [...meeting.participantUserIds, participantUserId],
        }
      : meeting));
    setSelectedMeeting(null);
    toast.success('فهرست شرکت‌کنندگان جلسه به‌روزرسانی شد');
  };

  if (loading || meetings.length === 0) return null;

  return (
    <>
      <button
        onClick={openAccess}
        className="fixed bottom-5 left-5 z-[55] inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3.5 py-2.5 text-xs font-bold text-white shadow-lg transition hover:bg-blue-700"
        title="افزودن شرکت‌کننده به جلساتی که در بخش مطلعین آن‌ها هستید"
      >
        <UserPlus className="h-4 w-4" />
        افزودن شرکت‌کننده
      </button>

      {showMeetingPicker && typeof document !== 'undefined' && createPortal(
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 px-4" dir="rtl" onClick={() => setShowMeetingPicker(false)}>
          <div className="flex max-h-[78vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
              <div>
                <h3 className="text-base font-bold text-gray-900 dark:text-white">انتخاب جلسه</h3>
                <p className="mt-0.5 text-xs text-gray-400">جلساتی که شما در بخش مطلعین آن‌ها هستید</p>
              </div>
              <button onClick={() => setShowMeetingPicker(false)} className="rounded-lg p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="بستن">
                <X className="h-5 w-5 text-gray-500" />
              </button>
            </div>
            <div className="flex-1 space-y-1 overflow-y-auto p-3">
              {meetings.map(meeting => (
                <button
                  key={meeting.id}
                  onClick={() => { setSelectedMeeting(meeting); setShowMeetingPicker(false); }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right transition hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-900/30 dark:text-blue-300">
                    <CalendarDays className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{meeting.subject}</p>
                    <p className="mt-0.5 text-xs text-gray-400">
                      {formatDate(meeting.requestDate)}
                      {meeting.startTime ? ` · ${meeting.startTime.slice(0, 5)}` : ''}
                    </p>
                  </div>
                  <UserPlus className="h-4 w-4 flex-shrink-0 text-blue-500" />
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}

      {selectedMeeting && (
        <InformeeAddParticipantModal
          meetingId={selectedMeeting.id}
          currentUserId={currentUserId}
          organizerId={selectedMeeting.organizerId}
          existingParticipantIds={selectedMeeting.participantUserIds}
          onClose={() => setSelectedMeeting(null)}
          onSuccess={handleParticipantAdded}
        />
      )}
    </>
  );
}
