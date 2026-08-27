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
  context?: Record<string, string>;
  meetingId?: string | null;
  eventKey?: string | null;
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

            context:
              input.context ?? {},

            meetingId:
              input.meetingId ?? null,

            eventKey:
              input.eventKey ?? null,

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
    const functionError = error as {
      message?: string;
      context?: Response;
    };

    if (functionError?.context instanceof Response) {
      try {
        const payload = await functionError.context.clone().json() as {
          status?: 'sent' | 'skipped' | 'failed';
          reason?: string;
          errorCode?: string;
          error?: string;
        };
        return {
          ok: false,
          status: payload.status ?? 'failed',
          reason: payload.reason,
          errorCode: payload.errorCode ?? 'EDGE_FUNCTION_ERROR',
          error: payload.error ?? functionError.message ?? 'خطا در سرویس پیامک',
        };
      } catch {
        // Fall through to the network-level error below.
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : String(error);

    return {
      ok: false,
      status: 'failed',
      errorCode: 'CLIENT_NETWORK_ERROR',
      error: message,
    };
  }
}
