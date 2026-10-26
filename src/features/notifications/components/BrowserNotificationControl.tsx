import { useEffect, useState } from 'react';
import { BellRing, Volume2, Loader2 } from 'lucide-react';
import { useUserPreferences } from '../../user-preferences/context/UserPreferencesContext';
import { enableBrowserNotifications, disableBrowserNotifications, getBrowserPushState, isBrowserNotificationPreferenceEnabled, notifyBrowser } from '../../../lib/pwaNotificationBridge';
import { unlockNotificationSound } from '../../../lib/notificationSound';

export function BrowserNotificationControl({ userId }: { userId: string | null }) {
  const { prefs, updatePrefs } = useUserPreferences();
  const [state, setState] = useState(getBrowserPushState);
  const [deviceEnabled, setDeviceEnabled] = useState(() => isBrowserNotificationPreferenceEnabled(userId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const sync = () => { setState(getBrowserPushState()); setDeviceEnabled(isBrowserNotificationPreferenceEnabled(userId)); };
    sync(); window.addEventListener('spark-browser-notifications-changed', sync); window.addEventListener('focus', sync);
    return () => { window.removeEventListener('spark-browser-notifications-changed', sync); window.removeEventListener('focus', sync); };
  }, [userId, prefs.notifications_enabled]);
  // Application preference is on by default. OS permission is separate and can
  // only be granted through the browser's own user-interaction prompt.
  const enabled = prefs.notifications_enabled && deviceEnabled;
  const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const activate = async () => {
    setBusy(true); setError('');
    try {
      const permission = enableBrowserNotifications(); // Invoke before any await: keeps the browser gesture.
      if (!prefs.notifications_enabled) await updatePrefs({ notifications_enabled: true });
      await permission;
    } catch { setError('فعال‌سازی اعلان انجام نشد؛ دوباره تلاش کنید.'); }
    finally { setState(getBrowserPushState()); setDeviceEnabled(isBrowserNotificationPreferenceEnabled(userId)); setBusy(false); }
  };
  const hint = !enabled ? 'اعلان مرورگر و صدا در این دستگاه خاموش است.'
    : state.status === 'not-installed' ? 'در آیفون، ابتدا از Share گزینه Add to Home Screen را بزنید و برنامه را از آیکون آن باز کنید.'
    : state.status === 'permission-denied' ? 'گزینه فعال است؛ مجوز اعلان این سایت را از تنظیمات مرورگر فعال کنید.'
    : state.status === 'unsupported' ? 'نمایش اعلان سیستمی به اتصال امن و مرورگر پشتیبانی‌شده نیاز دارد.'
    : state.status === 'permission-required' ? 'به‌صورت پیش‌فرض فعال است؛ برای نمایش اعلان سیستمی، مجوز مرورگر را بدهید.'
    : state.status === 'error' ? 'اعلان هنگام بازبودن برنامه فعال است؛ ثبت اعلان پس‌زمینه ناموفق بود.'
    : state.status === 'registering' ? 'در حال ثبت اعلان پس‌زمینه…' : 'اعلان و صدا در این مرورگر فعال است.';
  return (
    <section className="rounded-xl border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-900/30" aria-label="اعلان مرورگر و صدا">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2"><BellRing className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-400" /><span className="text-sm text-gray-700 dark:text-gray-300">اعلان مرورگر و صدا</span></div>
        <button type="button" role="switch" aria-label="اعلان مرورگر و صدا" aria-checked={enabled} disabled={busy || !userId}
          className={`relative h-5 w-10 shrink-0 rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          onClick={() => { if (enabled) { setBusy(true); void disableBrowserNotifications().finally(() => { setBusy(false); setState(getBrowserPushState()); setDeviceEnabled(isBrowserNotificationPreferenceEnabled(userId)); }); } else void activate(); }}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${enabled ? 'right-0.5' : 'left-0.5'}`} />
        </button>
      </div>
      <p className="mt-2 text-xs leading-6 text-gray-500 dark:text-gray-400" role="status">{error || hint}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin text-teal-600" />}
        {enabled && state.status === 'permission-required' && <button type="button" disabled={busy || !userId} onClick={() => void activate()} className="rounded-lg bg-teal-600 px-3 py-2 text-xs text-white disabled:opacity-50">دادن مجوز مرورگر</button>}
        {enabled && granted && userId && <button type="button" disabled={busy} title="تست صدا و اعلان" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs text-teal-700 dark:border-gray-600 dark:text-teal-300" onClick={() => { unlockNotificationSound(); void notifyBrowser({ id: `test-${crypto.randomUUID()}`, action_url: '/' }, userId); }}><Volume2 className="h-4 w-4" />تست صدا و اعلان</button>}
        {enabled && state.status === 'error' && <button type="button" disabled={busy} onClick={() => void activate()} className="px-2 py-2 text-xs text-teal-700 underline dark:text-teal-300">تلاش مجدد</button>}
      </div>
    </section>
  );
}
