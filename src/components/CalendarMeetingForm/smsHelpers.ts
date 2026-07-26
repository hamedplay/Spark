import { supabase } from '../../lib/supabase';
import { getSmsTemplates, fillPlaceholders } from '../../lib/notifications';
import type { SmsDispatchResult } from '../../lib/notifications';
import type { ContactEmail } from '../../types';
import toast from 'react-hot-toast';
import type { ExternalSmsResult } from './types';

export async function sendSmsToExternals(
  externalNames: string[],
  allContacts: ContactEmail[],
  message: string,
  triggeredByUserId?: string | null,
  placeholders?: Record<string, string>,
  eventType: 'invite' | 'change' | 'cancel' = 'invite',
): Promise<ExternalSmsResult> {
  if (!externalNames.length) return { ok: true, sent: 0, skipped: 0 };

  const resolved = externalNames
    .map(name => ({ name, contact: allContacts.find(c => c.name === name) }))
    .filter((r): r is { name: string; contact: ContactEmail } => !!r.contact && !!((r.contact as any).phone))
    .filter(r => ((r.contact as any).phone as string).trim().length >= 7);

  const mobiles = resolved.map(r => (r.contact as any).phone as string);
  const skippedNoPhone = externalNames.length - resolved.length;

  if (!mobiles.length) {
    return { ok: false, sent: 0, skipped: skippedNoPhone, error: 'شماره موبایل برای افراد خارج سازمان یافت نشد' };
  }

  // Apply SMS template for external contacts if available
  let smsMessage = message;
  if (placeholders) {
    const smsTemplates = await getSmsTemplates();
    const templateBody =
      smsTemplates.get(`meeting:${eventType}:external`) ||
      smsTemplates.get(`meeting:${eventType}:all`) ||
      (eventType === 'change'
        ? smsTemplates.get('meeting:invite:external') || smsTemplates.get('meeting:invite:all')
        : undefined);
    if (templateBody) {
      smsMessage = fillPlaceholders(templateBody, placeholders);
    }
  }

  try {
    const { data: result, error: fnError } = await supabase.functions.invoke('send-sms', {
      body: {
        mode: 'external',
        mobiles,
        message: smsMessage,
        triggeredByUserId: triggeredByUserId ?? null,
        category: 'meeting',
        eventType,
      },
    });

    if (fnError) throw new Error(fnError.message ?? String(fnError));

    return {
      ok: result?.ok === true,
      sent: result?.sent ?? 0,
      skipped: (result?.skipped ?? 0) + skippedNoPhone,
      error: result?.ok ? undefined : (result?.error ?? 'خطای ناشناخته'),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, sent: 0, skipped: skippedNoPhone, error: msg };
  }
}

/**
 * Collects SMS results for all recipients and shows a single, human-readable summary toast.
 * Meeting save is never rolled back regardless of SMS outcome.
 */
export function showSmsSummary(
  internalResults: SmsDispatchResult[],
  externalResult: ExternalSmsResult | null,
) {
  const sent = internalResults.filter(r => r.status === 'sent').length
    + (externalResult?.sent ?? 0);
  const skipped = internalResults.filter(r => r.status === 'skipped').length
    + (externalResult?.skipped ?? 0);
  const failed = internalResults.filter(r => r.status === 'failed').length
    + (externalResult && !externalResult.ok && externalResult.sent === 0 ? 1 : 0);

  if (sent === 0 && skipped === 0 && failed === 0) return;

  const parts: string[] = [];
  if (sent > 0)    parts.push(`پیامک ${sent} نفر ارسال شد`);
  if (skipped > 0) parts.push(`${skipped} نفر پیامک ندارند یا قانونی برایشان تعریف نشده`);
  if (failed > 0)  parts.push(`ارسال برای ${failed} نفر ناموفق بود`);

  if (failed > 0) {
    toast.error('جلسه ثبت شد. ' + parts.join(' — '), { duration: 6000 });
  } else {
    toast.success('جلسه ثبت شد. ' + parts.join(' — '), { duration: 5000 });
  }
}
