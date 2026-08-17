export interface NotifyChannels {
  inApp?: boolean;
  sms?: boolean;
  bale?: boolean;
}

export interface NotifyPayload {
  userId: string;

  category: string;
  eventType: string;
  audience?: string;

  fallbackTitle: string;
  fallbackMessage: string;

  placeholders?:
    Record<string, string>;

  senderId?: string | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;

  actionUrl?: string | null;

  channels?: NotifyChannels;

  eventKey?: string | null;
}

export interface SmsDispatchResult {
  ok: boolean;

  status:
    | 'sent'
    | 'skipped'
    | 'failed';

  reason?: string;
  errorCode?: string;
  error?: string;
}

export interface NotificationTemplateRow {
  id: string;
  category: string;
  event_type: string;
  audience: string;
  title: string;
  body: string;
  updated_at: string;
}

export interface NotificationTemplate {
  id: string;
  title: string;
  body: string;
  updatedAt: string;
}

export interface SmsTemplateRow {
  category: string;
  event_type: string;
  audience: string;
  body: string;
}

export interface NotificationChannelSelection {
  inAppEnabled: boolean;
  smsEnabled: boolean;
  baleEnabled: boolean;
}
