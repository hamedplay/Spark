import { loadSmsDeliveryPolicy, evaluateSmsDeliveryPolicy } from '../_shared/smsDeliveryPolicy.ts';

type Transport = (body: Record<string, unknown>) => Promise<any>;
export async function processNoteReminderJobs(client: any, jobs: any[], sendSms: Transport,
  sendBale: (userId: string, text: string) => Promise<{ status: string; reason: string | null }>,
  policies = { load: loadSmsDeliveryPolicy, evaluate: evaluateSmsDeliveryPolicy }) {
  return Promise.all(jobs.map(async job => {
    let status = 'uncertain'; let reason: string | null = null; let availableAt: string | null = null;
    try {
      if (job.channel === 'bale') {
        const result = await sendBale(job.recipient_id, job.message);
        status = result.status; reason = result.reason;
      } else {
        const policy = await policies.load(client, 'note', 'reminder');
        const window = policies.evaluate(policy, new Date(), new Date(job.remind_at));
        if (!window.sendNow && window.nextAllowedAt) {
          status = 'pending'; availableAt = window.nextAllowedAt.toISOString(); reason = 'SMS_DEFERRED_BY_POLICY';
        } else {
          const response = await sendSms({ mode: 'dispatch', targetUserId: job.recipient_id,
            category: 'note', eventType: 'reminder', audience: 'all', eventKey: `note-reminder:${job.id}`,
            triggeredByUserId: job.owner_id, message: job.message,
            context: { note_title: job.note_title, note_content: job.note_content, sms_policy_deferred_delivery: true } });
          const result = response.data;
          if (result?.status === 'sent' || result?.sent > 0 || (result?.reason === 'DUPLICATE_SMS_DISPATCH' && result?.existingStatus === 'sent')) status = 'sent';
          else if (result?.reason === 'DUPLICATE_SMS_DISPATCH' && ['pending', 'processing', 'uncertain'].includes(result?.existingStatus)) reason = 'DELIVERY_OUTCOME_UNKNOWN';
          else if (['PROVIDER_TRANSPORT_ERROR', 'DELIVERY_OUTCOME_UNKNOWN'].includes(result?.errorCode)) reason = 'DELIVERY_OUTCOME_UNKNOWN';
          else if (result?.status === 'skipped' && result?.reason !== 'DUPLICATE_SMS_DISPATCH') { status = 'skipped'; reason = result.reason ?? null; }
          else if (result?.errorCode) { status = 'failed'; reason = result.errorCode; }
          else reason = 'DELIVERY_OUTCOME_UNKNOWN';
        }
      }
    } catch { reason = 'DELIVERY_OUTCOME_UNKNOWN'; }
    const finished = await client.rpc('finish_note_reminder_delivery', { p_id: job.id, p_lease: job.lease,
      p_status: status, p_error: reason, p_available_at: availableAt });
    return { status, recorded: !finished.error && finished.data === true };
  }));
}
