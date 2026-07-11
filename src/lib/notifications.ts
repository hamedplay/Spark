import { supabase } from './supabase';
import { renderTemplate } from '../config/templateCatalog';

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

export interface SmsDispatchResult {
  ok: boolean;
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  errorCode?: string;
  error?: string;
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
  const { rendered, leftover } = renderTemplate(text, vars);
  if (leftover.length > 0) {
    console.warn(`[notifications] Unfilled placeholders: ${leftover.join(', ')}`);
  }
  return rendered;
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

/**
 * Dispatches an SMS to an internal user via the server-side 'dispatch' mode.
 * All resolution (phone, provider, rule check) happens inside the Edge Function
 * using the admin client — no phone numbers are exposed to the browser.
 */
async function dispatchSms(
  userId: string,
  category: string,
  eventType: string,
  audience: string,
  message: string,
  senderId?: string | null,
): Promise<SmsDispatchResult> {
  try {
    const { data: result, error: fnError } = await supabase.functions.invoke('send-sms', {
      body: {
        mode: 'dispatch',
        targetUserId: userId,
        category,
        eventType,
        audience,
        message,
        triggeredByUserId: senderId ?? null,
      },
    });

    if (fnError) {
      throw new Error(fnError.message ?? String(fnError));
    }

    return {
      ok: result?.ok === true,
      status: result?.status ?? (result?.ok ? 'sent' : 'failed'),
      reason: result?.reason,
      errorCode: result?.errorCode,
      error: result?.error,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    // Log the failure so it's visible in sms_dispatch_logs
    try {
      await supabase.from('sms_dispatch_logs').insert({
        target_user_id: userId,
        triggered_by_user_id: senderId ?? null,
        category,
        event_type: eventType,
        audience,
        message,
        target_phone: null,
        status: 'failed',
        error_text: `CLIENT_INVOKE_ERROR: ${message}`,
      });
    } catch {
      // ignore secondary logging failure
    }
    return { ok: false, status: 'failed', errorCode: 'CLIENT_INVOKE_ERROR', error: message };
  }
}

export async function insertNotification(payload: NotifyPayload): Promise<SmsDispatchResult> {
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

  // Resolve SMS message (dedicated template or fallback to notification body)
  const smsTemplates = await getSmsTemplates();
  const smsBody =
    smsTemplates.get(`${payload.category}:${payload.eventType}:${audience}`) ||
    smsTemplates.get(`${payload.category}:${payload.eventType}:all`) ||
    message;
  const smsMessage = fillPlaceholders(smsBody, vars);

  // Dispatch SMS via server-side dispatch mode — returns structured result
  const smsResult = await dispatchSms(
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

  return smsResult;
}

export function invalidateTemplateCache() {
  templateCache = null;
  smsTemplateCache = null;
}

export { getSmsTemplates, fillPlaceholders };
