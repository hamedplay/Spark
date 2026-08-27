import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type { SpeakerQueueAction } from '../types/conference.types';

export async function runConferenceSpeakerQueueAction(
  client: ConferenceSupabaseClient,
  roomId: string,
  targetUserId: string,
  action: SpeakerQueueAction,
  seconds?: number,
) {
  const { data, error } = await client.functions.invoke(
    'conference-speaker-queue-control',
    {
      body: {
        roomId,
        targetUserId,
        action,
        seconds,
      },
    },
  );

  if (error || !data?.ok) {
    throw new Error(
      String(data?.error || error?.message || 'SPEAKER_QUEUE_ACTION_FAILED'),
    );
  }

  return data;
}
