export interface MeetingRow {
  id: string;
  subject: string;
  request_date: string | null;
  duration: string | null;
  location: string | null;
  representative: string | null;
  phone: string | null;
  notes: string | null;
  priority: string | null;
  status: string | null;
  status_type: string | null;
  created_at: string | null;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  guest_emails: string[] | null;
  members_only: boolean | null;
  repeat_type: string | null;
  shared_count?: number;
  creator_name?: string | null;
  participants?: { id: string; name: string }[];
  actions?: { id: string; title: string; status: string; assignee: string }[];
}

export interface MeetingFlowEvent {
  label: string;
  date: string | null;
  actor?: string | null;
  icon: React.ElementType;
  color: string;
  done: boolean;
}

export interface Profile {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  due_date: string | null;
  assignee: string | null;
  created_at: string | null;
  user_id: string | null;
  archived: boolean | null;
  current_assignee_id: string | null;
  created_by_id: string | null;
  source_message_id: string | null;
  creator_name?: string | null;
  assignee_name?: string | null;
  workflow?: TaskWorkflowStep[];
}

export interface TaskWorkflowStep {
  id: string;
  task_id: string;
  actor_id: string | null;
  action: string;
  from_user_id: string | null;
  to_user_id: string | null;
  note: string | null;
  created_at: string;
  actor_name?: string | null;
  from_name?: string | null;
  to_name?: string | null;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
  sender_name?: string | null;
}

export interface ChatConversation {
  id: string;
  type: string;
  name: string | null;
  created_at: string | null;
  creator_id: string | null;
  participant_ids: string[] | null;
  last_message_at: string | null;
  creator_name?: string | null;
  message_count?: number;
  messages?: ChatMessage[];
}
