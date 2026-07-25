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
