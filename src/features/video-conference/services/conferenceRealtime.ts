import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  ConferenceMessageReactionRow,
  ConferenceMessageRow,
  ConferenceWaitingState,
  ParticipantRow,
  RecordingRow,
  WaitingRow,
} from '../types/conference.types';

export async function loadConferenceMessages(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferenceMessageRow[]> {
  const { data, error } = await client.from('conference_messages')
    .select('id,user_id,display_name,body,created_at,reply_to_id,reply_to_body,reply_to_name,edited_at,deleted_at,deleted_by,is_deleted')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const rows = [...(data || [])].reverse();
  if (rows.length === 0) return [];

  const messageIds = rows.map((row) => row.id);
  const [{ data: reactionRows, error: reactionError }, { data: mentionRows, error: mentionError }] = await Promise.all([
    client.from('conference_message_reactions')
      .select('message_id,user_id,emoji,created_at')
      .eq('room_id', roomId)
      .in('message_id', messageIds),
    client.from('conference_message_mentions')
      .select('message_id,mentioned_user_id')
      .eq('room_id', roomId)
      .in('message_id', messageIds),
  ]);

  if (reactionError) throw reactionError;
  if (mentionError) throw mentionError;

  const reactionsByMessage = new Map<string, ConferenceMessageReactionRow[]>();
  for (const reaction of reactionRows || []) {
    const current = reactionsByMessage.get(reaction.message_id) || [];
    current.push({
      user_id: reaction.user_id,
      emoji: reaction.emoji,
      created_at: reaction.created_at,
    });
    reactionsByMessage.set(reaction.message_id, current);
  }

  const mentionsByMessage = new Map<string, string[]>();
  for (const mention of mentionRows || []) {
    const current = mentionsByMessage.get(mention.message_id) || [];
    current.push(mention.mentioned_user_id);
    mentionsByMessage.set(mention.message_id, current);
  }

  return rows.map((row) => ({
    ...row,
    reactions: reactionsByMessage.get(row.id) || [],
    mentioned_user_ids: mentionsByMessage.get(row.id) || [],
  })) as ConferenceMessageRow[];
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
    .select('id,status,created_at,started_at,ended_at,duration_seconds,size_bytes,storage_path,provider_egress_id')
    .eq('room_id', roomId)
    .in('status', ['queued', 'starting', 'recording', 'stopping', 'processing'])
    .order('created_at', { ascending: false })
    .limit(1);

  return {
    locked: roomData ? Boolean(roomData.is_locked) : undefined,
    recording: (recordingRows?.[0] as RecordingRow | undefined) || null,
  };
}

export async function loadWaitingRows(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<WaitingRow[]> {
  const { data, error } = await client.rpc(
    'get_livekit_waiting_room_snapshot',
    { p_room_id: roomId },
  );
  if (error) throw error;
  if (!data?.ok) {
    throw new Error(String(data?.reason || 'WAITING_ROOM_LOAD_FAILED'));
  }
  return (data.rows || []) as WaitingRow[];
}

export async function loadMyWaitingState(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferenceWaitingState> {
  const { data, error } = await client.rpc(
    'get_livekit_waiting_room_state',
    { p_room_id: roomId },
  );
  if (error) throw error;
  if (!data?.ok) {
    throw new Error(String(data?.reason || 'WAITING_ROOM_STATE_FAILED'));
  }

  return {
    status: data.status ?? null,
    requestedAt: data.requestedAt ?? null,
    expiresAt: data.expiresAt ?? null,
    resolvedAt: data.resolvedAt ?? null,
    serverTime: data.serverTime || new Date().toISOString(),
  };
}
