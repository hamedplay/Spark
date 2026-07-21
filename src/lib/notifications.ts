import { supabase } from './supabase';
import { renderTemplate, validatePayloadForEvent } from '../config/templateCatalog';
import type { RenderTemplateResult } from '../config/templateCatalog';

export interface NotifyChannels {
  inApp?: boolean;  // default true
  sms?: boolean;    // default true
  bale?: boolean;   // default true
}

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
  // Channel control — when omitted, all channels fire (backward compatible)
  channels?: NotifyChannels;
  // Idempotency key — when set, passed to create_notification for unique constraint
  eventKey?: string | null;
}

export interface SmsDispatchResult {
  ok: boolean;
  status: 'sent' | 'skipped' | 'failed';
  reason?: string;
  errorCode?: string;
  error?: string;
}

// In-memory template cache (refreshed per session)
let templateCache: Map<string, { id: string; title: string; body: string; updatedAt: string }> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

async function getTemplates(): Promise<Map<string, { id: string; title: string; body: string; updatedAt: string }>> {
  if (templateCache && Date.now() - cacheLoadedAt < CACHE_TTL_MS) return templateCache;
  const { data } = await supabase
    .from('notification_templates')
    .select('id, category, event_type, audience, title, body, updated_at')
    .eq('is_active', true)
    .order('updated_at', { ascending: false });
  const map = new Map<string, { id: string; title: string; body: string; updatedAt: string }>();
  for (const t of (data || [])) {
    const key = `${t.category}:${t.event_type}:${t.audience}`;
    // First match wins (most recently updated due to ORDER BY)
    if (!map.has(key)) {
      map.set(key, { id: t.id, title: t.title, body: t.body, updatedAt: t.updated_at });
    }
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
  }
  smsTemplateCache = map;
  smsCacheLoadedAt = Date.now();
  return map;
}

function fillPlaceholders(text: string, vars: Record<string, string>): string {
  const result = renderTemplate(text, vars);
  if (import.meta.env?.DEV && (result.missingPlaceholders.length > 0 || result.unresolvedPlaceholders.length > 0)) {
    console.warn('[notifications] template issues:', {
      missing: result.missingPlaceholders,
      unresolved: result.unresolvedPlaceholders,
    });
  }
  return result.text;
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

  if (import.meta.env?.DEV) {
    console.debug('[notification-template]', {
      category: payload.category,
      eventType: payload.eventType,
      audience,
      recipientId: payload.userId,
      templateId: template?.id ?? null,
      templateBody: template?.body ?? null,
      payload: vars,
    });
    const payloadValidation = validatePayloadForEvent(payload.eventType, vars);
    if (!payloadValidation.valid) {
      console.warn('[notification-template] payload validation failed:', {
        eventType: payload.eventType,
        missingRequiredValues: payloadValidation.missingRequiredValues,
        emptyRequiredValues: payloadValidation.emptyRequiredValues,
        recipientId: payload.userId,
      });
    }
  }

  const title = template ? fillPlaceholders(template.title, vars) : payload.fallbackTitle;
  const message = template ? fillPlaceholders(template.body, vars) : payload.fallbackMessage;

  const ch = payload.channels;
  const inAppEnabled = ch?.inApp !== false;
  const smsEnabled = ch?.sms !== false;
  const baleEnabled = ch?.bale !== false;

  if (inAppEnabled) {
    await supabase.rpc('create_notification', {
      p_user_id: payload.userId,
      p_title: title,
      p_message: message,
      p_type: payload.category as 'meeting' | 'task' | 'note' | 'chat' | 'channel' | 'call' | 'system',
      p_action_url: payload.actionUrl ?? null,
      p_template_category: payload.category,
      p_template_event_type: payload.eventType,
      p_template_audience: audience,
      p_event_key: payload.eventKey ?? null,
    });
  }

  let smsResult: SmsDispatchResult = { ok: true, status: 'skipped', reason: 'CHANNEL_DISABLED' };
  if (smsEnabled) {
    // Resolve SMS message (dedicated template or fallback to notification body)
    const smsTemplates = await getSmsTemplates();
    const smsBody =
      smsTemplates.get(`${payload.category}:${payload.eventType}:${audience}`) ||
      smsTemplates.get(`${payload.category}:${payload.eventType}:all`) ||
      message;
    const smsMessage = fillPlaceholders(smsBody, vars);

    // Dispatch SMS via server-side dispatch mode — returns structured result
    smsResult = await dispatchSms(
      payload.userId,
      payload.category,
      payload.eventType,
      audience,
      smsMessage,
      payload.senderId,
    );
  }

  // Fire-and-forget — send Bale message if user has connected Bale account
  if (baleEnabled) {
    const baleText = title !== message ? `${title}\n${message}` : message;
    dispatchBale(payload.userId, baleText);
  }

  return smsResult;
}

export function invalidateTemplateCache() {
  templateCache = null;
  smsTemplateCache = null;
}

export { getSmsTemplates, fillPlaceholders };
