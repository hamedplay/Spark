export type ChatMessageType = 'normal' | 'important' | 'urgent' | 'confidential';
export type MessageStatus = 'pending' | 'in_progress' | 'done';

export interface ChatConversation {
  id: string;
  participant_a: string;
  participant_b: string;
  created_at: string;
  last_message_text: string | null;
  last_message_at: string | null;
  last_message_sender_id: string | null;
  pinned_for_a: boolean;
  pinned_for_b: boolean;
  deleted_for_a: boolean;
  deleted_for_b: boolean;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string | null;
  message_type: ChatMessageType;
  status: MessageStatus;
  reply_to_id: string | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  voice_url: string | null;
  voice_duration: number | null;
  is_edited: boolean;
  is_pinned: boolean;
  is_forwarded: boolean;
  forwarded_from_name: string | null;
  deleted_for_sender: boolean;
  deleted_for_all: boolean;
  read_by: string[];
  mentioned_user_ids: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface ChatMessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface ChatMessageStar {
  id: string;
  message_id: string;
  user_id: string;
  created_at: string;
}

export interface ReactionCount {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface UserProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
  status?: string | null;
  is_online?: boolean | null;
  last_seen?: string | null;
}

export interface ConversationWithProfile extends ChatConversation {
  otherUser: UserProfile;
  unreadCount: number;
  hasMention: boolean;
  mentionMessageId: string | null;
  isPinned: boolean;
}

export interface MessageWithMeta extends ChatMessage {
  senderProfile: UserProfile | null;
  reactions: ReactionCount[];
  isStarred: boolean;
  replyTarget: ChatMessage | null;
  tags: ChatTag[];
}

export interface ChatTag {
  id: string;
  name: string;
  color: string;
  user_id: string;
}

export interface ChatReminder {
  id: string;
  message_id: string;
  user_id: string;
  remind_at: string;
  note: string;
  is_dismissed: boolean;
  created_at: string;
}
