import { supabase } from './supabase';

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
      .from('profiles')
      .select('user_id,full_name')
      .in('user_id', ids);
    const map: Record<string, string> = {};
    for (const p of (prof || []) as unknown as { user_id: string; full_name: string }[]) {
      map[p.user_id] = p.full_name;
    }
    for (const r of trimmed) r.actor_name = map[r.actor_user_id || ''] || null;
  }
  return { rows: trimmed, hasMore };
}

export function summarizeChange(row: AuditLogRow): string {
  const action = AUDIT_ACTION_LABELS[row.action] || row.action;
  const entity = ENTITY_LABELS[row.entity_type] || row.entity_type;
  const parts: string[] = [action];
  if (row.revision_number != null) parts.push(`نسخه ${row.revision_number}`);
  if (row.new_values) {
    const keys = Object.keys(row.new_values).slice(0, 3);
    for (const k of keys) {
      const v = row.new_values[k];
      if (v == null || v === '') continue;
      parts.push(`${label(k)}: ${formatVal(v)}`);
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

function formatVal(v: unknown): string {
  if (typeof v === 'string') return v.length > 40 ? v.slice(0, 40) + '…' : v;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'بله' : 'خیر';
  return String(v);
}
