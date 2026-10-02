import { Meeting } from '../../../../types';
import { MeetingCardMain } from './MeetingCardMain';

interface MeetingCardProps {
  meeting: Meeting;
  onUpdate: () => void;
  onScheduleInCalendar?: (meeting: Meeting) => void;
  currentUserId?: string | null;
}

export function MeetingCard({ meeting, onUpdate, onScheduleInCalendar, currentUserId }: MeetingCardProps) {
  return (
    <MeetingCardMain
      meeting={meeting}
      currentUserId={currentUserId}
      onUpdate={onUpdate}
      onScheduleInCalendar={onScheduleInCalendar}
    />
  );
}
