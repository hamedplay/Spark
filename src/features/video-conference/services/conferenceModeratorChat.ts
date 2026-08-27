import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  ConferenceModeratorChatAction,
  ConferenceModeratorMessageRow,
} from '../types/conference.types';

export class ConferenceModeratorChatActionError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ConferenceModeratorChatActionError';
    this.code = code;
  }
}

interface ModeratorChatActionInput {
  roomId: string;
  action: ConferenceModeratorChatAction;
  messageId?: string;
  body?: string;
  replyToId?: string;
}

export async function loadConferenceModeratorMessages(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferenceModeratorMessageRow[]> {
  const { data, error } = await client
    .from('conference_moderator_messages')
    .select('id,room_id,sender_id,sender_name,body,reply_to_id,reply_to_body,reply_to_sender_name,is_deleted,edited_at,deleted_at,deleted_by,created_at,updated_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) throw error;
  return [...(data || [])].reverse() as ConferenceModeratorMessageRow[];
}

export async function runConferenceModeratorChatAction(
  client: ConferenceSupabaseClient,
  input: ModeratorChatActionInput,
) {
  const { data, error } = await client.functions.invoke(
    'conference-moderator-chat-control',
    { body: input },
  );

  if (error || !data?.ok) {
    throw new ConferenceModeratorChatActionError(
      String(data?.error || error?.message || 'MODERATOR_CHAT_ACTION_FAILED'),
    );
  }

  return data;
}
