import { useState, useEffect, useCallback } from 'react';
import { LogOut, MonitorSmartphone, ShieldX, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';

interface SessionInfo {
  session_id: string;
  created_at: string;
  last_activity_at: string;
  idle_expiry_at: string;
  absolute_expiry_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  device_summary: string;
  status: string;
}

export function SessionManagementPanel() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('session-management', {
        method: 'POST',
        body: { mode: 'list' },
      });
      if (fnError || !data?.ok) throw new Error(data?.error ?? 'LOAD_FAILED');
      setSessions(data.sessions ?? []);
      setCurrentSessionId(typeof data.current_session_id === 'string' ? data.current_session_id : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'LOAD_FAILED');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  useEffect(() => {
    const heartbeat = async () => {
      const { data, error: fnError } = await supabase.functions.invoke('session-management', {
        method: 'POST',
        body: { mode: 'heartbeat' },
      });
      if (fnError || !data?.ok) await supabase.auth.signOut();
    };
    const timer = window.setInterval(heartbeat, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const revokeOne = async (sessionId: string) => {
    setRevoking(sessionId);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('session-management', {
        method: 'POST',
        body: { mode: 'revoke_one', session_id: sessionId },
      });
      if (fnError || !data?.ok) throw new Error(data?.error ?? 'REVOKE_FAILED');
      if (sessionId === currentSessionId) await supabase.auth.signOut();
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
      await supabase.auth.signOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'REVOKE_FAILED');
    } finally {
      setRevoking(null);
    }
  };

  const hasHistoricalSessions = sessions.some((session) => session.session_id !== currentSessionId && session.status !== 'active');

  if (loading) return <div className="py-4 text-center text-sm text-gray-500">در حال بارگذاری...</div>;
  if (error) return <div className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</div>;

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900 dark:text-white sm:text-lg">مدیریت نشست‌ها</h3>
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

      {sessions.length === 0 ? (
        <p className="rounded-xl bg-gray-50 px-3 py-4 text-center text-sm text-gray-500 dark:bg-gray-700/30 dark:text-gray-400">نشستی یافت نشد.</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => {
            const statusLabel = s.status === 'active' ? 'فعال' : s.status === 'revoked' ? 'لغوشده' : 'منقضی';
            const statusClass = s.status === 'active'
              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
              : s.status === 'revoked'
              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
              : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';

            return (
              <article key={s.session_id} className="rounded-xl border border-gray-200 p-3 dark:border-gray-700">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300">
                      <MonitorSmartphone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800 dark:text-white" title={s.device_summary || 'ناشناخته'}>{s.device_summary || 'ناشناخته'}</p>
                      <span className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium ${statusClass}`}>{statusLabel}</span>
                    </div>
                  </div>

                  {s.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => revokeOne(s.session_id)}
                      disabled={revoking === s.session_id}
                      className="inline-flex h-10 flex-shrink-0 items-center rounded-xl border border-red-200 px-2.5 text-xs text-red-600 transition hover:bg-red-50 disabled:opacity-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                    >
                      {revoking === s.session_id ? '...' : s.session_id === currentSessionId ? 'خروج' : 'لغو'}
                    </button>
                  )}
                </div>

                <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-gray-50 px-2.5 py-2 text-[10px] text-gray-500 dark:bg-gray-700/30 dark:text-gray-400 sm:text-xs">
                  <div className="min-w-0">
                    <span className="block text-gray-400 dark:text-gray-500">ایجاد</span>
                    <span className="block truncate">{new Date(s.created_at).toLocaleString('fa-IR')}</span>
                  </div>
                  <div className="min-w-0">
                    <span className="block text-gray-400 dark:text-gray-500">آخرین فعالیت</span>
                    <span className="block truncate">{new Date(s.last_activity_at).toLocaleString('fa-IR')}</span>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
