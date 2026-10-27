import { supabase } from '../../../lib/supabase';
import type {
  NotifyPayload,
  SmsDispatchResult,
} from '../types/notificationProducer';
import {
  produceNotificationWithDependencies,
  fillPlaceholders,
} from './notificationProducerOrchestration';
import {
  getNotificationTemplates,
  getSmsTemplates,
} from './notificationTemplateDefaults';
import {
  createInAppNotification,
} from '../repositories/inAppNotificationRepository';
import {
  dispatchSmsNotification,
} from '../gateways/smsNotificationGateway';
import {
  dispatchBaleNotification,
} from '../gateways/baleNotificationGateway';

export {
  fillPlaceholders,
  produceNotificationWithDependencies,
};

export type {
  NotificationProducerDependencies,
} from './notificationProducerOrchestration';

export async function insertNotification(
  payload: NotifyPayload
): Promise<SmsDispatchResult> {
  if (payload.category === 'meeting' && payload.meetingId && ['invite','change','cancel','meeting_created','informee_invite','informee_change','informee_cancel'].includes(payload.eventType)) {
    const { data, error } = await supabase.from('meetings').select('series_id').eq('id', payload.meetingId).maybeSingle();
    if (error) return { ok: false, status: 'failed', errorCode: 'SERIES_ROUTING_UNAVAILABLE', error: error.message };
    if ((data as any)?.series_id) return { ok: true, status: 'skipped', reason: 'SERVER_MANAGED_SERIES' };
  }
  return produceNotificationWithDependencies(
    payload,
    {
      getNotificationTemplates,
      getSmsTemplates,
      createInAppNotification,
      dispatchSms:
        dispatchSmsNotification,
      dispatchBale:
        dispatchBaleNotification,
    }
  );
}
