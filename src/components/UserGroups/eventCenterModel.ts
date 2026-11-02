import { eventTitle, categoryTitle, eventSourceTitle, eventResultTitle, metadataRows } from './eventCenterPresentation';
export { eventTitle } from './eventCenterPresentation';

export interface CenterEvent {
  event_key: string;
  id: string;
  created_at: string;
  source: 'application' | 'security';
  event_type: string;
  category: string;
  severity: string;
  result: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  target_user_id: string | null;
  ip_address: string | null;
  ip_hash: string | null;
  session_id: string | null;
  request_id: string | null;
  error_code: string | null;
  metadata: Record<string, unknown>;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
}
export interface EventCursor { time: string; key: string }
export interface EventPage { events: CenterEvent[]; has_more: boolean; next_cursor: EventCursor | null }
export const severityLabels: Record<string, string> = { info: 'اطلاع', success: 'موفق', warning: 'هشدار', error: 'خطا', critical: 'بحرانی' };
export const resultLabels: Record<string, string> = { success: 'انجام شد', failure: 'ناموفق', error: 'خطا', denied: 'دسترسی رد شد' };
export function isAttentionEvent(event: Pick<CenterEvent, 'severity' | 'result'>) {
  return ['warning', 'error', 'critical'].includes(event.severity) || ['denied', 'failure', 'error'].includes(event.result ?? '');
}
export function changedFields(event: Pick<CenterEvent, 'before_state' | 'after_state'>) {
  const before = event.before_state ?? {};
  const after = event.after_state ?? {};
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .map(key => ({ key, before: before[key] ?? null, after: after[key] ?? null }));
}
export function exportEvents(events: CenterEvent[]) {
  // JSON avoids spreadsheet formula execution and preserves structured evidence.
  return JSON.stringify({ exported_at: new Date().toISOString(), scope: 'displayed_events', events: events.map(event => ({
    ...event, event_title_fa: eventTitle(event.event_type), category_title_fa: categoryTitle(event.category),
    source_title_fa: eventSourceTitle(event), result_title_fa: eventResultTitle(event), details_fa: metadataRows(event),
  })) }, null, 2);
}

export function isEventCenterSchemaMissing(error: { code?: string } | null | undefined): boolean {
  return error?.code === 'PGRST202';
}
export function eventCenterErrorMessage(error: { code?: string }): string {
  if (isEventCenterSchemaMissing(error)) return 'مرکز رخدادها در API این سایت در دسترس نیست. به‌روزرسانی دیتابیس مرکز رخدادها و کش API را بررسی کنید؛ سپس «تلاش دوباره» را بزنید.';
  if (error.code === '42501') return 'مجوز مشاهدهٔ مرکز رخدادها را ندارید.';
  return 'دریافت رخدادها ناموفق بود. اتصال و به‌روزرسانی دیتابیس را بررسی کنید.';
}
