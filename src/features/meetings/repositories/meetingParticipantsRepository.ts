import { supabase } from '../../../lib/supabase';

export interface MeetingParticipantSnapshotInput {
  name: string;
}

export async function insertMeetingParticipantSnapshots(
  meetingId: string,
  participants: MeetingParticipantSnapshotInput[]
): Promise<void> {
  // Silent error behavior intentionally preserved until behavior tests exist.
  await supabase
    .from('participants')
    .insert(
      participants.map((participant) => ({
        meeting_id: meetingId,
        name: participant.name,
      }))
    );
}
