import { supabase } from '../../../lib/supabase';
import type {
  NotificationTemplateRow,
  SmsTemplateRow,
} from '../types/notificationProducer';

export async function fetchActiveNotificationTemplateRows():
  Promise<
    NotificationTemplateRow[]
  > {
  const { data } =
    await supabase
      .from(
        'notification_templates'
      )
      .select(
        'id, category, event_type, audience, title, body, updated_at'
      )
      .eq(
        'is_active',
        true
      )
      .order(
        'updated_at',
        {
          ascending: false,
        }
      );

  return (
    data || []
  ) as NotificationTemplateRow[];
}

export async function fetchActiveSmsTemplateRows():
  Promise<SmsTemplateRow[]> {
  const { data } =
    await supabase
      .from('sms_templates')
      .select(
        'category, event_type, audience, body'
      )
      .eq(
        'is_active',
        true
      );

  return (
    data || []
  ) as SmsTemplateRow[];
}
