import { useState, useRef, useEffect } from 'react';
import {
  User,
  ChevronDown,
  Check,
  Palette,
  Key,
  Download,
  BookOpen,
  LogOut,
} from 'lucide-react';

import { logAudit } from '../../../lib/audit';
import { getCurrentAuthUserId } from '../../../features/auth';
import type {
  LayoutUserProfile,
  LayoutUserStatus,
} from '../types/layoutUser';
import type {
  BeforeInstallPromptEvent,
  PwaInstallChoice,
} from '../types/pwa';
import {
  fetchLayoutUserPresenceStatus,
  upsertLayoutUserPresence,
} from '../repositories/layoutUserRepository';
import type { PageId } from '../types';
import { PasswordModal } from './PasswordModal';
import { UserSettingsModal } from './UserSettingsModal';
import { PwaInstallModal } from './PwaInstallModal';

const STATUS_OPTIONS = [
  { key: 'online', label: 'آنلاین هستم', dot: 'bg-green-500' },
  { key: 'busy', label: 'مشغول هستم', dot: 'bg-amber-500' },
  { key: 'away', label: 'دور از دستگاه', dot: 'bg-blue-500' },
  { key: 'dnd', label: 'مزاحم نشوید', dot: 'bg-red-500' },
  { key: 'offline', label: 'آفلاین', dot: 'bg-gray-400' },
] as const;

export interface ProfileDropdownProps {
  userProfile: LayoutUserProfile | null;
  onPageChange: (page: PageId) => void;
  onLogout: () => void;
  installPrompt: BeforeInstallPromptEvent | null;
  onPromptInstall: () => Promise<
    PwaInstallChoice['outcome'] | null
  >;
}

