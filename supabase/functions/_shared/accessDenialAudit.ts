import { createClient } from "npm:@supabase/supabase-js@2.111.0";

/** Server-only writer. actorUserId must come from a verified auth result. */
export async function recordAccessDenial(req: Request, actorUserId: string | null, code: string): Promise<void> {
  if (!actorUserId) return;
  try {
    const url = new URL(req.url);
    // Only a function slug, never query strings, request bodies or bearer tokens.
    const parts = url.pathname.split('/').filter(Boolean);
    const resource = parts[0] === 'functions' && parts[1] === 'v1' ? parts[2] : parts[0];
    const client = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await client.rpc('record_access_denial_service_v1', {
      p_actor: actorUserId, p_resource: resource ?? 'unknown', p_code: code,
    }).abortSignal(AbortSignal.timeout(3000));
    if (error) console.error('[access-audit] persistence failed');
  } catch {
    console.error('[access-audit] persistence failed');
  }
}
