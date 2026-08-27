import type { Room } from 'livekit-client';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type { ConferenceReactionEvent } from '../types/conference.types';

export class ConferenceReactionError extends Error {
  code: string;
  retryAfterMs: number;

  constructor(code: string, retryAfterMs = 0) {
    super(code);
    this.name = 'ConferenceReactionError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export async function setConferenceMicrophone(room: Room, enabled: boolean) {
  await room.localParticipant.setMicrophoneEnabled(enabled);
}

export async function setConferenceCamera(room: Room, enabled: boolean) {
  await room.localParticipant.setCameraEnabled(enabled, undefined, enabled ? { simulcast: true } : undefined);
}

export async function setConferenceScreenShare(room: Room, enabled: boolean) {
  await room.localParticipant.setScreenShareEnabled(enabled);
}

export async function publishConferenceReaction(
  client: ConferenceSupabaseClient,
  roomId: string,
  reaction: string,
): Promise<ConferenceReactionEvent> {
  const { data, error } = await client.functions.invoke('conference-reaction', {
    body: { roomId, reaction },
  });

  if (error || !data?.ok || !data?.event) {
    throw new ConferenceReactionError(
      String(data?.error || error?.message || 'REACTION_SEND_FAILED'),
      Number(data?.retryAfterMs || 0),
    );
  }

  return data.event as ConferenceReactionEvent;
}
