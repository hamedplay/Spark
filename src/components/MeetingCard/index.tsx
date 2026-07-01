import { Meeting } from '../../types';
import { MeetingCardMain } from './MeetingCardMain';

interface MeetingCardProps {
  meeting: Meeting;
  onUpdate: () => void;
  onScheduleInCalendar?: (meeting: Meeting) => void;
}

export function MeetingCard({ meeting, onUpdate, onScheduleInCalendar }: MeetingCardProps) {
  return <MeetingCardMain meeting={meeting} onUpdate={onUpdate} onScheduleInCalendar={onScheduleInCalendar} />;
}