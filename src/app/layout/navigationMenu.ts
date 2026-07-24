import type {
  LayoutUserPermissions,
  PageId,
} from './types';

export interface LayoutNavigationItem {
  id: PageId;
  title: string;
  permissionKey?: string;
  requiresSparkVisible?: boolean;
}

export const PRIMARY_NAVIGATION_ITEMS: LayoutNavigationItem[] = [
  { id: 'meetings',         title: 'درخواست جلسه',   permissionKey: 'meetings' },
  { id: 'calendar',         title: 'تقویم',           permissionKey: 'calendar' },
  { id: 'chat',             title: 'چت سازمانی',      permissionKey: 'chat' },
  { id: 'channels',         title: 'کانال‌ها',         permissionKey: 'channels' },
  { id: 'video-conference', title: 'ویدیو کنفرانس',   permissionKey: 'video_conference' },
  { id: 'tasks',            title: 'اقدامات',         permissionKey: 'tasks' },
  { id: 'notes',            title: 'یادداشت‌ها',      permissionKey: 'notes' },
  { id: 'contacts',         title: 'مخاطبین',         permissionKey: 'contacts' },
  { id: 'reports',          title: 'گزارشات',         permissionKey: 'reports' },
  { id: 'spark',            title: 'اسپارک (دستیار)', permissionKey: 'spark', requiresSparkVisible: true },
];

export const MINUTES_NAVIGATION_ITEMS: LayoutNavigationItem[] = [
  { id: 'minutes-dashboard',    title: 'داشبورد'       },
  { id: 'minutes',              title: 'صورت‌جلسات'     },
  { id: 'minutes-approvals',    title: 'کارتابل تأیید'  },
  { id: 'minutes-my-decisions', title: 'مصوبات من'      },
  { id: 'minutes-followup',     title: 'پیگیری مصوبات'  },
  { id: 'minutes-reports',      title: 'گزارش‌ها'       },
];

export const MINUTES_PAGES: Set<PageId> = new Set([
  'minutes', 'minutes-new', 'minutes-edit', 'minutes-detail',
  'minutes-approvals', 'minutes-my-decisions', 'minutes-followup',
  'minutes-report', 'minutes-reports', 'minutes-dashboard',
]);

export const MINUTES_INTERNAL_PAGE_MAP: Record<string, PageId> = {
  'minutes-new':    'minutes',
  'minutes-edit':   'minutes',
  'minutes-detail': 'minutes',
  'minutes-report': 'minutes-reports',
};

export interface NavigationVisibilityContext {
  isAdmin: boolean;
  sparkVisible: boolean;
  userPermissions: LayoutUserPermissions;
}

export function getVisiblePrimaryNavigationItems(
  context: NavigationVisibilityContext
): LayoutNavigationItem[] {
  return PRIMARY_NAVIGATION_ITEMS.filter(item => {
    if (item.requiresSparkVisible && !context.sparkVisible) return false;
    if (context.isAdmin) return true;
    if (!item.permissionKey) return true;
    if (context.userPermissions === null) return true;
    if (context.userPermissions === undefined) return false;
    return !!context.userPermissions[item.permissionKey];
  });
}

export function getVisibleMinutesNavigationItems(
  context: NavigationVisibilityContext
): LayoutNavigationItem[] {
  return MINUTES_NAVIGATION_ITEMS.filter(item => {
    if (context.isAdmin) return true;
    if (!item.permissionKey) return true;
    if (context.userPermissions === null) return true;
    if (context.userPermissions === undefined) return false;
    return !!context.userPermissions[item.permissionKey];
  });
}

export function isMinutesPage(page: PageId): boolean {
  return MINUTES_PAGES.has(page);
}

export function resolveActiveMinutesPage(page: PageId): PageId {
  return MINUTES_INTERNAL_PAGE_MAP[page] ?? page;
}
