import { supabase } from './supabase';

export interface NotifyPayload {
  userId: string;
  category: string;    // 'chat' | 'meeting' | 'task' | 'note' | 'calendar' | 'system'
  eventType: string;   // 'message' | 'invite' | 'assign' | etc.
  audience?: string;   // 'all' | 'participants' | 'observers' — default 'all'
  // Fallback values used when no template matches
  fallbackTitle: string;
  fallbackMessage: string;
  // Placeholder values for template substitution
  placeholders?: Record<string, string>;
  // Sender info
  senderId?: string | null;
  senderName?: string | null;
  senderAvatarUrl?: string | null;
  actionUrl?: string | null;
}

// In-memory template cache (refreshed per session)
let templateCache: Map<string, { title: string; body: string }> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getTemplates(): Promise<Map<string, { title: string; body: string }>> {
  if (templateCache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return templateCache;
  const { data } = await supabase
    .from('notification_templates')
    .select('category, event_type, audience, title, body')
    .eq('is_active', true);
  const map = new Map<string, { title: string; body: string }>();
  for (const t of (data || [])) {
    map.set(`${t.category}:${t.event_type}:${t.audience}`, { title: t.title, body: t.body });
  }
  templateCache = map;
  cacheLoadedAt = Date.now();
  return map;
}

// SMS template cache: keyed by "category:event_type:audience"
let smsTemplateCache: Map<string, string> | null = null;
let smsCacheLoadedAt = 0;

async function getSmsTemplates(): Promise<Map<string, string>> {
  if (smsTemplateCache && Date.now() - smsCacheLoadedAt < CACHE_TTL_MS) return smsTemplateCache;
  const { data } = await supabase
    .from('sms_templates')
    .select('category, event_type, audience, body')
    .eq('is_active', true);
  const map = new Map<string, string>();
  for (const t of (data || [])) {
    map.set(`${t.category}:${t.event_type}:${t.audience}`, t.body);
    // also register under 'all' as fallback
    if (t.audience !== 'all') {
      if (!map.has(`${t.category}:${t.event_type}:all`)) {
        map.set(`${t.category}:${t.event_type}:all`, t.body);
      }
    }
  }
  smsTemplateCache = map;
  smsCacheLoadedAt = Date.now();
  return map;
}

function fillPlaceholders(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key) => {
    const val = vars[key];
    return (val !== undefined && val !== null) ? val : '';
  });
}

async function dispatchBale(
  userId: string,
  text: string,
): Promise<void> {
  try {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const { data: { session } } = await supabase.auth.getSession();
    await fetch(`${supabaseUrl}/functions/v1/send-bale-message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || anonKey}`,
        'Apikey': anonKey,
      },
      body: JSON.stringify({ userId, text }),
    });
  } catch {
    // fire-and-forget — never break the notification flow
  }
}

