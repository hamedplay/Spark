import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { UserPreferences } from '../../context/UserPreferencesContext';

export type PageId =
  | 'meetings' | 'create-meeting' | 'tasks' | 'reports' | 'notes'
  | 'profile' | 'contacts' | 'contacts_email' | 'calendar' | 'tutorial'
  | 'admin' | 'chat' | 'video-conference' | 'portal-config' | 'spark'
  | 'groups' | 'channels'
  | 'minutes' | 'minutes-new' | 'minutes-edit' | 'minutes-detail'
  | 'minutes-approvals' | 'minutes-my-decisions' | 'minutes-followup'
  | 'minutes-report' | 'minutes-reports' | 'minutes-dashboard';

const MINUTES_PAGES: PageId[] = [
  'minutes', 'minutes-new', 'minutes-edit', 'minutes-detail',
  'minutes-approvals', 'minutes-my-decisions', 'minutes-followup',
  'minutes-report', 'minutes-reports', 'minutes-dashboard',
];

function isValidMinutesPage(page: string): page is PageId {
  return (MINUTES_PAGES as string[]).includes(page);
}

interface NavigationState {
  activePage: PageId;
  setActivePage: (page: PageId) => void;
}

/**
 * Preserves the original navigation behavior:
 * - activePage defaults to 'calendar'
 * - On auth + prefs resolved, applies landing page (mpage URL param takes precedence)
 * - popstate restores minutes page from mpage URL param
 * - /admin path handled separately by AdminRouteGuard
 */
export function useNavigation(
  isAuthenticated: boolean,
  prefsLoading: boolean,
  defaultLandingPage: UserPreferences['default_landing_page'],
): NavigationState {
  const [activePage, setActivePage] = useState<PageId>('calendar');
  const [landingApplied, setLandingApplied] = useState(false);

  // Apply default landing page once both auth and prefs are resolved
  useEffect(() => {
    if (!isAuthenticated || prefsLoading || landingApplied) return;
    setLandingApplied(true);
    const urlPage = new URLSearchParams(window.location.search).get('mpage');
    if (urlPage && isValidMinutesPage(urlPage)) {
      setActivePage(urlPage);
      return;
    }
    setActivePage(defaultLandingPage as PageId);
  }, [isAuthenticated, prefsLoading, landingApplied, defaultLandingPage]);

  // Sync activePage with URL on back/forward navigation (popstate)
  useEffect(() => {
    const handler = () => {
      const urlPage = new URLSearchParams(window.location.search).get('mpage');
      if (urlPage && isValidMinutesPage(urlPage)) {
        setActivePage(urlPage);
      }
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  return { activePage, setActivePage };
}

/**
 * Checks /admin path and redirects. Preserves original behavior:
 * - If authenticated + admin → activePage = 'admin'
 * - If authenticated + non-admin → pushState to '/' + toast error
 */
export function useAdminPathGuard(
  isAuthenticated: boolean,
  isAdmin: boolean,
  setActivePage: (page: PageId) => void,
) {
  useEffect(() => {
    const checkAdminPath = () => {
      const path = window.location.pathname;
      if (path.includes('/admin')) {
        if (isAuthenticated && isAdmin) {
          setActivePage('admin');
        } else if (isAuthenticated && !isAdmin) {
          window.history.pushState({}, '', '/');
          toast.error('شما دسترسی به پنل ادمین ندارید');
        }
      }
    };

    checkAdminPath();
    window.addEventListener('popstate', checkAdminPath);
    return () => {
      window.removeEventListener('popstate', checkAdminPath);
    };
  }, [isAuthenticated, isAdmin, setActivePage]);
}


