export type ChannelType = 'channel' | 'group';
export type MemberRole = 'admin' | 'member';
export type ChannelMessageType = 'normal' | 'important' | 'urgent' | 'confidential' | 'system';
export type TopicStatus = 'open' | 'in_progress' | 'done' | 'cancelled';
export type TopicPriority = 'low' | 'medium' | 'high' | 'urgent';

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  type: ChannelType;
  is_private: boolean;
  created_by: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  member_count: number;
  created_at: string;
}

export interface ChannelMember {
  id: string;
  channel_id: string;
  user_id: string;
  role: MemberRole;
  joined_at: string;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  sender_id: string | null;
  body: string | null;
  message_type: ChannelMessageType;
  reply_to_id: string | null;
  is_pinned: boolean;
  pinned_by: string | null;
  is_edited: boolean;
  deleted_for_all: boolean;
  read_by: string[];
  mentioned_user_ids: string[] | null;
  file_url: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  voice_url: string | null;
  voice_duration: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChannelMessageReaction {
  id: string;
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface WorkTopic {
  id: string;
  channel_id: string;
  title: string;
  description: string | null;
  status: TopicStatus;
  priority: TopicPriority;
  assignee_id: string | null;
  deadline: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  assignee?: { full_name: string | null; email: string | null } | null;
}

export interface ChannelProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

export interface ReactionCount {
  emoji: string;
  count: number;
  reactedByMe: boolean;
}

export interface MessageWithMeta extends ChannelMessage {
  senderProfile: ChannelProfile | null;
  reactions: ReactionCount[];
  replyTarget: ChannelMessage | null;
  isStarred: boolean;
}

export interface ChannelWithMeta extends Channel {
  myRole: MemberRole | null;
  unreadCount: number;
}

export interface GroupTaskActivity {
  id: string;
  group_task_id: string;
  user_id: string;
  note: string;
  created_at: string;
}

export interface GroupTask {
  id: string;
  channel_id: string;
  message_id: string | null;
  title: string;
  body: string | null;
  created_by: string;
  status: 'open' | 'done' | 'archived';
  created_at: string;
  assignments?: GroupTaskAssignment[];
  activities?: GroupTaskActivity[];
  creatorProfile?: ChannelProfile | null;
}

export interface GroupTaskAssignment {
  id: string;
  group_task_id: string;
  assignee_id: string;
  status: 'pending' | 'done' | 'archived';
  created_at: string;
  assigneeProfile?: ChannelProfile | null;
}
