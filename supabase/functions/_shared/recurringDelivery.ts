import { processMeetingNotificationJobs } from '../meeting-notification-worker/processJobs.ts';
import { invokeSmsHandler } from '../meeting-notification-worker/invokeSmsHandler.ts';
import { handleSendSms } from '../send-sms/handler.ts';
import { deliverBaleNotification } from './baleDelivery.ts';

export async function runMeetingNotificationBatch(client: any, serviceKey: string, actorId?: string, seriesId?: string) {
  const scoped = Boolean(actorId);
  const { data: jobs, error } = await client.rpc(scoped ? 'claim_actor_meeting_notification_jobs' : 'claim_recurring_delivery_jobs',
    scoped ? { p_actor_id: actorId, p_series_id: seriesId, p_limit: 25 } : { p_limit: 25 });
  if (error) throw new Error('MEETING_DELIVERY_CLAIM_FAILED');
  const results = await processMeetingNotificationJobs(client, jobs || [],
    body => invokeSmsHandler(handleSendSms, serviceKey, body), undefined,
    (userId, text) => deliverBaleNotification(client, userId, text));
  await client.rpc('record_meeting_delivery_run', { p_processed: results.length, p_background: !scoped });
  const backlog = await client.rpc('get_meeting_delivery_backlog', { p_actor_id: actorId ?? null, p_series_id: seriesId ?? null });
  return { processed: results.length, more: backlog.error ? (jobs || []).length === 25 : Number(backlog.data) > 0,
    failed: results.filter(r => r.status === 'failed').length,
    uncertain: results.filter(r => r.status === 'uncertain').length,
    recording_failed: results.filter(r => !r.recorded).length };
}
