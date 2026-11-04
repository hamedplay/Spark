export interface SessionInfo {
  session_id: string; created_at: string; last_activity_at: string;
  idle_expiry_at: string; absolute_expiry_at: string; revoked_at: string | null;
  revoke_reason: string | null; device_summary: string; status: string;
  initial_ip?: string | null; initial_ip_source?: string | null; last_ip?: string | null; last_ip_source?: string | null;
  first_observed_at?: string | null; last_observed_at?: string | null; observation_kind?: string;
  client_hints?: Record<string, unknown>; ended_at?: string | null; end_reason?: string | null;
}
export const sessionDate = (value?: string | null) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('fa-IR', { timeZone: 'Asia/Tehran', dateStyle: 'medium', timeStyle: 'medium' }) : 'ثبت نشده';
export function elapsed(value: string | null | undefined, now: number) {
  if (!value || !Number.isFinite(Date.parse(value))) return 'ثبت نشده';
  const seconds = Math.max(0,Math.floor((now-Date.parse(value))/1000));
  const f = new Intl.NumberFormat('fa-IR');
  if (seconds < 60) return 'کمتر از یک دقیقه';
  if (seconds < 3600) return `${f.format(Math.floor(seconds/60))} دقیقه`;
  const hours=Math.floor(seconds/3600), minutes=Math.floor(seconds%3600/60);
  return `${f.format(hours)} ساعت${minutes ? ` و ${f.format(minutes)} دقیقه` : ''}`;
}
export function sessionPresence(s: SessionInfo, now: number, graceSeconds: number) {
  if (s.status !== 'active' || Math.min(Date.parse(s.idle_expiry_at),Date.parse(s.absolute_expiry_at))<=now) return 'ended';
  if (!s.last_observed_at || !Number.isFinite(Date.parse(s.last_observed_at))) return 'unknown';
  return now-Date.parse(s.last_observed_at)<=graceSeconds*1000 ? 'online' : 'offline';
}
const reasons: Record<string,string> = { user_revoke:'خروج یا لغو این نشست', other_sessions:'لغو از دستگاه دیگر',
  all_sessions:'خروج از همهٔ نشست‌ها', max_sessions_exceeded:'رسیدن به سقف نشست‌های هم‌زمان',
  idle_timeout:'پایان مهلت عدم فعالیت', absolute_timeout:'پایان عمر نشست', epoch_mismatch:'تغییر اطلاعات امنیتی حساب',
  auth_session_removed:'پایان نشست در سرویس ورود' };
export const sessionEndReason = (s: SessionInfo) => {
  const key=s.end_reason ?? s.revoke_reason;
  if (key && Object.hasOwn(reasons,key)) return reasons[key];
  if (s.status==='idle_expired') return reasons.idle_timeout;
  if (s.status==='absolute_expired') return reasons.absolute_timeout;
  if (s.status==='epoch_expired') return reasons.epoch_mismatch;
  return key || 'زمان یا علت دقیق ثبت نشده';
};
