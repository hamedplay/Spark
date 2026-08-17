export interface AppNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;

  user_id?: string;

  sender_id?: string | null;
  sender_name?: string | null;
  sender_avatar_url?: string | null;

  action_url?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  minute_id?: string | null;

  metadata?:
    Record<string, unknown> | null;

  template_event_type?:
    string | null;
}

export interface NotificationGroup {
  label: string;
  items: AppNotification[];
}
