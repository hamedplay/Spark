// URL-based navigation helpers for Minutes Detail/Edit pages.
// `mpage` is intentionally NOT written to the URL anymore — all
// sub-page navigation is handled via React state (setActivePage).
// The `minute`, `mtab`, and `meeting` params are still used for
// deep-linking detail/edit/new pages.

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
  | 'minutes-dashboard'
  | 'minutes-hub';

const VALID_MINUTES_PAGES: MinutesPage[] = [
  'minutes', 'minutes-new', 'minutes-edit', 'minutes-detail',
  'minutes-approvals', 'minutes-my-decisions', 'minutes-followup',
  'minutes-report', 'minutes-reports', 'minutes-dashboard',
  'minutes-hub',
];

export function isValidMinutesPage(page: string | null): page is MinutesPage {
  return !!page && (VALID_MINUTES_PAGES as string[]).includes(page);
}

export function getMinutesPageFromUrl(): string | null {
  return null;
}

export function setMinutesPageInUrl(_page: string): void {
  // No-op: mpage is no longer persisted in the URL.
  // Sub-page navigation is handled via React state (setActivePage).
}

export function clearMinutesPageFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(PAGE_PARAM);
  window.history.replaceState({}, '', url.toString());
}

/** Strip only the `mpage` param from the URL if present, preserving
 * pathname, hash, and all other query params. Called once on mount. */
export function stripMpageFromUrl(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.has(PAGE_PARAM)) {
    url.searchParams.delete(PAGE_PARAM);
    window.history.replaceState({}, '', url.toString());
  }
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

// ── Source meeting id (entry from meeting detail → minutes-new) ──────────────
const MEETING_PARAM = 'meeting';

export function getMeetingIdFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const id = params.get(MEETING_PARAM);
  return id && id.trim() ? id.trim() : null;
}

export function setMeetingIdInUrl(id: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(MEETING_PARAM, id);
  window.history.replaceState({}, '', url.toString());
}

export function clearMeetingIdFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(MEETING_PARAM);
  window.history.replaceState({}, '', url.toString());
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
  | 'history'
  | 'final_version';

const VALID_TABS: MinutesDetailTab[] = [
  'summary', 'participants', 'agenda', 'decisions', 'attachments', 'approvals', 'history', 'final_version',
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

// ── Atomic context cleanup ───────────────────────────────────────────────────
// Removes ALL minutes-related URL params (mpage, minute, mtab, meeting) and the
// sessionStorage selectedMinuteId in a single replaceState call.
export function clearMinutesContextFromUrl(): void {
  const url = new URL(window.location.href);
  url.searchParams.delete(PAGE_PARAM);
  url.searchParams.delete(MINUTE_PARAM);
  url.searchParams.delete(TAB_PARAM);
  url.searchParams.delete(MEETING_PARAM);
  window.history.replaceState({}, '', url.toString());
  sessionStorage.removeItem(STORAGE_KEY);
}
