import { supabase } from './supabase';
import { toPersianDigits } from './minutesDate';

const DECISION_STATUS_FA: Record<string, string> = {
  not_started: 'شروع‌نشده',
  planned: 'برنامه‌ریزی‌شده',
  in_progress: 'در حال انجام',
  waiting_coordination: 'در انتظار هماهنگی',
  waiting_approval: 'در انتظار تأیید',
  completed: 'تکمیل‌شده',
  stopped: 'متوقف‌شده',
};

const MINUTES_STATUS_FA: Record<string, string> = {
  draft: 'پیش‌نویس',
  pending_approval: 'در انتظار تأیید',
  changes_requested: 'نیازمند اصلاح',
  approved: 'تأییدشده',
  published: 'منتشرشده',
  rejected: 'ردشده',
  invalidated: 'باطل‌شده',
};

const PROGRESS_FIELDS = new Set([
  'progress',
  'progress_percent',
  'previous_progress_percent',
  'new_progress_percent',
]);

const REVISION_FIELDS = new Set([
  'revision',
  'revision_number',
]);

const STATUS_FIELDS = new Set([
  'status',
  'previous_status',
  'new_status',
]);

function formatStatusByContext(entityType: string, value: unknown): string {
  if (typeof value !== 'string') return String(value);
  if (entityType === 'decision') return DECISION_STATUS_FA[value] || value;
  if (entityType === 'minute') return MINUTES_STATUS_FA[value] || value;
  return MINUTES_STATUS_FA[value] || DECISION_STATUS_FA[value] || value;
}

function formatProgress(value: unknown): string {
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  return `${toPersianDigits(String(n))}٪`;
}

export interface AuditLogRow {
  id: string;
  minute_id: string;
  actor_user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  revision_number: number | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  actor_name?: string | null;
  entity_title?: string | null;
}

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  minute_created: 'ایجاد صورت‌جلسه',
  minute_updated: 'ویرایش صورت‌جلسه',
  minute_deleted: 'حذف صورت‌جلسه',
  minute_submitted: 'ارسال برای تأیید',
  minute_resubmitted: 'ارسال مجدد نسخه',
  approval_given: 'تأیید ثبت شد',
  changes_requested: 'درخواست اصلاح',
  secretary_confirmed: 'تأیید دبیر',
  chair_confirmed: 'تأیید رئیس',
  minute_published: 'انتشار صورت‌جلسه',
  decision_created: 'ایجاد مصوبه',
  decision_updated: 'ویرایش مصوبه',
  decision_deleted: 'حذف مصوبه',
  decision_progress_updated: 'به‌روزرسانی پیشرفت مصوبه',
  attachment_uploaded: 'بارگذاری پیوست',
  attachment_deleted: 'حذف پیوست',
};

export const ENTITY_LABELS: Record<string, string> = {
  minute: 'صورت‌جلسه',
  decision: 'مصوبه',
  attachment: 'پیوست',
  approval: 'تأیید',
};

function auditValueTitle(values: Record<string, unknown> | null): string | null {
  const title = values?.title;
  return typeof title === 'string' && title.trim() ? title : null;
}

export async function listMinuteAudit(
  minuteId: string,
  limit = 20,
  offset = 0,
): Promise<{ rows: AuditLogRow[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from('minutes_audit_log')
    .select('id,minute_id,actor_user_id,action,entity_type,entity_id,revision_number,old_values,new_values,metadata,created_at')
    .eq('minute_id', minuteId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit);
  if (error) throw new Error('بارگذاری تاریخچه ناموفق بود.');
  const rows = (data || []) as unknown as AuditLogRow[];
  const hasMore = rows.length === limit + 1;
  const trimmed = hasMore ? rows.slice(0, limit) : rows;
  const ids = Array.from(new Set(trimmed.map(r => r.actor_user_id).filter(Boolean) as string[]));
  if (ids.length) {
    const { data: prof } = await supabase
      .from('profiles_public')
      .select('user_id,full_name')
      .in('user_id', ids);
    const map: Record<string, string> = {};
    for (const p of (prof || []) as unknown as { user_id: string; full_name: string }[]) {
      map[p.user_id] = p.full_name;
    }
    for (const r of trimmed) r.actor_name = map[r.actor_user_id || ''] || null;
  }

  const decisionIds = Array.from(new Set(
    trimmed
      .filter(r => r.entity_type === 'decision')
      .map(r => r.entity_id)
      .filter(Boolean) as string[],
  ));
  if (decisionIds.length) {
    const { data: decisions } = await supabase
      .from('minutes_decisions')
      .select('id,title')
      .in('id', decisionIds);
    const titleMap: Record<string, string> = {};
    for (const decision of (decisions || []) as unknown as { id: string; title: string }[]) {
      titleMap[decision.id] = decision.title;
    }
    for (const r of trimmed) {
      if (r.entity_type !== 'decision') continue;
      r.entity_title = titleMap[r.entity_id || ''] || auditValueTitle(r.new_values) || auditValueTitle(r.old_values);
    }
  }

  return { rows: trimmed, hasMore };
}

export function summarizeChange(row: AuditLogRow): string {
  const action = AUDIT_ACTION_LABELS[row.action] || row.action;
  const entity = ENTITY_LABELS[row.entity_type] || row.entity_type;
  const parts: string[] = [action];
  if (row.entity_type === 'decision' && row.entity_title) parts.push(`مصوبه: ${row.entity_title}`);
  const hasRevisionInRow = row.revision_number != null;
  if (hasRevisionInRow) parts.push(`نسخه ${toPersianDigits(String(row.revision_number))}`);
  if (row.new_values) {
    const keys = Object.keys(row.new_values).slice(0, 3);
    for (const k of keys) {
      if (hasRevisionInRow && REVISION_FIELDS.has(k)) continue;
      const v = row.new_values[k];
      if (v == null || v === '') continue;
      parts.push(`${label(k)}: ${formatVal(k, v, row.entity_type)}`);
    }
  }
  return parts.join(' · ');
}

const FIELD_LABELS: Record<string, string> = {
  status: 'وضعیت',
  revision: 'نسخه',
  title: 'عنوان',
  progress: 'پیشرفت',
  filename: 'نام فایل',
  size: 'حجم',
  mime: 'نوع',
};

function label(k: string): string {
  return FIELD_LABELS[k] || k;
}

function formatVal(field: string, v: unknown, entityType?: string): string {
  if (STATUS_FIELDS.has(field)) return formatStatusByContext(entityType || '', v);
  if (PROGRESS_FIELDS.has(field)) return formatProgress(v);
  if (REVISION_FIELDS.has(field)) return toPersianDigits(String(v));
  if (typeof v === 'string') return v.length > 40 ? v.slice(0, 40) + '…' : v;
  if (typeof v === 'number') return toPersianDigits(String(v));
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر';
  return String(v);
}
