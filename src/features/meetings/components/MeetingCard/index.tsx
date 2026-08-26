import { useState } from 'react';
import { Video, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { Meeting } from '../../../../types';
import { createMeetingConference } from '../../../video-conference/services/conferenceApi';
import { MeetingCardMain } from './MeetingCardMain';

interface MeetingCardProps {
  meeting: Meeting;
  onUpdate: () => void;
  onScheduleInCalendar?: (meeting: Meeting) => void;
  onOpenVideoConference?: () => void;
}

export function MeetingCard({ meeting, onUpdate, onScheduleInCalendar, onOpenVideoConference }: MeetingCardProps) {
  const [openingConference, setOpeningConference] = useState(false);

  const handleOpenConference = async () => {
    if (openingConference) return;
    setOpeningConference(true);
    try {
      const room = await createMeetingConference(meeting.id);
      sessionStorage.setItem('spark_pending_sfu_room_id', String(room.id));
      onOpenVideoConference?.();
      toast.success('اتاق امن ویدیوکنفرانس آماده است');
      void onUpdate();
    } catch (error) {
      console.error('[MeetingCard] create meeting conference failed', error);
      toast.error('ایجاد ویدیوکنفرانس این جلسه ناموفق بود');
    } finally {
      setOpeningConference(false);
    }
  };

  return (
    <div className="min-w-0">
      <MeetingCardMain meeting={meeting} onUpdate={onUpdate} onScheduleInCalendar={onScheduleInCalendar} />
      {meeting.status === 'open' && meeting.status_type === 'approved' && onOpenVideoConference && (
        <button
          type="button"
          onClick={() => void handleOpenConference()}
          disabled={openingConference}
          className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-violet-600 to-indigo-600 px-3 text-xs font-bold text-white shadow-sm transition hover:from-violet-500 hover:to-indigo-500 disabled:cursor-wait disabled:opacity-60"
          aria-label="ورود به ویدیوکنفرانس این جلسه"
        >
          {openingConference ? <Loader2 className="h-4 w-4 animate-spin" /> : <Video className="h-4 w-4" />}
          {openingConference ? 'در حال آماده‌سازی…' : 'ویدیوکنفرانس جلسه'}
        </button>
      )}
    </div>
  );
}