export function ProfileDropdown({
  userProfile,
  onPageChange,
  onLogout,
  installPrompt,
  onPromptInstall,
}: ProfileDropdownProps) {
  const [open, setOpen] = useState(false);
  const [showStatusFlyout, setShowStatusFlyout] =
    useState(false);
  const [showPasswordModal, setShowPasswordModal] =
    useState(false);
  const [showSettingsModal, setShowSettingsModal] =
    useState(false);
  const [showPwaModal, setShowPwaModal] =
    useState(false);
  const [status, setStatus] = useState<LayoutUserStatus>(
    'online'
  );
  const ref = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem(
      'user_status'
    ) as LayoutUserStatus | null;
    if (saved) setStatus(saved);
    (async () => {
      const userId = await getCurrentAuthUserId();
      if (!userId) return;
      const stored =
        await fetchLayoutUserPresenceStatus(userId);
      if (stored) {
        setStatus(stored);
        localStorage.setItem('user_status', stored);
      }
    })();
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node)
      ) {
        setOpen(false);
        setShowStatusFlyout(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () =>
      document.removeEventListener('mousedown', handler);
  }, []);

  const selectStatus = async (s: LayoutUserStatus) => {
    setStatus(s);
    localStorage.setItem('user_status', s);
    setShowStatusFlyout(false);
    setOpen(false);
    const userId = await getCurrentAuthUserId();
    if (userId) {
      await upsertLayoutUserPresence({
        userId,
        status: s,
        isOnline: s !== 'offline',
        lastSeen: new Date().toISOString(),
      });
    }
    logAudit({
      module: 'profile',
      action: 'status_changed',
      details: `وضعیت به "${
        STATUS_OPTIONS.find((o) => o.key === s)?.label
      }" تغییر کرد`,
      severity: 'info',
    });
  };

  const currentStatus =
    STATUS_OPTIONS.find((o) => o.key === status) ??
    STATUS_OPTIONS[0];
  const displayName =
    userProfile?.full_name ||
    userProfile?.email ||
    'کاربر';
  const avatarLetter = displayName
    .charAt(0)
    .toUpperCase();

  const openPassword = () => {
    setOpen(false);
    setShowStatusFlyout(false);
    setShowPasswordModal(true);
  };
  const openSettings = () => {
    setOpen(false);
    setShowStatusFlyout(false);
    setShowSettingsModal(true);
  };
  const openPwa = () => {
    setOpen(false);
    setShowStatusFlyout(false);
    setShowPwaModal(true);
  };

  return (
    <>
      {showPasswordModal && (
        <PasswordModal
          onClose={() => setShowPasswordModal(false)}
        />
      )}
      {showSettingsModal && (
        <UserSettingsModal
          onClose={() => setShowSettingsModal(false)}
        />
      )}
      {showPwaModal && (
        <PwaInstallModal
          installPrompt={installPrompt}
          onPromptInstall={onPromptInstall}
          onClose={() => setShowPwaModal(false)}
        />
      )}

      <div ref={ref} className="relative">
        {/* Trigger button */}
        <button
          onClick={() => {
            setOpen((v) => !v);
            setShowStatusFlyout(false);
          }}
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl hover:bg-white/60 dark:hover:bg-gray-700/60 transition-colors"
        >
          <div className="relative flex-shrink-0">
            {userProfile?.avatar_url ? (
              <img
                src={userProfile.avatar_url}
                alt="پروفایل"
                className="w-9 h-9 rounded-full object-cover ring-2 ring-white dark:ring-gray-600 shadow"
              />
            ) : (
              <div className="w-9 h-9 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center ring-2 ring-white dark:ring-gray-600 shadow">
                <span className="text-white text-sm font-bold">
                  {avatarLetter}
                </span>
              </div>
            )}
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${currentStatus.dot}`}
            />
          </div>
          <div className="hidden sm:block text-right leading-tight">
            <p className="text-sm font-semibold text-gray-800 dark:text-white leading-none">
              {displayName}
            </p>
            {userProfile?.position && (
              <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-none">
                {userProfile.position}
              </p>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>

        {/* Dropdown */}
        {open && (
          <div
            className="absolute left-0 top-full mt-2 w-60 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-[200] overflow-visible"
            dir="rtl"
          >
            {/* Header */}
            <div className="px-4 py-3.5 border-b border-gray-100 dark:border-gray-700 rounded-t-2xl overflow-hidden relative">
              <div
                className="absolute top-0 left-0 right-0 h-1"
                style={{
                  background:
                    'linear-gradient(to left, var(--accent, #0d9488), transparent)',
                }}
              />
              <div className="flex items-center gap-3 mt-1">
                <div className="relative flex-shrink-0">
                  {userProfile?.avatar_url ? (
                    <img
                      src={userProfile.avatar_url}
                      alt="پروفایل"
                      className="w-11 h-11 rounded-full object-cover shadow"
                    />
                  ) : (
                    <div className="w-11 h-11 rounded-full bg-gradient-to-br from-teal-400 to-teal-600 flex items-center justify-center shadow">
                      <span className="text-white text-base font-bold">
                        {avatarLetter}
                      </span>
                    </div>
                  )}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 ${currentStatus.dot}`}
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-gray-900 dark:text-white truncate">
                    {displayName}
                  </p>
                  {userProfile?.position && (
                    <p
                      className="text-xs truncate mt-0.5"
                      style={{
                        color: 'var(--accent, #0d9488)',
                      }}
                    >
                      {userProfile.position}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Items */}
            <div className="py-1.5">
              {/* 1. Profile */}
              <button
                onClick={() => {
                  onPageChange('profile');
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-teal-50 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
                  <User className="w-3.5 h-3.5 text-teal-600 dark:text-teal-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200">
                  پروفایل کاربری
                </span>
              </button>

              {/* 2. User Settings */}
              <button
                onClick={openSettings}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                  <Palette className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200">
                  تنظیمات کاربری
                </span>
              </button>

              {/* 3. Change Password */}
              <button
                onClick={openPassword}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-amber-50 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                  <Key className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200">
                  تغییر رمز عبور
                </span>
              </button>

              {/* 4. Status */}
              <div ref={statusRef} className="relative">
                <button
                  onClick={() =>
                    setShowStatusFlyout((v) => !v)
                  }
                  className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
                >
                  <div className="w-7 h-7 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                    <span
                      className={`w-3 h-3 rounded-full ${currentStatus.dot}`}
                    />
                  </div>
                  <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">
                    وضعیت
                  </span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 text-gray-400 transition-transform ${
                      showStatusFlyout ? 'rotate-180' : ''
                    }`}
                  />
                </button>
                {showStatusFlyout && (
                  <div
                    className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-[300] overflow-hidden"
                    dir="rtl"
                  >
                    <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                      <p className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
                        وضعیت کاربر
                      </p>
                    </div>
                    {STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() =>
                          selectStatus(opt.key)
                        }
                        className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                      >
                        <span
                          className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${opt.dot}`}
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">
                          {opt.label}
                        </span>
                        {status === opt.key && (
                          <Check className="w-3.5 h-3.5 text-teal-500" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. PWA Install */}
              <button
                onClick={openPwa}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-sky-50 dark:bg-sky-900/30 flex items-center justify-center flex-shrink-0">
                  <Download className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200 flex-1">
                  دریافت نسخه تحت وب
                </span>
                {installPrompt && (
                  <span className="text-[10px] font-bold text-white bg-sky-500 rounded-full px-1.5 py-0.5 leading-tight">
                    جدید
                  </span>
                )}
              </button>

              <div className="mx-4 my-1 border-t border-gray-100 dark:border-gray-700" />

              {/* 6. Tutorial */}
              <button
                onClick={() => {
                  onPageChange('tutorial');
                  setOpen(false);
                }}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/60 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-violet-50 dark:bg-violet-900/30 flex items-center justify-center flex-shrink-0">
                  <BookOpen className="w-3.5 h-3.5 text-violet-600 dark:text-violet-400" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-200">
                  آموزش سایت
                </span>
              </button>

              {/* 7. Logout */}
              <button
                onClick={onLogout}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-right"
              >
                <div className="w-7 h-7 rounded-lg bg-red-50 dark:bg-red-900/30 flex items-center justify-center flex-shrink-0">
                  <LogOut className="w-3.5 h-3.5 text-red-500" />
                </div>
                <span className="text-sm text-red-600 dark:text-red-400 font-medium">
                  خروج از سامانه
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
