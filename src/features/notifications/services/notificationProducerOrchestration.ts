import {
  renderTemplate,
  validatePayloadForEvent,
} from '../../../config/templateCatalog';
import type {
  NotifyPayload,
  SmsDispatchResult,
  NotificationTemplate,
} from '../types/notificationProducer';
import {
  resolveNotificationAudience,
  resolveNotificationTemplate,
  resolveSmsTemplateBody,
  resolveNotificationChannels,
  buildBaleNotificationText,
} from '../models/notificationProducerModel';
import type {
  CreateInAppNotificationInput,
  CreateInAppNotificationResult,
} from '../repositories/inAppNotificationRepository';
import type {
  DispatchSmsNotificationInput,
} from '../gateways/smsNotificationGateway';

export function fillPlaceholders(
  text: string,
  variables:
    Record<string, string>
): string {
  const result =
    renderTemplate(
      text,
      variables
    );

  if (
    import.meta.env?.DEV &&
    (result.missingPlaceholders.length >
      0 ||
      result.unresolvedPlaceholders.length >
        0)
  ) {
    console.warn(
      '[notifications] template issues:',
      {
        missing:
          result.missingPlaceholders,
        unresolved:
          result.unresolvedPlaceholders,
      }
    );
  }

  return result.text;
}

export interface NotificationProducerDependencies {
  getNotificationTemplates:
    () =>
      Promise<
        Map<
          string,
          NotificationTemplate
        >
      >;

  getSmsTemplates:
    () =>
      Promise<
        Map<string, string>
      >;

  createInAppNotification:
    (
      input:
        CreateInAppNotificationInput
    ) =>
      Promise<
        CreateInAppNotificationResult
      >;

  dispatchSms:
    (
      input:
        DispatchSmsNotificationInput
    ) =>
      Promise<
        SmsDispatchResult
      >;

  dispatchBale:
    (
      userId: string,
      text: string
    ) => Promise<void>;
}

export async function produceNotificationWithDependencies(
  payload: NotifyPayload,
  dependencies:
    NotificationProducerDependencies
): Promise<SmsDispatchResult> {
  const templates =
    await dependencies.getNotificationTemplates();
  const audience =
    resolveNotificationAudience(
      payload.audience
    );
  const template =
    resolveNotificationTemplate(
      templates,
      payload.category,
      payload.eventType,
      audience
    );

  const variables =
    payload.placeholders || {};

  if (import.meta.env?.DEV) {
    console.debug(
      '[notification-template]',
      {
        category: payload.category,
        eventType: payload.eventType,
        audience,
        recipientId: payload.userId,
        templateId:
          template?.id ?? null,
        templateBody:
          template?.body ?? null,
        payload: variables,
      }
    );

    const payloadValidation =
      validatePayloadForEvent(
        payload.eventType,
        variables
      );

    if (!payloadValidation.valid) {
      console.warn(
        '[notification-template] payload validation failed:',
        {
          eventType:
            payload.eventType,
          missingRequiredValues:
            payloadValidation.missingRequiredValues,
          emptyRequiredValues:
            payloadValidation.emptyRequiredValues,
          recipientId: payload.userId,
        }
      );
    }
  }

  const title = template
    ? fillPlaceholders(
        template.title,
        variables
      )
    : payload.fallbackTitle;

  const message = template
    ? fillPlaceholders(
        template.body,
        variables
      )
    : payload.fallbackMessage;

  const channels =
    resolveNotificationChannels(
      payload.channels
    );

  if (channels.inAppEnabled) {
    const result =
      await dependencies.createInAppNotification(
        {
          payload,
          title,
          message,
          audience,
        }
      );

    if (result.status === 'failed') {
      return {
        ok: false,
        status: 'failed',
        errorCode: 'RPC_ERROR',
        error: result.errorMessage,
      };
    }

    if (result.status === 'duplicate') {
      return {
        ok: true,
        status: 'skipped',
        reason:
          'DUPLICATE_EVENT_KEY',
      };
    }
  }

  let smsResult: SmsDispatchResult = {
    ok: true,
    status: 'skipped',
    reason:
      'CHANNEL_DISABLED',
  };

  if (channels.smsEnabled) {
    const smsTemplates =
      await dependencies.getSmsTemplates();
    const smsBody =
      resolveSmsTemplateBody(
        smsTemplates,
        payload.category,
        payload.eventType,
        audience,
        message
      );
    const smsMessage =
      fillPlaceholders(
        smsBody,
        variables
      );

    smsResult =
      await dependencies.dispatchSms(
        {
          userId: payload.userId,
          category: payload.category,
          eventType:
            payload.eventType,
          audience,
          message: smsMessage,
          context: variables,
          senderId:
            payload.senderId,
        }
      );
  }

  if (channels.baleEnabled) {
    const baleText =
      buildBaleNotificationText(
        title,
        message
      );

    void dependencies.dispatchBale(
      payload.userId,
      baleText
    );
  }

  return smsResult;
}
