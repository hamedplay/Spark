import { supabase } from '../../../lib/supabase';
import type {
  NotifyPayload,
} from '../types/notificationProducer';
import {
  isDuplicateNotificationRpcResult,
} from '../models/notificationProducerModel';

export interface CreateInAppNotificationInput {
  payload: NotifyPayload;
  title: string;
  message: string;
  audience: string;
}

export type CreateInAppNotificationResult =
  | {
      status: 'created';
    }
  | {
      status: 'duplicate';
    }
  | {
      status: 'failed';
      errorMessage: string;
    };

export async function createInAppNotification(
  input:
    CreateInAppNotificationInput
): Promise<
  CreateInAppNotificationResult
> {
  const {
    data: rpcResult,
    error: rpcError,
  } = await supabase.rpc(
    'create_notification',
    {
      p_user_id:
        input.payload.userId,

      p_title:
        input.title,

      p_message:
        input.message,

      p_type:
        input.payload.category as
          | 'meeting'
          | 'task'
          | 'note'
          | 'chat'
          | 'channel'
          | 'call'
          | 'system',

      p_action_url:
        input.payload.actionUrl ??
        null,

      p_template_category:
        input.payload.category,

      p_template_event_type:
        input.payload.eventType,

      p_template_audience:
        input.audience,

      p_metadata:
        input.payload.placeholders ??
        {},

      p_event_key:
        input.payload.eventKey ??
        null,
    }
  );

  if (rpcError) {
    return {
      status: 'failed',
      errorMessage:
        rpcError.message,
    };
  }

  if (
    isDuplicateNotificationRpcResult(
      rpcResult
    )
  ) {
    return { status: 'duplicate' };
  }

  return { status: 'created' };
}
