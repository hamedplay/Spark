import React, { useState, useRef, useEffect } from 'react';
import {
  LayoutDashboard, CheckSquare, FileBarChart2, LogOut, StickyNote, Phone, Menu,
  ChevronRight, Calendar, BookOpen, MessageCircle, Video, LayoutGrid, Settings,
  X, Bot, Key, Sun, Moon, User, ChevronDown, Check, Palette, Download,
  Smartphone, Monitor, Share2, ExternalLink, MessagesSquare,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logAudit } from '../lib/audit';
import { NotificationBell } from './NotificationBell';
import { useTheme, ACCENT_COLORS, AccentKey } from '../context/ThemeContext';

interface UserProfile {
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  position: string | null;
}

type PageId = 'meetings' | 'create-meeting' | 'tasks' | 'reports' | 'notes' | 'profile' | 'contacts' | 'contacts_email' | 'calendar' | 'tutorial' | 'admin' | 'chat' | 'video-conference' | 'portal-config' | 'spark' | 'channels';

interface LayoutProps {
  children: React.ReactNode;
  activePage: PageId;
  onPageChange: (page: PageId) => void;
  isAdmin?: boolean;
  sparkVisible?: boolean;
  userPermissions?: Record<string, boolean> | null | undefined;
}

export type { PageId };

const STATUS_OPTIONS = [
  { key: 'online',  label: 'آنلاین هستم',   dot: 'bg-green-500' },
  { key: 'busy',    label: 'مشغول هستم',    dot: 'bg-amber-500' },
  { key: 'away',    label: 'دور از دستگاه', dot: 'bg-blue-500'  },
  { key: 'dnd',     label: 'مزاحم نشوید',   dot: 'bg-red-500'   },
  { key: 'offline', label: 'آفلاین',         dot: 'bg-gray-400'  },
] as const;

type UserStatus = typeof STATUS_OPTIONS[number]['key'];

// ── Portal button ──────────────────────────────────────────────────────────────
function PortalButton({ activePage, onPageChange }: { activePage: PageId; onPageChange: (p: PageId) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        title="پرتال پیکربندی"
        className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${activePage === 'portal-config' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'}`}
      >
        <LayoutGrid className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1.5 w-44 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden" dir="rtl">
          <button
            onClick={() => { onPageChange('portal-config'); setOpen(false); }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
          >
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <Settings className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">پیکربندی</span>
          </button>
        </div>
      )}
    </div>
  );
}

