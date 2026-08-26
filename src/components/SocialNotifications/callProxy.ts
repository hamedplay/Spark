import { supabase } from '../../lib/supabase';

export async function callProxy(channel: 'telegram' | 'bale', method: string, params?: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('احراز هویت لازم است');
  const res = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/messenger-proxy`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
        'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ channel, method, params: params ?? {} }),
    },
  );
  return res.json();
}
