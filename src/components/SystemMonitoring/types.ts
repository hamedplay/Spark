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
