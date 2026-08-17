import { supabase } from '../../../lib/supabase';
import type {
  SmsDispatchResult,
} from '../types/notificationProducer';

export interface DispatchSmsNotificationInput {
  userId: string;
  category: string;
  eventType: string;
  audience: string;
  message: string;
  senderId?: string | null;
}

export async function dispatchSmsNotification(
  input:
    DispatchSmsNotificationInput
): Promise<SmsDispatchResult> {
  try {
    const {
      data: result,
      error: functionError,
    } =
      await supabase.functions.invoke(
        'send-sms',
        {
          body: {
            mode: 'dispatch',

            targetUserId:
              input.userId,

            category:
              input.category,

            eventType:
              input.eventType,

            audience:
              input.audience,

            message:
              input.message,

            triggeredByUserId:
              input.senderId ?? null,
          },
        }
      );

    if (functionError) {
      throw new Error(
        functionError.message ??
          String(functionError)
      );
    }

    const row =
      result as
        | (SmsDispatchResult & {
            ok?: boolean;
            status?: string;
            reason?: string;
            errorCode?: string;
            error?: string;
          })
        | null;

    return {
      ok: row?.ok === true,

      status:
        (row?.status as
          | 'sent'
          | 'skipped'
          | 'failed') ??
        (row?.ok
          ? 'sent'
          : 'failed'),

      reason: row?.reason,

      errorCode: row?.errorCode,

      error: row?.error,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    try {
      await supabase
        .from(
          'sms_dispatch_logs'
        )
        .insert({
          target_user_id:
            input.userId,

          triggered_by_user_id:
            input.senderId ?? null,

          category:
            input.category,

          event_type:
            input.eventType,

          audience:
            input.audience,

          message:
            input.message,

          target_phone: null,

          status: 'failed',

          error_text:
            `CLIENT_INVOKE_ERROR: ${message}`,
        });
    } catch {
      // ignore secondary logging failure
    }

    return {
      ok: false,
      status: 'failed',
      errorCode:
        'CLIENT_INVOKE_ERROR',
      error: message,
    };
  }
}
