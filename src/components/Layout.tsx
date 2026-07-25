import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

import { logAudit } from '../lib/audit';
import { useTheme, ACCENT_COLORS } from '../context/ThemeContext';
import type { LayoutUserPermissions, PageId } from '../app/layout/types';
import { fetchSidebarDefaultCollapsed } from '../app/layout/repositories/layoutUserRepository';
import { useLayoutUserPresence } from '../app/layout/hooks/useLayoutUserPresence';
import { usePwaInstallPrompt } from '../app/layout/hooks/usePwaInstallPrompt';
import { signOutCurrentUser } from '../features/auth';
import { LayoutSidebar } from '../app/layout/components/LayoutSidebar';
import { LayoutTopBar } from '../app/layout/components/LayoutTopBar';

export type { PageId } from '../app/layout/types';

interface LayoutProps {
  children: React.ReactNode;
  activePage: PageId;
  onPageChange: (page: PageId) => void;
  isAdmin?: boolean;
  sparkVisible?: boolean;
  userPermissions?: LayoutUserPermissions;
}

export function Layout({
  children,
  activePage,
  onPageChange,
  isAdmin = false,
  userPermissions,
  sparkVisible = false,
}: LayoutProps) {
  const [isCollapsed, setIsCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    return saved !== null ? saved === 'true' : true;
  });
  const [isMobileMenuOpen, setIsMobileMenuOpen] =
    useState(false);
  const userProfile = useLayoutUserPresence();
  const {
    installPrompt,
    showInstallBanner,
    promptInstall,
    dismissInstallBanner,
  } = usePwaInstallPrompt();
  const { accent } = useTheme();
  const accentColor =
    ACCENT_COLORS.find((c) => c.key === accent)?.hex ??
    '#0d9488';

  // Load sidebar default from system_config if user hasn't set a preference yet
  useEffect(() => {
    if (localStorage.getItem('sidebar_collapsed') !== null)
      return;
    (async () => {
      const defaultCollapsed =
        await fetchSidebarDefaultCollapsed();
      if (defaultCollapsed !== null) {
        setIsCollapsed(defaultCollapsed);
        localStorage.setItem(
          'sidebar_collapsed',
          String(defaultCollapsed)
        );
      }
    })();
  }, []);

  const handleInstall = async () => {
    await promptInstall();
    dismissInstallBanner();
  };

  const handleLogout = async () => {
    logAudit({
      module: 'auth',
      action: 'logout',
      details: 'خروج از سامانه',
      severity: 'info',
    });
    await signOutCurrentUser();
  };

  const handlePageChange = (page: typeof activePage) => {
    onPageChange(page);
    setIsMobileMenuOpen(false);
    if (page === 'admin') {
      window.history.pushState({}, '', '/admin');
    } else if (window.location.pathname.includes('/admin')) {
      window.history.pushState({}, '', '/');
    }
  };

  return (
    <div
      className="flex bg-gray-100 dark:bg-gray-900 rtl transition-colors overflow-hidden"
      style={{ height: '100dvh' }}
      dir="rtl"
    >
      {/* PWA Install Banner */}
      {showInstallBanner && (
        <div
          className="fixed bottom-0 left-0 right-0 z-[9999] p-3 pointer-events-none"
          dir="rtl"
        >
          <div className="max-w-sm mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3 pointer-events-auto">
            <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0">
              <img
                src="/logo_spark.png"
                alt="Spark"
                className="w-full h-full object-contain"
              />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-gray-800 dark:text-white">
                نصب اپلیکیشن
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                برای دسترسی سریع‌تر نصب کنید
              </p>
            </div>
            <button
              onClick={handleInstall}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl transition-colors touch-manipulation flex-shrink-0"
            >
              نصب
            </button>
            <button
              onClick={dismissInstallBanner}
              className="p-1.5 text-gray-400 hover:text-gray-600 touch-manipulation flex-shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <LayoutSidebar
        activePage={activePage}
        onNavigate={handlePageChange}
        isAdmin={isAdmin}
        sparkVisible={!!sparkVisible}
        userPermissions={userPermissions ?? null}
        isCollapsed={isCollapsed}
        onCollapsedChange={setIsCollapsed}
        isMobileMenuOpen={isMobileMenuOpen}
        onMobileMenuOpenChange={setIsMobileMenuOpen}
        accentColor={accentColor}
      />

      {/* Main Content */}
      <div
        className="flex-1 flex flex-col overflow-hidden min-w-0"
        style={{ height: '100dvh' }}
      >
        {/* Always-visible top bar */}
        <LayoutTopBar
          userProfile={userProfile}
          onPageChange={handlePageChange}
          onLogout={handleLogout}
          isAdmin={isAdmin}
          activePage={activePage}
          accentColor={accentColor}
          installPrompt={installPrompt}
          onPromptInstall={promptInstall}
        />

        {/* Page content */}
        {activePage === 'calendar' ||
        activePage === 'chat' ||
        activePage === 'channels' ||
        activePage === 'video-conference' ||
        activePage === 'portal-config' ? (
          <div className="flex-1 overflow-hidden min-h-0">
            {children}
          </div>
        ) : (
          <div
            className="flex-1 overflow-y-auto min-h-0"
            style={{
              paddingBottom: 'env(safe-area-inset-bottom, 0px)',
            }}
          >
            <div className="max-w-[95rem] mx-auto px-3 lg:px-6 w-full py-6">
              <div className="lg:pr-2">{children}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
