import type { MeetingData } from '../components/Calendar/types';

/**
 * Pure eligibility check: is this meeting a real calendar meeting that can
 * have minutes registered against it?
 *
 * A meeting is eligible when:
 *  - it has a valid id (a real `meetings` row, not a transient preview)
 *  - it is placed on a calendar (calendar_id present)
 *  - its status_type is the calendar-meeting marker used by the data model
 *
 * The real status_type stored for calendar meetings is 'scheduled' (verified
 * against the live `meetings` table and the `can_create_minutes_for_meeting`
 * RPC, which both use 'scheduled'). 'requested' is the unscheduled-request
 * marker and 'rejected' is a rejected request — neither is eligible.
 *
 * Backend permission is the final authority — this helper is UX-only.
 */
export function isMeetingEligibleForMinutes(meeting: Pick<MeetingData, 'id' | 'calendar_id' | 'status_type'>): boolean {
  if (!meeting.id) return false;
  if (!meeting.calendar_id) return false;
  if (meeting.status_type === 'requested') return false;
  if (meeting.status_type === 'rejected') return false;
  return meeting.status_type === 'scheduled';
}
