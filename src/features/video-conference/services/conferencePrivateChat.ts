import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  ConferencePrivateChatAction,
  ConferencePrivateMessageRow,
} from '../types/conference.types';

export class ConferencePrivateChatActionError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ConferencePrivateChatActionError';
    this.code = code;
  }
}

interface PrivateChatActionInput {
  roomId: string;
  action: ConferencePrivateChatAction;
  messageId?: string;
  peerUserId?: string;
  body?: string;
  replyToId?: string;
}

export async function loadConferencePrivateMessages(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferencePrivateMessageRow[]> {
  const { data, error } = await client
    .from('conference_private_messages')
    .select('id,room_id,sender_id,recipient_id,sender_name,recipient_name,body,reply_to_id,reply_to_body,reply_to_sender_name,is_deleted,edited_at,deleted_at,deleted_by,read_at,created_at,updated_at')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw error;
  return [...(data || [])].reverse() as ConferencePrivateMessageRow[];
}

export async function runConferencePrivateChatAction(
  client: ConferenceSupabaseClient,
  input: PrivateChatActionInput,
) {
  const { data, error } = await client.functions.invoke(
    'conference-private-chat-control',
    { body: input },
  );

  if (error || !data?.ok) {
    throw new ConferencePrivateChatActionError(
      String(data?.error || error?.message || 'PRIVATE_CHAT_ACTION_FAILED'),
    );
  }

  return data;
}
