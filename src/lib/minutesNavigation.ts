// Stable URL-based navigation for Minutes Detail/Edit pages.
// Uses query params `mpage` and `minute` so direct refresh and
// back/forward work without relying solely on sessionStorage.

const PAGE_PARAM = 'mpage';
const MINUTE_PARAM = 'minute';
const STORAGE_KEY = 'selectedMinuteId';

export type MinutesPage =
  | 'minutes'
  | 'minutes-new'
  | 'minutes-edit'
  | 'minutes-detail'
  | 'minutes-approvals'
  | 'minutes-my-decisions'
  | 'minutes-followup'
  | 'minutes-report'
  | 'minutes-reports'
  | 'minutes-dashboard';

const VALID_MINUTES_PAGES: MinutesPage[] = [
  'minutes', 'minutes-new', 'minutes-edit', 'minutes-detail',
  'minutes-approvals', 'minutes-my-decisions', 'minutes-followup',
  'minutes-report', 'minutes-reports', 'minutes-dashboard',
];

export function isValidMinutesPage(page: string | null): page is MinutesPage {
  return !!page && (VALID_MINUTES_PAGES as string[]).includes(page);
}

export function getMinutesPageFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get(PAGE_PARAM);
}

export function setMinutesPageInUrl(page: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(PAGE_PARAM, page);
  window.history.replaceState({}, '', url.toString());
}

export function clearMinutesPageFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(PAGE_PARAM);
  window.history.replaceState({}, '', url.toString());
}

export function getMinuteIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get(MINUTE_PARAM);
  if (id && id.trim()) return id.trim();
  // migration fallback for older links/state
  const ss = sessionStorage.getItem(STORAGE_KEY);
  return ss && ss.trim() ? ss : null;
}

export function setMinuteIdInUrl(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(MINUTE_PARAM, id);
  window.history.replaceState({}, '', url.toString());
  sessionStorage.setItem(STORAGE_KEY, id);
}

export function clearMinuteIdFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(MINUTE_PARAM);
  window.history.replaceState({}, '', url.toString());
  sessionStorage.removeItem(STORAGE_KEY);
}

// ── Detail tab in URL (summary/approvals/decisions/attachments/history) ──────
const TAB_PARAM = 'mtab';

export type MinutesDetailTab =
  | 'summary'
  | 'participants'
  | 'agenda'
  | 'decisions'
  | 'attachments'
  | 'approvals'
  | 'history';

const VALID_TABS: MinutesDetailTab[] = [
  'summary', 'participants', 'agenda', 'decisions', 'attachments', 'approvals', 'history',
];

export function isValidMinutesTab(tab: string | null): tab is MinutesDetailTab {
  return !!tab && (VALID_TABS as string[]).includes(tab);
}

export function getMinutesTabFromUrl(): MinutesDetailTab | null {
  const params = new URLSearchParams(window.location.search);
  const t = params.get(TAB_PARAM);
  return isValidMinutesTab(t) ? t : null;
}

export function setMinutesTabInUrl(tab: MinutesDetailTab): void {
  const url = new URL(window.location.href);
  url.searchParams.set(TAB_PARAM, tab);
  window.history.replaceState({}, '', url.toString());
}

export function clearMinutesTabFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(TAB_PARAM);
  window.history.replaceState({}, '', url.toString());
}
