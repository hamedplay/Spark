import { useState, useEffect, useCallback } from 'react';
import { LogOut, MonitorSmartphone, ShieldX, Trash2, RefreshCw } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

import { describeUserAgent } from '../../../components/UserGroups/eventClientContext';
import { type SessionInfo, sessionDate, elapsed, sessionPresence, sessionEndReason } from './sessionPresentation';

export function SessionManagementPanel() {
  const [clock, setClock] = useState(Date.now());
  const [serverOffset, setServerOffset] = useState(0);
  const [graceSeconds, setGraceSeconds] = useState(360);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const loadSessions = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('session-management', {
        method: 'POST',
        body: { mode: 'list' },
      });
      if (fnError || !data?.ok) throw new Error(data?.error ?? 'LOAD_FAILED');
      setSessions(data.sessions ?? []);
      const server = Date.parse(data.server_time);
      if (Number.isFinite(server)) setServerOffset(server - Date.now());
      if (typeof data.presence_grace_seconds === 'number') setGraceSeconds(data.presence_grace_seconds);
      setCurrentSessionId(typeof data.current_session_id === 'string' ? data.current_session_id : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    const timer = window.setInterval(() => {
      setClock(Date.now());
      if (document.visibilityState === 'visible') void loadSessions(true);
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadSessions]);

  const revokeOne = async (sessionId: string) => {
    setRevoking(sessionId);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('session-management', {
        method: 'POST',
        body: { mode: 'revoke_one', session_id: sessionId },
      });
      if (fnError || !data?.ok) throw new Error(data?.error ?? 'REVOKE_FAILED');
      if (sessionId === currentSessionId) await supabase.auth.signOut({ scope: 'local' });
      else await loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'REVOKE_FAILED');
    } finally {
      setRevoking(null);
    }
  };

  const cleanupHistory = async () => {
    setRevoking('cleanup');
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('session-management', {
        method: 'POST',
        body: { mode: 'cleanup_history' },
      });
      if (fnError || !data?.ok) throw new Error(data?.error ?? 'CLEANUP_FAILED');
      await loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'CLEANUP_FAILED');
    } finally {
      setRevoking(null);
    }
  };

  const revokeOthers = async () => {
    setRevoking('others');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('session-management', {
        method: 'POST',
        body: { mode: 'revoke_others' },
      });
      if (fnError || !data?.ok) throw new Error(data?.error ?? 'REVOKE_FAILED');
      await loadSessions();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'REVOKE_FAILED');
    } finally {
      setRevoking(null);
    }
  };

  const revokeAll = async () => {
    setRevoking('all');
    try {
      const { data, error: fnError } = await supabase.functions.invoke('session-management', {
        method: 'POST',
        body: { mode: 'revoke_all' },
      });
      if (fnError || !data?.ok) throw new Error(data?.error ?? 'REVOKE_FAILED');
      await supabase.auth.signOut({ scope: 'global' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'REVOKE_FAILED');
    } finally {
      setRevoking(null);
    }
  };

  const visibleSessions = showHistory ? sessions : sessions.filter(session => session.status === 'active');
  const hasHistoricalSessions = sessions.some((session) => session.session_id !== currentSessionId && session.status !== 'active');

  if (loading) return <div className="py-4 text-center text-sm text-gray-500">در حال بارگذاری...</div>;
  if (error && sessions.length === 0) return <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div>;

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="min-w-max text-base font-semibold text-gray-900 dark:text-white sm:text-lg">مدیریت نشست‌ها</h3>
        <div className="mobile-scroll-actions flex-shrink-0 sm:overflow-visible">
          <button
            type="button"
            onClick={cleanupHistory}
            disabled={revoking !== null || !hasHistoricalSessions}
            title="پاک کردن نشست‌های لغوشده و منقضی"
            className="inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl border border-gray-300 px-2.5 text-xs text-gray-600 transition hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800 sm:px-3 sm:text-sm"
          >
            <Trash2 className="h-4 w-4" />
            <span className="hidden min-[390px]:inline">پاکسازی</span>
          </button>
          <button
            type="button"
            onClick={revokeOthers}
            disabled={revoking !== null}
            title="لغو همه نشست‌ها به‌جز نشست فعلی"
            className="inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl border border-amber-300 px-2.5 text-xs text-amber-700 transition hover:bg-amber-50 disabled:opacity-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-900/20 sm:px-3 sm:text-sm"
          >
            <ShieldX className="h-4 w-4" />
            <span className="hidden min-[390px]:inline">لغو سایر</span>
          </button>
          <button
            type="button"
            onClick={revokeAll}
            disabled={revoking !== null}
            title="لغو همه نشست‌ها و خروج"
            className="inline-flex h-10 flex-shrink-0 items-center gap-1.5 rounded-xl border border-red-300 px-2.5 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20 sm:px-3 sm:text-sm"
          >
            <LogOut className="h-4 w-4" />
            <span className="hidden min-[390px]:inline">خروج همه</span>
          </button>
        </div>
      </div>

      <p className="text-xs leading-6 text-gray-500 dark:text-gray-400">آنلاین یعنی ارتباط اخیر این نشست با سامانه؛ باز بودن صفحه یا حضور فیزیکی شخص را تضمین نمی‌کند. ساعت‌ها به وقت تهران است.</p>
      {error && <p role="alert" className="text-xs text-red-600">به‌روزرسانی ناموفق بود؛ اطلاعات قبلی نمایش داده می‌شود.</p>}
      <button type="button" onClick={() => void loadSessions(true)} className="inline-flex items-center gap-1 text-xs text-blue-600"><RefreshCw className="h-3 w-3" />به‌روزرسانی نشست‌ها</button>
      {hasHistoricalSessions && (
        <button type="button" onClick={() => setShowHistory(value => !value)}
          className="text-xs text-blue-600 dark:text-blue-400">
          {showHistory ? 'نمایش فقط نشست‌های فعال' : 'نمایش سوابق ۳۰ روز اخیر'}
        </button>
      )}

      {visibleSessions.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-sm text-gray-500 dark:bg-gray-700/30 dark:text-gray-400">{showHistory ? 'نشستی یافت نشد.' : 'نشست فعالی یافت نشد.'}</p>
      ) : (
        <div className="space-y-2">
          {visibleSessions.map((s) => {
            const now = clock + serverOffset;
            const presence = sessionPresence(s,now,graceSeconds);
            const device = describeUserAgent(s.device_summary,s.client_hints);
            const statusLabel = presence === 'online' ? 'آنلاین (ارتباط اخیر)' : presence === 'offline' ? 'آفلاین · نشست معتبر' : presence === 'unknown' ? 'وضعیت اتصال نامشخص' : s.status === 'revoked' ? 'خارج‌شده / لغوشده' : 'پایان‌یافته';
            const fields: [string,string][] = [
              ['سیستم‌عامل',device.os],['مرورگر و نسخه',device.browser],['نوع دستگاه',device.device],
              [s.observation_kind === 'gateway_login' ? 'IP هنگام ورود' : 'IP اولین مشاهدهٔ نشست',s.initial_ip_source === 'trusted_ingress' ? s.initial_ip || 'ثبت نشده' : 'ثبت نشده'],
              ['آخرین IP اتصال',s.last_ip_source === 'trusted_ingress' ? s.last_ip || 'ثبت نشده' : 'ثبت نشده'],
              ['زمان ورود / ایجاد نشست',sessionDate(s.created_at)],
              ['آخرین ارتباط نشست',sessionDate(s.last_observed_at)],
              ['مدت از آخرین ارتباط',elapsed(s.last_observed_at,now)],
              ['آخرین فعالیت ثبت‌شده',sessionDate(s.last_activity_at)],
              ['مهلت عدم فعالیت',sessionDate(s.idle_expiry_at)],['پایان اعتبار نشست',sessionDate(s.absolute_expiry_at)],
            ];
            if (presence === 'offline' && s.last_observed_at) fields.push(['مدت آفلاین (تقریبی)',elapsed(new Date(Date.parse(s.last_observed_at)+graceSeconds*1000).toISOString(),now)]);
            if (presence === 'ended') fields.push(['زمان پایان / خروج',sessionDate(s.ended_at)],['مدت گذشته از پایان / خروج',elapsed(s.ended_at,now)],['علت پایان',sessionEndReason(s)]);
            const architecture = [s.client_hints?.architecture,s.client_hints?.bitness].filter(Boolean).join(' · ');
            if (architecture) fields.push(['معماری گزارش‌شده',architecture]);
            return <article key={s.session_id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <MonitorSmartphone className="mt-1 h-5 w-5 shrink-0 text-gray-500" />
                  <div className="min-w-0">
                    <p className="break-words text-sm font-medium text-gray-800 dark:text-white">{device.os} · {device.browser}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <span className={`rounded-full px-2 py-1 text-[10px] ${presence === 'online' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'}`}>{statusLabel}</span>
                      {s.session_id === currentSessionId && <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">همین دستگاه</span>}
                    </div>
                  </div>
                </div>
                {s.status === 'active' && <button type="button" onClick={() => revokeOne(s.session_id)} disabled={revoking !== null} className="h-10 shrink-0 rounded-xl border border-red-200 px-2.5 text-xs text-red-600 dark:border-red-800 dark:text-red-400">{revoking === s.session_id ? '...' : s.session_id === currentSessionId ? 'خروج' : 'لغو'}</button>}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 rounded-lg bg-gray-50 p-3 text-xs dark:bg-gray-700/30">
                {fields.map(([label,value]) => <div key={label} className="min-w-0"><dt className="text-gray-500 dark:text-gray-400">{label}</dt><dd dir="auto" className="mt-1 break-words leading-6 text-gray-800 dark:text-gray-200">{value}</dd></div>)}
              </dl>
              {!s.last_ip && <p className="mt-2 text-xs leading-6 text-amber-700 dark:text-amber-400">IP قابل تأیید ثبت نشده است؛ تنظیم هدرهای ورودی سرور یا قدیمی بودن نشست باید بررسی شود.</p>}
              {device.notes.map(note => <p key={note} className="mt-2 text-xs leading-6 text-gray-500 dark:text-gray-400">{note}</p>)}
              <details className="mt-3 text-xs text-gray-500 dark:text-gray-400"><summary className="cursor-pointer">شناسهٔ نشست و مشخصات خام مرورگر</summary><p dir="ltr" className="mt-2 break-all leading-6">{s.session_id}<br />{s.device_summary || 'ثبت نشده'}</p></details>
            </article>;

          })}
        </div>
      )}
    </div>
  );
}
