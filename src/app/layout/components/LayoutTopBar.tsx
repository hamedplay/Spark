import { useState, useRef, useEffect } from 'react';
import {
  LayoutGrid,
  Settings,
  Download,
} from 'lucide-react';

import { NotificationBell } from '../../../components/NotificationBell';
import type { PageId } from '../types';
import type {
  BeforeInstallPromptEvent,
  PwaInstallChoice,
} from '../types/pwa';
import type {
  LayoutUserProfile,
} from '../types/layoutUser';
import { ProfileDropdown } from './ProfileDropdown';

function PortalButton({
  activePage,
  onPageChange,
}: {
  activePage: PageId;
  onPageChange: (p: PageId) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        ref.current &&
        !ref.current.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () =>
      document.removeEventListener(
        'mousedown',
        handler
      );
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        title="پرتال پیکربندی"
        className={`w-10 h-10 flex items-center justify-center rounded-xl transition-colors ${
          activePage === 'portal-config'
            ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
            : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400'
        }`}
      >
        <LayoutGrid className="w-5 h-5" />
      </button>
      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 w-44 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden"
          dir="rtl"
        >
          <button
            onClick={() => {
              onPageChange('portal-config');
              setOpen(false);
            }}
            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
          >
            <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
              <Settings className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
              پیکربندی
            </span>
          </button>
        </div>
      )}
    </div>
  );
}

export interface LayoutTopBarProps {
  userProfile: LayoutUserProfile | null;
  onPageChange: (page: PageId) => void;
  onLogout: () => void;
  isAdmin: boolean;
  activePage: PageId;
  accentColor: string;
  installPrompt: BeforeInstallPromptEvent | null;
  onPromptInstall: () => Promise<
    PwaInstallChoice['outcome'] | null
  >;
}

export function LayoutTopBar({
  userProfile,
  onPageChange,
  onLogout,
  isAdmin,
  activePage,
  accentColor,
  installPrompt,
  onPromptInstall,
}: LayoutTopBarProps) {
  return (
    <div
      className="flex-shrink-0 bg-white dark:bg-gray-800"
      style={{
        borderBottom: `2px solid ${accentColor}22`,
        paddingTop: 'env(safe-area-inset-top, 0px)',
      }}
    >
      {/* Accent line at top */}
      <div
        className="h-0.5 w-full"
        style={{
          background: `linear-gradient(to left, ${accentColor}, ${accentColor}44)`,
        }}
      />
      <div
        className="flex items-center justify-between px-4 shadow-sm"
        style={{ height: '52px' }}
      >
        {/* Left side */}
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {/* Mobile hamburger placeholder — keep width consistent */}
        </div>
        {/* Right side: actions */}
        <div className="flex items-center gap-1.5 flex-1 justify-end">
          {installPrompt && (
            <button
              onClick={() => void onPromptInstall()}
              className="p-2 rounded-xl text-gray-500 dark:text-gray-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
              title="نصب اپلیکیشن"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
          <NotificationBell onNavigate={onPageChange} />
          {isAdmin && (
            <PortalButton
              activePage={activePage}
              onPageChange={onPageChange}
            />
          )}
          <div className="w-px h-6 bg-gray-200 dark:bg-gray-700 mx-1" />
          <ProfileDropdown
            userProfile={userProfile}
            onPageChange={onPageChange}
            onLogout={onLogout}
            installPrompt={installPrompt}
            onPromptInstall={onPromptInstall}
          />
        </div>
      </div>
    </div>
  );
}