async function dispatchSms(
  userId: string,
  category: string,
  eventType: string,
  audience: string,
  message: string,
  senderId?: string | null,
): Promise<void> {
  const logBase = {
    target_user_id: userId,
    triggered_by_user_id: senderId ?? null,
    category,
    event_type: eventType,
    audience,
    message,
  };

  try {
    // Use SECURITY DEFINER RPC to bypass RLS:
    // reads target user's group memberships + sms_group_rules + phone in one call
    const { data: dispatchRows, error: rpcError } = await supabase
      .rpc('get_sms_dispatch_info', { target_user_id: userId, p_category: category });

    if (rpcError) throw rpcError;

    if (!dispatchRows?.length) {
      await supabase.from('sms_dispatch_logs').insert({
        ...logBase,
        target_phone: null,
        status: 'skipped',
        error_text: `پیامک برای دسته «${category}» در گروه‌های کاربر فعال نیست`,
      });
      return;
    }

    const providerId: string | null = dispatchRows[0].provider_id ?? null;
    const phone: string = dispatchRows[0].phone?.trim() ?? '';

    if (!phone || phone.length < 7) {
      await supabase.from('sms_dispatch_logs').insert({
        ...logBase,
        target_phone: phone || null,
        provider_id: providerId,
        status: 'skipped',
        error_text: 'شماره موبایل در پروفایل کاربر ثبت نشده یا معتبر نیست',
      });
      return;
    }

    // Get provider name for logging
    let providerName: string | null = null;
    if (providerId) {
      const { data: prov } = await supabase
        .from('sms_providers')
        .select('title')
        .eq('id', providerId)
        .maybeSingle();
      providerName = prov?.title ?? null;
    } else {
      const { data: defProv } = await supabase
        .from('sms_providers')
        .select('id, title')
        .eq('is_default', true)
        .eq('is_active', true)
        .maybeSingle();
      if (defProv) {
        providerName = defProv.title;
      }
    }

    // Call send-sms Edge Function
    const requestBody: Record<string, unknown> = {
      mode: 'send',
      mobiles: [phone],
      message,
    };
    if (providerId) requestBody.providerId = providerId;

    const { data: result, error: fnError } = await supabase.functions.invoke('send-sms', {
      body: requestBody,
    });
    if (fnError) throw fnError;

    if (result.ok) {
      // For rahyab_rest: result.returnIds[0] is the provider message ID (Rahyab Return ID)
      // For sms.ir / REST providers: result.returnIds is absent; use packId instead
      const providerMessageId: string | null = result.returnIds?.[0] ?? null;
      await supabase.from('sms_dispatch_logs').insert({
        ...logBase,
        target_phone: phone,
        provider_id: providerId,
        provider_name: providerName,
        status: 'sent',
        pack_id: result.packId ?? null,
        message_ids: result.messageIds ?? null,
        cost: result.cost ?? null,
        raw_response: result.response ?? null,
        provider_message_id: providerMessageId,
        delivery_status: providerMessageId ? 'pending' : null,
      });
    } else {
      await supabase.from('sms_dispatch_logs').insert({
        ...logBase,
        target_phone: phone,
        provider_id: providerId,
        provider_name: providerName,
        status: 'failed',
        error_text: result.error ?? 'خطای ناشناخته از سرویس پیامک',
        raw_response: result.response ?? null,
      });
    }
  } catch (err: any) {
    // Log the failure but never let it break the notification flow
    try {
      await supabase.from('sms_dispatch_logs').insert({
        ...logBase,
        target_phone: null,
        status: 'failed',
        error_text: err?.message ?? 'خطای داخلی هنگام ارسال پیامک',
      });
    } catch {
      // ignore secondary logging failure
    }
  }
}

export async function insertNotification(payload: NotifyPayload): Promise<void> {
  const templates = await getTemplates();
  const audience = payload.audience || 'all';
  const template =
    templates.get(`${payload.category}:${payload.eventType}:${audience}`) ||
    templates.get(`${payload.category}:${payload.eventType}:all`);

  const vars = payload.placeholders || {};
  const title = template ? fillPlaceholders(template.title, vars) : payload.fallbackTitle;
  const message = template ? fillPlaceholders(template.body, vars) : payload.fallbackMessage;

  await supabase.from('notifications').insert({
    user_id: payload.userId,
    title,
    message,
    type: payload.category as 'meeting' | 'task' | 'note' | 'chat' | 'channel' | 'call' | 'system',
    read: false,
    sender_id: payload.senderId ?? null,
    sender_name: payload.senderName ?? null,
    sender_avatar_url: payload.senderAvatarUrl ?? null,
    action_url: payload.actionUrl ?? null,
  });

  // Dispatch SMS — use notification body as fallback if no dedicated SMS template
  const smsTemplates = await getSmsTemplates();
  const smsBody =
    smsTemplates.get(`${payload.category}:${payload.eventType}:${audience}`) ||
    smsTemplates.get(`${payload.category}:${payload.eventType}:all`) ||
    message;
  const smsMessage = fillPlaceholders(smsBody, vars);

  // Fire-and-forget — never block the notification insert
  dispatchSms(
    payload.userId,
    payload.category,
    payload.eventType,
    audience,
    smsMessage,
    payload.senderId,
  );

  // Fire-and-forget — send Bale message if user has connected Bale account
  const baleText = title !== message ? `${title}\n${message}` : message;
  dispatchBale(payload.userId, baleText);
}

export function invalidateTemplateCache() {
  templateCache = null;
  smsTemplateCache = null;
}

export { getSmsTemplates, fillPlaceholders };
