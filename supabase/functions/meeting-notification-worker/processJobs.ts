import { loadSmsDeliveryPolicy, evaluateSmsDeliveryPolicy } from '../_shared/smsDeliveryPolicy.ts';

export async function processMeetingNotificationJobs(client: any, jobs: any[], sendSms: (body: Record<string, unknown>) => Promise<any>, dependencies = { loadPolicy: loadSmsDeliveryPolicy, evaluatePolicy: evaluateSmsDeliveryPolicy }) {
  return await Promise.all((jobs || []).map(async (job: any) => {
    let status = 'uncertain'; let reason: string | null = null;
    try {
      const policy = await dependencies.loadPolicy(client, 'meeting', job.event_type);
      const decision = dependencies.evaluatePolicy(policy, new Date(), new Date(job.created_at));
      if (!decision.sendNow && decision.nextAllowedAt) {
        const postponed = await client.rpc('postpone_meeting_notification_job', { p_id: job.id, p_lease: job.lease, p_available_at: decision.nextAllowedAt.toISOString() });
        return { status: 'deferred', recorded: !postponed.error };
      }
      const body = { mode: job.recipient_id ? 'dispatch' : 'external', targetUserId: job.recipient_id,
        mobiles: job.target_phone ? [job.target_phone] : undefined, category: 'meeting', eventType: job.event_type,
        audience: job.audience, context: { ...job.context, sms_policy_deferred_delivery: true }, eventKey: job.event_key, triggeredByUserId: job.actor_id };
      const response = await sendSms(body);
      if (response.error) reason = 'DELIVERY_OUTCOME_UNKNOWN';
      else if (response.data?.status === 'sent' || response.data?.sent > 0) status = 'sent';
      else if (response.data?.reason === 'DUPLICATE_SMS_DISPATCH' && response.data?.existingStatus === 'sent') status = 'sent';
      else if (response.data?.reason === 'DUPLICATE_SMS_DISPATCH' && ['pending', 'processing', 'uncertain'].includes(response.data?.existingStatus)) reason = 'DELIVERY_OUTCOME_UNKNOWN';
      else if (['PROVIDER_TRANSPORT_ERROR', 'DELIVERY_OUTCOME_UNKNOWN'].includes(response.data?.errorCode)) reason = 'DELIVERY_OUTCOME_UNKNOWN';
      else if (response.data?.status === 'skipped') { status = 'skipped'; reason = response.data.reason ?? null; }
      else if (response.data?.reason === 'SMS_DEFERRED_BY_POLICY' || response.data?.deferred) status = 'sent'; // ownership transferred to existing delivery queue
      else { status = 'failed'; reason = response.data?.errorCode ?? response.data?.error ?? 'SMS_FAILED'; }
    } catch { reason = 'DELIVERY_OUTCOME_UNKNOWN'; }
    const completed = await client.rpc('finish_meeting_notification_job', { p_id: job.id, p_lease: job.lease, p_status: status, p_error: reason });
    return { status, recorded: !completed.error };
  }));
}
