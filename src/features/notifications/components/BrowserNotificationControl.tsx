import { useEffect, useState } from 'react';
import { BellRing, Volume2, Loader2 } from 'lucide-react';
import { useUserPreferences } from '../../user-preferences/context/UserPreferencesContext';
import { enableBrowserNotifications, disableBrowserNotifications, getBrowserPushState, notifyBrowser } from '../../../lib/pwaNotificationBridge';
import { unlockNotificationSound } from '../../../lib/notificationSound';

export function BrowserNotificationControl({ userId }: { userId: string | null }) {
  const { prefs, updatePrefs } = useUserPreferences();
  const [state, setState] = useState(getBrowserPushState);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = () => setState(getBrowserPushState());
    sync(); window.addEventListener('spark-browser-notifications-changed', sync); window.addEventListener('focus', sync);
    return () => { window.removeEventListener('spark-browser-notifications-changed', sync); window.removeEventListener('focus', sync); };
  }, []);
  const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const enabled = granted && !['disabled-by-preference', 'unsupported', 'not-installed'].includes(state.status);
  const activate = async () => {
    setBusy(true); setError('');
    try {
      await enableBrowserNotifications();
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && !prefs.notifications_enabled) await updatePrefs({ notifications_enabled: true });
    } catch { setError('فعال‌سازی اعلان انجام نشد؛ دوباره تلاش کنید.'); }
    finally { setState(getBrowserPushState()); setBusy(false); }
  };
  const hint = state.status === 'not-installed' ? 'در آیفون، ابتدا از Share گزینه Add to Home Screen را بزنید و برنامه را از آیکون آن باز کنید.'
    : state.status === 'permission-denied' ? 'مجوز اعلان این سایت را از تنظیمات مرورگر فعال کنید.'
    : state.status === 'unsupported' ? 'اعلان سیستمی در این مرورگر یا اتصال در دسترس نیست.'
    : state.status === 'error' ? 'اعلان هنگام بازبودن برنامه فعال است؛ ثبت اعلان پس‌زمینه ناموفق بود.'
    : state.status === 'registering' ? 'در حال ثبت اعلان پس‌زمینه…'
    : enabled ? 'اعلان و صدا در این مرورگر فعال است.' : 'برای دریافت اعلان و صدا در این دستگاه فعال کنید.';
  const unsupported = ['not-installed','unsupported','permission-denied'].includes(state.status);
  return (
    <div className="shrink-0 border-b border-slate-100 bg-slate-50/80 px-3 py-2 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex items-center gap-2">
        <BellRing className="h-4 w-4 shrink-0 text-blue-500" />
        <span className="min-w-0 flex-1 text-xs font-medium text-slate-700 dark:text-slate-200">اعلان مرورگر و صدا</span>
        {enabled && userId && <button type="button" title="تست صدا و اعلان" aria-label="تست صدا و اعلان" className="rounded-lg p-2 text-blue-600 hover:bg-blue-100 dark:text-blue-300" onClick={() => { unlockNotificationSound(); void notifyBrowser({ id: `test-${crypto.randomUUID()}`, action_url: '/' }, userId); }}><Volume2 className="h-4 w-4" /></button>}
        {!unsupported && <button type="button" disabled={busy || !userId} className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs text-white disabled:opacity-50" onClick={() => { if (enabled) { setBusy(true); void disableBrowserNotifications().finally(() => { setBusy(false); setState(getBrowserPushState()); }); } else void activate(); }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : enabled ? 'غیرفعال' : 'فعال‌سازی'}
        </button>}
      </div>
      <p className="mt-1 text-[10px] leading-5 text-slate-500 dark:text-slate-400" role="status">{error || hint}{state.status === 'error' && <button type="button" disabled={busy} onClick={() => void activate()} className="mr-1 text-blue-600 underline dark:text-blue-300">تلاش مجدد</button>}</p>
    </div>
  );
}
