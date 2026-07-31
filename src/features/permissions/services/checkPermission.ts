/**
 * Maps page IDs to permission keys. Pages not listed are always accessible.
 */
export const PAGE_PERMISSION_KEY: Record<string, string> = {
  'minutes-followup': 'minutes_decisions.track',
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
 *
 * For `minutes_decisions.track`, also allows access if the user has any
 * trackable minutes decisions (secretary/chair of a published minute).
 */
export function checkPermission(
  key: string,
  isAdmin: boolean,
  userPermissions: Record<string, boolean> | null | undefined,
  hasAnyTrackableDecisions?: boolean,
): boolean {
  if (isAdmin) return true;
  if (userPermissions === null) return true;
  if (userPermissions === undefined) return false;
  if (key === 'minutes_decisions.track' && hasAnyTrackableDecisions) return true;
  return !!userPermissions[key];
}
