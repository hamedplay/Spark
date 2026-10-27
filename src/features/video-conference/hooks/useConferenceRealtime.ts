import { useConferenceLiveData } from './useConferenceLiveData';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  refreshMessages: () => Promise<void>;
  refreshParticipants: () => Promise<void>;
  refreshRoomState: () => Promise<void>;
}

export function useConferenceRealtime({ client, roomId, refreshMessages, refreshParticipants, refreshRoomState }: Params) {
  useConferenceLiveData(['conference_messages','conference_message_reactions','conference_message_mentions'], refreshMessages, client, roomId);
  useConferenceLiveData(['conference_participants'], refreshParticipants, client, roomId);
  useConferenceLiveData(['conference_rooms','conference_recordings','conference_recording_consents'], refreshRoomState, client, roomId);
}
