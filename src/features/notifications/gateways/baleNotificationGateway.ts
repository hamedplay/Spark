import { supabase } from '../../../lib/supabase';

export async function dispatchBaleNotification(
  userId: string,
  text: string
): Promise<void> {
  try {
    const supabaseUrl =
      import.meta.env
        .VITE_SUPABASE_URL;

    const anonKey =
      import.meta.env
        .VITE_SUPABASE_ANON_KEY;

    const {
      data: {
        session,
      },
    } =
      await supabase.auth
        .getSession();

    await fetch(
      `${supabaseUrl}/functions/v1/send-bale-message`,
      {
        method: 'POST',

        headers: {
          'Content-Type':
            'application/json',

          Authorization:
            `Bearer ${
              session?.access_token ||
              anonKey
            }`,

          Apikey:
            anonKey,
        },

        body:
          JSON.stringify({
            userId,
            text,
          }),
      }
    );
  } catch {
    // fire-and-forget — never break the notification flow
  }
}
