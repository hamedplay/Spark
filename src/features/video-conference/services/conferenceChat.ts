import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type { ConferenceChatAction } from '../types/conference.types';

export class ConferenceChatActionError extends Error {
  code: string;
  retryAfterMs: number;

  constructor(code: string, retryAfterMs = 0) {
    super(code);
    this.name = 'ConferenceChatActionError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

interface ChatActionInput {
  roomId: string;
  action: ConferenceChatAction;
  messageId?: string;
  body?: string;
  replyToId?: string;
  emoji?: string;
  mentionedUserIds?: string[];
  imagePath?: string;
}

export async function runConferenceChatAction(
  client: ConferenceSupabaseClient,
  input: ChatActionInput,
) {
  const { data, error } = await client.functions.invoke('conference-chat-control', {
    body: input,
  });

  if (error || !data?.ok) {
    throw new ConferenceChatActionError(
      String(data?.error || error?.message || 'CHAT_ACTION_FAILED'),
      Number(data?.retryAfterMs || 0),
    );
  }

  return data;
}
