import { useEffect } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  refreshMessages: () => Promise<void>;
  refreshParticipants: () => Promise<void>;
  refreshRoomState: () => Promise<void>;
}

export function useConferenceRealtime({ client, roomId, refreshMessages, refreshParticipants, refreshRoomState }: Params) {
  useEffect(() => {
    const channel = client.channel(`sfu-collab-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_messages', filter: `room_id=eq.${roomId}` }, () => void refreshMessages())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_participants', filter: `room_id=eq.${roomId}` }, () => void refreshParticipants())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conference_rooms', filter: `id=eq.${roomId}` }, () => void refreshRoomState())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conference_recordings', filter: `room_id=eq.${roomId}` }, () => void refreshRoomState())
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [client, refreshMessages, refreshParticipants, refreshRoomState, roomId]);
}
