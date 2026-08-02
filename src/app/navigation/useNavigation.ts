import { useState, useEffect, useCallback } from 'react';
import toast from 'react-hot-toast';
import { UserPreferences } from '../../features/user-preferences';
import {
  setMinutesPageInUrl,
  setMinuteIdInUrl,
  setMinutesTabInUrl,
  getMinuteIdFromUrl,
  getMinutesTabFromUrl,
  getMeetingIdFromUrl,
  setMeetingIdInUrl,
  clearMinutesContextFromUrl,
  type MinutesPage,
  type MinutesDetailTab,
} from '../../lib/minutesNavigation';

export type PageId =
  | 'meetings' | 'create-meeting' | 'tasks' | 'reports' | 'notes'
  | 'profile' | 'contacts' | 'contacts_email' | 'calendar' | 'tutorial'
  | 'admin' | 'chat' | 'video-conference' | 'portal-config' | 'spark'
  | 'groups' | 'channels'
  | 'minutes' | 'minutes-new' | 'minutes-edit' | 'minutes-detail'
  | 'minutes-approvals' | 'minutes-my-decisions' | 'minutes-followup'
  | 'minutes-report' | 'minutes-reports' | 'minutes-dashboard' | 'minutes-hub';

const MINUTES_PAGES: PageId[] = [
  'minutes', 'minutes-new', 'minutes-edit', 'minutes-detail',
  'minutes-approvals', 'minutes-my-decisions', 'minutes-followup',
  'minutes-report', 'minutes-reports', 'minutes-dashboard',
  'minutes-hub',
];

// Minutes pages that are "general" — entering them should clear minute/meeting/mtab/selectedMinuteId.
const MINUTES_GENERAL_PAGES: PageId[] = [
  'minutes', 'minutes-approvals', 'minutes-my-decisions', 'minutes-followup',
  'minutes-report', 'minutes-reports', 'minutes-dashboard', 'minutes-hub',
];

function isValidMinutesPage(page: string): page is PageId {
  return (MINUTES_PAGES as string[]).includes(page);
}

/**
 * Apply URL cleanup rules for a navigation to the given target page.
 * This runs BEFORE setActivePage is called, in a single replaceState.
 *
 * Rules:
 * - Exit to any non-minutes page: clear all minutes context (mpage, minute, mtab, meeting, selectedMinuteId).
 * - Enter minutes-detail: set mpage=minutes-detail, preserve minute and mtab if valid.
 * - Enter minutes-edit: preserve minute, clear mtab and meeting.
 * - Enter minutes-new: preserve meeting if present, clear minute, mtab, selectedMinuteId.
 * - Enter general minutes pages (list, dashboard, hub, approvals, reports, etc.):
 *   set mpage to target, clear minute, meeting, mtab, selectedMinuteId.
 */
function applyNavigationUrlCleanup(target: PageId): void {
  const isMinutesPage = (MINUTES_PAGES as string[]).includes(target);
  const isGeneralMinutesPage = (MINUTES_GENERAL_PAGES as string[]).includes(target);

  if (target === 'minutes-detail') {
    // Preserve minute and mtab, set mpage
    const minuteId = getMinuteIdFromUrl();
    const tab = getMinutesTabFromUrl();
    setMinutesPageInUrl('minutes-detail');
    if (minuteId) setMinuteIdInUrl(minuteId);
    if (tab) setMinutesTabInUrl(tab);
    return;
  }

  if (target === 'minutes-edit') {
    // Preserve minute, clear mtab and meeting
    const minuteId = getMinuteIdFromUrl();
    setMinutesPageInUrl('minutes-edit');
    if (minuteId) setMinuteIdInUrl(minuteId);
    // Clear mtab and meeting
    const url = new URL(window.location.href);
    url.searchParams.delete('mtab');
    url.searchParams.delete('meeting');
    window.history.replaceState({}, '', url.toString());
    return;
  }

  if (target === 'minutes-new') {
    // Preserve meeting if present, clear minute, mtab, selectedMinuteId
    const meetingId = getMeetingIdFromUrl();
    setMinutesPageInUrl('minutes-new');
    if (meetingId) setMeetingIdInUrl(meetingId);
    // Clear minute, mtab, selectedMinuteId
    const url = new URL(window.location.href);
    url.searchParams.delete('minute');
    url.searchParams.delete('mtab');
    window.history.replaceState({}, '', url.toString());
    sessionStorage.removeItem('selectedMinuteId');
    return;
  }

  if (isGeneralMinutesPage) {
    // Set mpage to target, clear minute, meeting, mtab, selectedMinuteId
    setMinutesPageInUrl(target as MinutesPage);
    const url = new URL(window.location.href);
    url.searchParams.delete('minute');
    url.searchParams.delete('meeting');
    url.searchParams.delete('mtab');
    window.history.replaceState({}, '', url.toString());
    sessionStorage.removeItem('selectedMinuteId');
    return;
  }

  if (!isMinutesPage) {
    // Exit to a non-minutes page: clear all minutes context
    clearMinutesContextFromUrl();
    return;
  }

  // Fallback: any other minutes page not covered above — clear context
  setMinutesPageInUrl(target as MinutesPage);
  const url = new URL(window.location.href);
  url.searchParams.delete('minute');
  url.searchParams.delete('meeting');
  url.searchParams.delete('mtab');
  window.history.replaceState({}, '', url.toString());
  sessionStorage.removeItem('selectedMinuteId');
}

interface NavigationState {
  activePage: PageId;
  navigate: (page: PageId) => void;
}

/**
 * Preserves the original navigation behavior:
 * - activePage defaults to 'calendar'
 * - On auth + prefs resolved, applies landing page (mpage URL param takes precedence)
 * - popstate restores minutes page from mpage URL param
 * - /admin path handled separately by AdminRouteGuard
 *
 * Returns a stable `navigate` function instead of the raw setActivePage setter.
 * The navigate function applies URL cleanup rules before changing the page.
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

  // Stable navigate function: applies URL cleanup rules before setActivePage
  const navigate = useCallback((page: PageId) => {
    applyNavigationUrlCleanup(page);
    setActivePage(page);
  }, []);

  return { activePage, navigate };
}

/**
 * Checks /admin path and redirects. Preserves original behavior:
 * - If authenticated + admin → activePage = 'admin'
 * - If authenticated + non-admin → pushState to '/' + toast error
 */
export function useAdminPathGuard(
  isAuthenticated: boolean,
  isAdmin: boolean,
  navigate: (page: PageId) => void,
) {
  useEffect(() => {
    const checkAdminPath = () => {
      const path = window.location.pathname;
      if (path.includes('/admin')) {
        if (isAuthenticated && isAdmin) {
          navigate('admin');
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
  }, [isAuthenticated, isAdmin, navigate]);
}
