export interface AgendaItem {
  id: string;
  meeting_id: string;
  title: string;
  presenter: string | null;
  duration_minutes: number | null;
  sort_order: number;
  created_at?: string;
}

export interface Meeting {
  id: string;
  subject: string;
  requestDate: string;
  request_jalaali_date?: string | null;
  duration: string;
  location: string;
  representative: string;
  phone: string;
  notes: string | null;
  priority: 'high' | 'medium' | 'low';
  status: 'open' | 'closed' | 'archived';
  status_type: 'requested' | 'approved' | 'rejected';
  participants: string[];
  actions: Action[];
  created_at?: string;
  user_id?: string;
  guest_emails?: string[];
  start_time?: string | null;
  end_time?: string | null;
  repeat_type?: string | null;
  repeat_interval?: number | null;
  repeat_end_date?: string | null;
  repeat_weekday?: number | null;
  calendar_id?: string | null;
  members_only?: boolean;
  archived_participant_ids?: string[] | null;
}

export interface Action {
  id: string;
  title: string;
  status: 'open' | 'closed';
  assignee: string;
  meeting_id: string;
  created_at?: string;
}

export interface Participant {
  id: string;
  name: string;
  meeting_id: string;
  created_at?: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'high' | 'medium' | 'low';
  due_date: string;
  assignee: string;
  created_at?: string;
  user_id?: string;
  archived: boolean;
  source_message_id?: string | null;
  source_message_body?: string | null;
  current_assignee_id?: string | null;
  created_by_id?: string | null;
}

export interface TaskWorkflowStep {
  id: string;
  task_id: string;
  actor_id: string;
  action: 'created' | 'referred' | 'accepted' | 'completed' | 'rejected' | 'note_added';
  from_user_id?: string | null;
  to_user_id?: string | null;
  note?: string;
  created_at: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  drawing_data?: string;
  created_at: string;
  user_id: string;
}

export interface ContactEmail {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  user_id: string;
  created_at?: string;
}

export interface ChatMessage {
  id: string;
  sender_id: string;
  sender_name: string;
  content: string;
  file_url?: string;
  file_type?: string;
  file_name?: string;
  created_at: string;
  recipient_id?: string;
  meeting_id?: string;
  meeting_data?: Meeting;
  is_meeting_invite?: boolean;
  meeting_status?: 'pending' | 'accepted' | 'rejected';
}