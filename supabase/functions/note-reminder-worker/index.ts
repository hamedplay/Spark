import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { processNoteReminderJobs } from './processJobs.ts';
import { deliverBaleNotification } from '../_shared/baleDelivery.ts';
import { handleSendSms } from '../send-sms/handler.ts';
import { invokeSmsHandler } from '../meeting-notification-worker/invokeSmsHandler.ts';

Deno.serve(async (request: Request) => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (request.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const token = request.headers.get('X-Note-Worker-Token');
  if (!token) return json({ error: 'UNAUTHORIZED' }, 401);
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const client = createClient(Deno.env.get('SUPABASE_URL')!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const verified = await client.rpc('verify_note_reminder_worker_token', { p_candidate: token });
    if (verified.error) return json({ error: 'VERIFICATION_UNAVAILABLE' }, 503);
    if (verified.data !== true) return json({ error: 'UNAUTHORIZED' }, 403);
    const claimed = await client.rpc('claim_note_reminder_deliveries', { p_limit: 25 });
    if (claimed.error) return json({ error: 'CLAIM_FAILED' }, 503);
    const results = await processNoteReminderJobs(client, claimed.data || [],
      body => invokeSmsHandler(handleSendSms, key, body),
      (userId, text) => deliverBaleNotification(client, userId, text));
    return json({ processed: results.length, sent: results.filter(r => r.status === 'sent').length,
      uncertain: results.filter(r => r.status === 'uncertain').length, failed: results.filter(r => !r.recorded || r.status === 'failed').length });
  } catch { return json({ error: 'WORKER_FAILED' }, 500); }
});
