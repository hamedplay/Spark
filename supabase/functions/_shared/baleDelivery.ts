// Shared by the authenticated browser endpoint and the server meeting worker.
// The caller owns authorization; provider credentials never leave this module.
export async function deliverBaleNotification(client: any, userId: string, text: string, transport: typeof fetch = fetch) {
  const { data: cfg, error } = await client.from('social_channel_configs')
    .select('bot_token,is_active').eq('channel','bale').maybeSingle();
  if (error) return { status: 'failed', reason: 'BALE_CONFIG_UNAVAILABLE' };
  if (!cfg?.is_active) return { status: 'skipped', reason: 'BALE_DISABLED' };
  const token = String(cfg.bot_token ?? '').trim();
  if (!token) return { status: 'skipped', reason: 'BALE_TOKEN_MISSING' };
  const { data: chatId, error: mappingError } = await client.rpc('get_bale_chat_id_service', { p_user_id: userId });
  if (mappingError) return { status: 'failed', reason: 'BALE_MAPPING_UNAVAILABLE' };
  if (!chatId) return { status: 'skipped', reason: 'BALE_NOT_LINKED' };
  try {
    const response = await transport(`https://tapi.bale.ai/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { status: response.status >= 500 ? 'uncertain' : 'failed', reason: `BALE_HTTP_${response.status}` };
    const result = await response.json();
    if (result.ok === false) return { status: 'failed', reason: 'BALE_PROVIDER_REJECTED' };
    if (result.ok !== true || !result.result?.message_id) return { status: 'uncertain', reason: 'DELIVERY_OUTCOME_UNKNOWN' };
    return { status: 'sent', reason: null };
  } catch { return { status: 'uncertain', reason: 'DELIVERY_OUTCOME_UNKNOWN' }; }
}
