import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type { ConferenceMessageRow, ParticipantRow, RecordingRow, WaitingRow } from '../types/conference.types';

export async function loadConferenceMessages(client: ConferenceSupabaseClient, roomId: string): Promise<ConferenceMessageRow[]> {
  const { data, error } = await client.from('conference_messages')
    .select('id,user_id,display_name,body,created_at,is_deleted')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  return (data || []) as ConferenceMessageRow[];
}

export async function loadConferenceParticipants(client: ConferenceSupabaseClient, roomId: string): Promise<ParticipantRow[]> {
  const { data, error } = await client.rpc('get_conference_participants_rbac', {
    p_room_id: roomId,
  });
  if (error) throw error;
  return (data || []) as ParticipantRow[];
}

export async function loadConferenceRoomState(client: ConferenceSupabaseClient, roomId: string): Promise<{ locked: boolean | undefined; recording: RecordingRow | null }> {
  const { data: roomData } = await client.from('conference_rooms')
    .select('is_locked')
    .eq('id', roomId)
    .maybeSingle();

  const { data: recordingRows } = await client.from('conference_recordings')
    .select('id,status,created_at')
    .eq('room_id', roomId)
    .in('status', ['queued', 'recording', 'processing'])
    .order('created_at', { ascending: false })
    .limit(1);

  return {
    locked: roomData ? Boolean(roomData.is_locked) : undefined,
    recording: (recordingRows?.[0] as RecordingRow | undefined) || null,
  };
}

export async function loadWaitingRows(client: ConferenceSupabaseClient, roomId: string): Promise<WaitingRow[]> {
  const { data } = await client.from('conference_waiting_room')
    .select('id,user_id,display_name,status,requested_at')
    .eq('room_id', roomId)
    .eq('status', 'waiting')
    .order('requested_at', { ascending: true });
  return (data || []) as WaitingRow[];
}
