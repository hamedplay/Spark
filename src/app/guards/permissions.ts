/**
 * Maps page IDs to permission keys. Pages not listed are always accessible.
 * Extracted verbatim from App.tsx.
 */
export const PAGE_PERMISSION_KEY: Record<string, string> = {
  meetings: 'meetings',
  'create-meeting': 'meetings_create',
  calendar: 'calendar',
  chat: 'chat',
  channels: 'channels',
  'video-conference': 'video_conference',
  tasks: 'tasks',
  notes: 'notes',
  contacts: 'contacts',
  contacts_email: 'contacts',
  reports: 'reports',
};

/**
 * Returns true if the current user may access a given page/feature key.
 * Preserves the original precedence:
 *   admin → true
 *   null (full access) → true
 *   undefined (loading) → false
 *   otherwise → check record
 */
export function checkPermission(
  key: string,
  isAdmin: boolean,
  userPermissions: Record<string, boolean> | null | undefined,
): boolean {
  if (isAdmin) return true;
  if (userPermissions === null) return true;
  if (userPermissions === undefined) return false;
  return !!userPermissions[key];
}
