export interface UserGroup { id: string; name: string; display_name: string | null; }

export interface NotificationTemplate {
  id: string;
  category: string;
  event_type: string;
  audience: string;
  title: string;
  body: string;
  icon: string;
  color: string;
  placeholders: string[];
  is_active: boolean;
}

export interface NotifLog {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
  sender_name: string | null;
  action_url: string | null;
  recipient_name?: string;
  recipient_email?: string;
}
