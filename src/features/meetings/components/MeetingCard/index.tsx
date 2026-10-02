import { Meeting } from '../../../../types';
import { MeetingCardMain } from './MeetingCardMain';

interface MeetingCardProps {
  meeting: Meeting;
  onUpdate: () => void;
  onScheduleInCalendar?: (meeting: Meeting) => void;
  currentUserId?: string | null;
  prefetchedReadModel?: MeetingCardPrefetchedReadModel;
}

export function MeetingCard({ meeting, onUpdate, onScheduleInCalendar, currentUserId, prefetchedReadModel }: MeetingCardProps) {
  return (
    <MeetingCardMain
      meeting={meeting}
      currentUserId={currentUserId}
      prefetchedReadModel={prefetchedReadModel}
      onUpdate={onUpdate}
      onScheduleInCalendar={onScheduleInCalendar}
    />
  );
}
