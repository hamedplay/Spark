import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { requireFullAuthAccess } from '../_shared/requireFullAuthAccess.ts';
import { runMeetingNotificationBatch } from '../_shared/recurringDelivery.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey, X-Meeting-Worker-Token' };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
// Gateway verification is off; each request must pass either the dedicated Vault
// token verifier or the caller's FULL-session gate. User requests are actor-scoped.
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const client = createClient(Deno.env.get('SUPABASE_URL')!, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const token = req.headers.get('X-Meeting-Worker-Token');
  let actorId: string | undefined; let seriesId: string | undefined;
  if (token) {
    const verified = await client.rpc('verify_meeting_worker_token', { p_candidate: token });
    if (verified.error) return json({ error: 'verification_unavailable' }, 503);
    if (verified.data !== true) return json({ error: 'forbidden' }, 403);
  } else {
    const auth = await requireFullAuthAccess(req);
    if (!auth.ok || !auth.userId) return json({ error: 'AUTH_ACCESS_RESTRICTED' }, auth.error?.status ?? 403);
    actorId = auth.userId;
    let body: any;
    try { body = await req.json(); } catch { return json({ error: 'invalid_body' }, 400); }
    if (typeof body?.seriesId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.seriesId)) return json({ error: 'series_id_required' }, 400);
    seriesId = body.seriesId;
  }
  try { return json(await runMeetingNotificationBatch(client, key, actorId, seriesId)); }
  catch { return json({ error: 'delivery_unavailable' }, 503); }
});