// ── Change Password Modal ──────────────────────────────────────────────────────
function PasswordModal({ onClose }: { onClose: () => void }) {
  const [pwForm, setPwForm] = useState({ current: '', next: '', confirm: '' });
  const [pwLoading, setPwLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  const changePassword = async () => {
    setError('');
    if (!pwForm.current || !pwForm.next) { setError('تمام فیلدها الزامی است'); return; }
    if (pwForm.next !== pwForm.confirm) { setError('رمز عبور جدید و تکرار آن مطابقت ندارند'); return; }
    if (pwForm.next.length < 6) { setError('رمز عبور باید حداقل ۶ کاراکتر باشد'); return; }
    setPwLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwForm.next });
      if (error) { setError('خطا: ' + error.message); return; }
      logAudit({ module: 'auth', action: 'password_changed', details: 'رمز عبور تغییر کرد', severity: 'warning' });
      setSuccess(true);
      setTimeout(onClose, 1500);
    } finally { setPwLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center">
              <Key className="w-4.5 h-4.5 text-amber-600 dark:text-amber-400" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">تغییر رمز عبور</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          {success ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <Check className="w-6 h-6 text-green-600" />
              </div>
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium">رمز عبور با موفقیت تغییر کرد</p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">رمز عبور فعلی</label>
                <input
                  type="password"
                  value={pwForm.current}
                  onChange={e => setPwForm(f => ({ ...f, current: e.target.value }))}
                  className="w-full text-sm px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
                  placeholder="••••••••"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">رمز عبور جدید</label>
                <input
                  type="password"
                  value={pwForm.next}
                  onChange={e => setPwForm(f => ({ ...f, next: e.target.value }))}
                  className="w-full text-sm px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
                  placeholder="حداقل ۶ کاراکتر"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">تکرار رمز عبور جدید</label>
                <input
                  type="password"
                  value={pwForm.confirm}
                  onChange={e => setPwForm(f => ({ ...f, confirm: e.target.value }))}
                  className="w-full text-sm px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500"
                  placeholder="••••••••"
                />
              </div>
              {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={changePassword}
                  disabled={pwLoading}
                  className="flex-1 py-2.5 bg-teal-500 hover:bg-teal-600 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-50"
                >
                  {pwLoading ? 'در حال ذخیره...' : 'ذخیره'}
                </button>
                <button
                  onClick={onClose}
                  className="px-4 py-2.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
                >
                  انصراف
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── User Settings Modal (color theme + dark/light) ─────────────────────────────
function SettingsModal({ onClose }: { onClose: () => void }) {
  const { theme, toggleTheme, accent, setAccent } = useTheme();

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <Palette className="w-4.5 h-4.5 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">تنظیمات کاربری</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-5">
          {/* Dark / Light mode */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">حالت نمایش</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => theme === 'dark' && toggleTheme()}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${theme === 'light' ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}
              >
                <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center">
                  <Sun className="w-4 h-4 text-amber-500" />
                </div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">روز</span>
                {theme === 'light' && <Check className="w-3 h-3 text-teal-500" />}
              </button>
              <button
                onClick={() => theme === 'light' && toggleTheme()}
                className={`flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all ${theme === 'dark' ? 'border-teal-500 bg-teal-50 dark:bg-teal-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500'}`}
              >
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center">
                  <Moon className="w-4 h-4 text-blue-500" />
                </div>
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">شب</span>
                {theme === 'dark' && <Check className="w-3 h-3 text-teal-500" />}
              </button>
            </div>
          </div>

          {/* Accent color palette */}
          <div>
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">رنگ اصلی</p>
            <div className="grid grid-cols-5 gap-2">
              {ACCENT_COLORS.map(c => (
                <button
                  key={c.key}
                  onClick={() => setAccent(c.key as AccentKey)}
                  title={c.label}
                  className={`group flex flex-col items-center gap-1.5 p-2 rounded-xl transition-all ${accent === c.key ? 'bg-gray-100 dark:bg-gray-700 ring-2 ring-offset-1 dark:ring-offset-gray-800' : 'hover:bg-gray-50 dark:hover:bg-gray-700/60'}`}
                  style={accent === c.key ? { ringColor: c.hex } : {}}
                >
                  <span
                    className="w-7 h-7 rounded-full shadow-sm flex items-center justify-center transition-transform group-hover:scale-110"
                    style={{ backgroundColor: c.hex }}
                  >
                    {accent === c.key && <Check className="w-3 h-3 text-white" />}
                  </span>
                  <span className="text-[10px] text-gray-500 dark:text-gray-400 leading-tight text-center">{c.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-5 pb-5">
          <button onClick={onClose} className="w-full py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition-colors">
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Profile dropdown in top bar ────────────────────────────────────────────────
function ProfileDropdown({
  userProfile, onPageChange, onLogout,
}: {
  userProfile: UserProfile | null;
  onPageChange: (p: PageId) => void;
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [showStatusFlyout, setShowStatusFlyout] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showPwaModal, setShowPwaModal] = useState(false);
  const [status, setStatus] = useState<UserStatus>('online');
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const ref = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('user_status') as UserStatus | null;
    if (saved) setStatus(saved);
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('user_presence').select('status').eq('user_id', user.id).maybeSingle();
      if (data?.status) {
        setStatus(data.status as UserStatus);
        localStorage.setItem('user_status', data.status);
      }
    })();
  }, []);

  useEffect(() => {
    // Capture deferred install prompt
    if ((window as any).deferredInstallPrompt) {
      setInstallPrompt((window as any).deferredInstallPrompt);
    }
    const onInstallable = () => setInstallPrompt((window as any).deferredInstallPrompt);
    window.addEventListener('pwa-installable', onInstallable);
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      (window as any).deferredInstallPrompt = e;
    });
    return () => window.removeEventListener('pwa-installable', onInstallable);
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setShowStatusFlyout(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const selectStatus = async (s: UserStatus) => {
    setStatus(s);
    localStorage.setItem('user_status', s);
    setShowStatusFlyout(false);
    setOpen(false);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('user_presence').upsert(
        { user_id: user.id, last_seen: new Date().toISOString(), is_online: s !== 'offline', status: s },
        { onConflict: 'user_id' }
      );
    }
    logAudit({ module: 'profile', action: 'status_changed', details: `وضعیت به "${STATUS_OPTIONS.find(o => o.key === s)?.label}" تغییر کرد`, severity: 'info' });
  };

  const handleAndroidInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
      (window as any).deferredInstallPrompt = null;
      setShowPwaModal(false);
    }
  };

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone;
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  const appUrl = window.location.origin;

  const currentStatus = STATUS_OPTIONS.find(o => o.key === status) ?? STATUS_OPTIONS[0];
  const displayName = userProfile?.full_name || userProfile?.email || 'کاربر';
  const avatarLetter = displayName.charAt(0).toUpperCase();

  const openPassword = () => { setOpen(false); setShowStatusFlyout(false); setShowPasswordModal(true); };
  const openSettings = () => { setOpen(false); setShowStatusFlyout(false); setShowSettingsModal(true); };
  const openPwa = () => { setOpen(false); setShowStatusFlyout(false); setShowPwaModal(true); };

  return (
    <>
      {showPasswordModal && <PasswordModal onClose={() => setShowPasswordModal(false)} />}
      {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} />}

      {/* PWA Install Modal */}
      {showPwaModal && (
        <div className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center p-4 bg-black/50" onClick={() => setShowPwaModal(false)}>
          <div
            className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden"
            style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <div className="flex items-center gap-3">
                <img src="/icons/icon-192x192.png" alt="Spark" className="w-10 h-10 rounded-xl shadow" />
                <div>
                  <p className="text-sm font-bold text-gray-900 dark:text-white">نصب اسپارک</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">دریافت نسخه تحت وب (PWA)</p>
                </div>
              </div>
              <button onClick={() => setShowPwaModal(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>

            <div className="p-4 space-y-3" dir="rtl">
              {isStandalone ? (
                <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800">
                  <Check className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                  <p className="text-sm text-green-700 dark:text-green-300 font-medium">اسپارک قبلاً روی این دستگاه نصب شده است</p>
                </div>
              ) : (
                <>
                  {/* iOS button */}
                  {(isIOS || (!isAndroid && !installPrompt)) && (
                    <a
                      href={appUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-3 w-full p-4 rounded-xl bg-gray-900 hover:bg-black text-white transition-colors"
                      onClick={() => setShowPwaModal(false)}
                    >
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Smartphone className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 text-right">
                        <p className="text-sm font-bold">iPhone / iPad</p>
                        <p className="text-xs text-white/70">در Safari باز کنید ← Share ← Add to Home Screen</p>
                      </div>
                      <ExternalLink className="w-4 h-4 text-white/60 flex-shrink-0" />
                    </a>
                  )}

                  {/* Android / Desktop install button */}
                  {installPrompt ? (
                    <button
                      onClick={handleAndroidInstall}
                      className="flex items-center gap-3 w-full p-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white transition-colors"
                    >
                      <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Download className="w-5 h-5 text-white" />
                      </div>
                      <div className="flex-1 text-right">
                        <p className="text-sm font-bold">{isAndroid ? 'اندروید' : 'دسکتاپ'}</p>
                        <p className="text-xs text-white/80">برای نصب اینجا ضربه بزنید</p>
                      </div>
                      <Download className="w-4 h-4 text-white/60 flex-shrink-0" />
                    </button>
                  ) : (
                    !isIOS && (
                      <div className="flex items-center gap-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600">
                        <div className="w-10 h-10 rounded-xl bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                          <Monitor className="w-5 h-5 text-gray-500 dark:text-gray-400" />
                        </div>
                        <div className="flex-1 text-right">
                          <p className="text-sm font-semibold text-gray-800 dark:text-white">دسکتاپ / اندروید</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">آیکن ⊕ در نوار آدرس مرورگر را بزنید</p>
                        </div>
                      </div>
                    )
                  )}

                  {/* Web link */}
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50">
                    <ExternalLink className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                    <span className="text-xs text-gray-400">لینک وب:</span>
                    <a href={appUrl} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 dark:text-blue-400 hover:underline truncate font-medium">{appUrl}</a>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div ref={ref} className="relative">
        {/* Trigger button */}
        <button
          onClick={() => { setOpen(v => !v); setShowStatusFlyout(false); }}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors"
        >
          <div className="relative flex-shrink-0">
            {userProfile?.avatar_url ? (
              <img src={userProfile.avatar_url} alt="پروفایل" className="w-9 h-9 rounded-full object-cover ring-2 ring-white dark:ring-gray-600 shadow" />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center ring-2 ring-white dark:ring-gray-600 shadow">
                <span className="text-white text-sm font-bold">{avatarLetter}</span>
              </div>
            )}
            <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${currentStatus.dot}`} />
          </div>
          <div className="hidden sm:block text-right leading-tight">
            <p className="text-sm font-semibold text-gray-800 dark:text-white leading-none">{displayName}</p>
            {userProfile?.position && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-none">{userProfile.position}</p>
            )}
          </div>
          <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown */}
        {open && (
          <div className="absolute left-0 top-full mt-2 w-60 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-[200] overflow-visible" dir="rtl">
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-gray-100 dark:border-gray-700 rounded-t-2xl overflow-hidden relative">
              <div className="absolute top-0 left-0 right-0 h-1" style={{ background: `linear-gradient(to left, var(--accent, #0d9488), transparent)` }} />
              <div className="flex items-center gap-3 mt-1">
                <div className="relative flex-shrink-0">
                  {userProfile?.avatar_url ? (
                    <img src={userProfile.avatar_url} alt="پروفایل" className="w-11 h-11 rounded-full object-cover shadow" />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow">
                      <span className="text-white text-base font-bold">{avatarLetter}</span>
                    </div>
                  )}
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 ${currentStatus.dot}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{displayName}</p>
                  {userProfile?.position && <p className="text-xs truncate mt-0.5" style={{ color: 'var(--accent, #0d9488)' }}>{userProfile.position}</p>}
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="py-1.5">
              {/* 1. Profile */}
              <button
                onClick={() => { onPageChange('profile'); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
                  <User className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200">پروفایل کاربری</span>
              </button>

              {/* 2. Change Password */}
              <button
                onClick={openPassword}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                  <Key className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200">تغییر رمز عبور</span>
              </button>

              {/* 3. Status */}
              <div ref={statusRef} className="relative">
                <button
                  onClick={() => setShowStatusFlyout(v => !v)}
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
                >
                  <div className="w-7 h-7 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                    <span className={`w-3 h-3 rounded-full ${currentStatus.dot}`} />
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">وضعیت</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${showStatusFlyout ? 'rotate-180' : ''}`} />
                </button>
                {showStatusFlyout && (
                  <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-[300] overflow-hidden" dir="rtl">
                    <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                      <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">وضعیت کاربر</p>
                    </div>
                    {STATUS_OPTIONS.map(opt => (
                      <button
                        key={opt.key}
                        onClick={() => selectStatus(opt.key)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                      >
                        <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${opt.dot}`} />
                        <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">{opt.label}</span>
                        {status === opt.key && <Check className="w-3.5 h-3.5 text-teal-500" />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 4. User Settings */}
              <button
                onClick={openSettings}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <Palette className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200">تنظیمات کاربری</span>
              </button>

              {/* 5. PWA Install */}
              <button
                onClick={openPwa}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-sky-50 dark:bg-sky-900/30 flex items-center justify-center flex-shrink-0">
                  <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">دریافت نسخه تحت وب</span>
                {installPrompt && (
                  <span className="text-[10px] font-bold text-white bg-sky-500 rounded-full px-1.5 py-0.5 leading-tight">جدید</span>
                )}
              </button>

              <div className="mx-4 my-1 border-t border-gray-100 dark:border-gray-700" />

              {/* 6. Tutorial */}
              <button
                onClick={() => { onPageChange('tutorial'); setOpen(false); }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200">آموزش سایت</span>
              </button>

              {/* 7. Logout */}
              <button
                onClick={onLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                  <LogOut className="w-3.5 h-3.5 text-red-500" />
                </div>
                <span className="text-sm text-red-600 dark:text-red-400 font-medium">خروج از سامانه</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// Maps each menu item to its permission key
const MENU_PERMISSION_KEY: Record<string, string> = {
  'meetings':         'meetings',
  'calendar':         'calendar',
  'chat':             'chat',
  'channels':         'channels',
  'video-conference': 'video_conference',
  'tasks':            'tasks',
  'notes':            'notes',
  'contacts':         'contacts',
  'reports':          'reports',
  'spark':            'spark',
};

export function Layout({ children, activePage, onPageChange, isAdmin = false, userPermissions, sparkVisible = true }: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    return saved !== null ? saved === 'true' : true;
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const { accent } = useTheme();
  const accentColor = ACCENT_COLORS.find(c => c.key === accent)?.hex ?? '#0d9488';

  // Load sidebar default from system_config if user hasn't set a preference yet
  useEffect(() => {
    if (localStorage.getItem('sidebar_collapsed') !== null) return;
    (async () => {
      const { data } = await supabase
        .from('system_config')
        .select('value')
        .eq('section', 'ui')
        .eq('key', 'sidebar_default_collapsed')
        .maybeSingle();
      if (data) {
        const defaultCollapsed = data.value !== 'false';
        setIsCollapsed(defaultCollapsed);
        localStorage.setItem('sidebar_collapsed', String(defaultCollapsed));
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('full_name, email, avatar_url, position')
        .eq('user_id', user.id)
        .maybeSingle();
      if (data) setUserProfile(data as UserProfile);

      await supabase.from('user_presence').upsert(
        { user_id: user.id, last_seen: new Date().toISOString(), is_online: true, status: (localStorage.getItem('user_status') as string) || 'online' },
        { onConflict: 'user_id' }
      );

      const interval = setInterval(async () => {
        const s = localStorage.getItem('user_status') || 'online';
        if (s !== 'offline') {
          await supabase.from('user_presence').upsert(
            { user_id: user.id, last_seen: new Date().toISOString(), is_online: true, status: s },
            { onConflict: 'user_id' }
          );
        }
      }, 60_000);

      const markOffline = () => {
        supabase.from('user_presence').update({ is_online: false }).eq('user_id', user.id).then(() => {});
      };
      window.addEventListener('beforeunload', markOffline);

      return () => {
        clearInterval(interval);
        window.removeEventListener('beforeunload', markOffline);
      };
    })();
  }, []);

  useEffect(() => {
    // Clear old dismissed flag so users can re-trigger install
    localStorage.removeItem('pwa_install_dismissed');

    const handler = (e: Event) => {
      e.preventDefault();
      setInstallPrompt(e);
      setShowInstallBanner(true);
    };
    window.addEventListener('beforeinstallprompt', handler as EventListener);
    // Also check if the prompt was already captured before this component mounted
    if ((window as any).deferredInstallPrompt) {
      setInstallPrompt((window as any).deferredInstallPrompt);
    }
    return () => window.removeEventListener('beforeinstallprompt', handler as EventListener);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
      (window as any).deferredInstallPrompt = null;
    }
    setShowInstallBanner(false);
  };

  const dismissInstallBanner = () => {
    setShowInstallBanner(false);
  };

  const handleLogout = async () => {
    logAudit({ module: 'auth', action: 'logout', details: 'خروج از سامانه', severity: 'info' });
    await supabase.auth.signOut();
  };

  const allMenuItems = [
    { id: 'meetings',         title: 'درخواست جلسه',   icon: LayoutDashboard },
    { id: 'calendar',         title: 'تقویم',           icon: Calendar        },
    { id: 'chat',             title: 'چت سازمانی',      icon: MessageCircle   },
    { id: 'channels',         title: 'کانال‌ها',         icon: MessagesSquare  },
    { id: 'video-conference', title: 'ویدیو کنفرانس',   icon: Video           },
    { id: 'tasks',            title: 'اقدامات',         icon: CheckSquare     },
    { id: 'notes',            title: 'یادداشت‌ها',      icon: StickyNote      },
    { id: 'contacts',         title: 'مخاطبین',         icon: Phone           },
    { id: 'reports',          title: 'گزارشات',         icon: FileBarChart2   },
    { id: 'spark',            title: 'اسپارک (دستیار)', icon: Bot             },
  ];

  const menuItems = allMenuItems.filter(item => {
    if (item.id === 'spark' && !sparkVisible) return false;
    if (isAdmin) return true;
    const permKey = MENU_PERMISSION_KEY[item.id];
    if (!permKey) return true;
    if (userPermissions === null) return true;
    if (userPermissions === undefined) return false;
    return !!userPermissions[permKey];
  });

  const handlePageChange = (page: typeof activePage) => {
    onPageChange(page);
    setIsMobileMenuOpen(false);
    if (page === 'admin') {
      window.history.pushState({}, '', '/admin');
    } else if (window.location.pathname.includes('/admin')) {
      window.history.pushState({}, '', '/');
    }
  };

  // Shared top bar — full-width fixed strip with card-style background
  const TopBar = () => (
    <div
      className="flex-shrink-0 bg-white dark:bg-gray-800"
      style={{
        borderBottom: `2px solid ${accentColor}22`,
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* Accent line at top */}
      <div className="h-0.5 w-full" style={{ background: `linear-gradient(to left, ${accentColor}, ${accentColor}44)` }} />
      <div className="flex items-center justify-between px-4 shadow-sm" style={{ height: '52px' }}>
        {/* Left side */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Mobile hamburger placeholder — keep width consistent */}
        </div>
        {/* Right side: actions */}
        <div className="flex items-center gap-1.5 flex-1 justify-end">
          {installPrompt && (
            <button
              onClick={handleInstall}
              className="p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              title="نصب اپلیکیشن"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
          <NotificationBell onNavigate={onPageChange} />
          {isAdmin && <PortalButton activePage={activePage} onPageChange={onPageChange} />}
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />
          <ProfileDropdown
            userProfile={userProfile}
            onPageChange={handlePageChange}
            onLogout={handleLogout}
          />
        </div>
      </div>
    </div>
  );

  return (
    <div
      className="flex bg-gray-100 dark:bg-gray-900 rtl transition-colors overflow-hidden"
      style={{ height: '100dvh' }}
      dir="rtl"
    >
      {/* PWA Install Banner */}
      {showInstallBanner && (
        <div className="fixed bottom-0 left-0 right-0 z-[9999] p-3 pointer-events-none" dir="rtl">
          <div className="max-w-sm mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 pointer-events-auto">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
              <img src="/logo_spark.png" alt="Spark" className="w-full h-full object-contain" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-800 dark:text-white">نصب اپلیکیشن</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">برای دسترسی سریع‌تر نصب کنید</p>
            </div>
            <button onClick={handleInstall} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors touch-manipulation flex-shrink-0">نصب</button>
            <button onClick={dismissInstallBanner} className="p-1.5 text-gray-400 hover:text-gray-600 touch-manipulation flex-shrink-0"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="lg:hidden fixed z-50 p-1.5 bg-white dark:bg-gray-800 rounded-xl shadow-lg"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          right: 'max(0.75rem, env(safe-area-inset-right))',
        }}
      >
        <Menu className="w-5 h-5 text-gray-600 dark:text-gray-300" />
      </button>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/50 z-40" onClick={() => setIsMobileMenuOpen(false)} />
      )}

      {/* Sidebar */}
      <div
        className={`${isCollapsed ? 'w-16' : 'w-52'} bg-white dark:bg-gray-800 shadow-lg transition-all duration-300 fixed lg:relative z-50 h-full flex flex-col ${isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        {/* Sidebar header: collapse toggle */}
        <div className="flex items-center justify-center px-3 h-14 border-b border-gray-100 dark:border-gray-700 flex-shrink-0 relative">
          <button
            onClick={() => { const next = !isCollapsed; setIsCollapsed(next); localStorage.setItem('sidebar_collapsed', String(next)); }}
            className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors hidden lg:flex flex-shrink-0"
          >
            {isCollapsed
              ? <ChevronRight className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              : <Menu className="w-4 h-4 text-gray-500 dark:text-gray-400" />}
          </button>
        </div>

        {/* Nav items */}
        <nav className="flex-1 overflow-y-auto py-2 px-2 space-y-0.5" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = activePage === item.id || (activePage === 'create-meeting' && item.id === 'meetings');
            return (
              <button
                key={item.id}
                onClick={() => handlePageChange(item.id as typeof activePage)}
                className={`w-full flex items-center gap-2.5 py-2.5 rounded-xl transition-all text-sm font-medium ${isCollapsed ? 'justify-center px-2' : 'px-2.5'} ${
                  isActive
                    ? 'shadow-sm'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700/60 hover:text-gray-800 dark:hover:text-gray-200'
                }`}
                style={isActive ? {
                  backgroundColor: accentColor + '18',
                  color: accentColor,
                } : {}}
                title={isCollapsed ? item.title : undefined}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!isCollapsed && <span className="truncate">{item.title}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0" style={{ height: '100dvh' }}>
        {/* Always-visible top bar */}
        <TopBar />

        {/* Page content */}
        {(activePage === 'calendar' || activePage === 'chat' || activePage === 'channels' || activePage === 'video-conference' || activePage === 'portal-config') ? (
          <div className="flex-1 overflow-hidden min-h-0">
            {children}
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto min-h-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
            <div className="max-w-[95rem] mx-auto px-3 lg:px-6 w-full py-6">
              <div className="lg:pr-2">
                {children}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
