import { supabase } from '../../../lib/supabase';
/** Capture via the same browser/REST ingress that records logout, not an internal Auth hop. */
export async function recordBrowserLoginConnection(): Promise<void> {
  try {
    await supabase.rpc('record_my_login_connection_v1' as never).abortSignal(AbortSignal.timeout(3000));
  } catch { /* Observability must not affect a successful login. */ }
}
