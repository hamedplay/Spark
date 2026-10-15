interface Props {
  meetingId: string;
  currentUserId: string;
  meetingSubject: string;
  meetingDate: string | null;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  names: string[];
  canManage: boolean;
  onChanged: (names: string[]) => void;
}

/**
 * External informees are now managed while scheduling/editing the meeting in
 * CalendarMeetingForm. Keep this compatibility component temporarily so older
 * detail views can render without exposing the retired management button.
 */
export function ExternalInformeesManager(_props: Props) {
  return null;
}
