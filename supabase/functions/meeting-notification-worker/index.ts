import { processMeetingNotificationJobs } from './processJobs.ts';
import { handleSendSms } from '../send-sms/handler.ts';
import { invokeSmsHandler } from './invokeSmsHandler.ts';
import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

// JWT is intentionally disabled at the gateway: the DB scheduler authenticates
// with its own Vault-backed token, verified using a service-only RPC.
Deno.serve(async req => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
  const token = req.headers.get('X-Meeting-Worker-Token');
  if (!token) return new Response('unauthorized', { status: 401 });
  const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const verified = await client.rpc('verify_meeting_worker_token', { p_candidate: token });
  if (verified.error) { console.error('meeting-worker token verification failed', verified.error.code, verified.error.message); return Response.json({ error: 'verification_unavailable', code: verified.error.code }, { status: 503 }); }
  if (verified.data !== true) return new Response('forbidden', { status: 403 });
  const { data: jobs, error } = await client.rpc('claim_meeting_notification_jobs', { p_limit: 25 });
  if (error) return Response.json({ error: 'claim_failed' }, { status: 500 });
  const results = await processMeetingNotificationJobs(client, jobs || [], body => invokeSmsHandler(handleSendSms, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, body));
  return Response.json({ processed: results.length, uncertain: results.filter((r: any) => r.status === 'uncertain').length, recording_failed: results.filter((r: any) => !r.recorded).length });
});
