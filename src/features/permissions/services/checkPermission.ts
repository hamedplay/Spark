/**
 * Maps page IDs to permission keys. Pages not listed are always accessible.
 */
export const PAGE_PERMISSION_KEY: Record<string, string> = {
  'management-dashboard': 'management_dashboard',
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
  'minutes-hub': 'minutes_view',
  'minutes-dashboard': 'minutes_view',
  minutes: 'minutes_view',
  'minutes-detail': 'minutes_view',
  'minutes-approvals': 'minutes_approve',
  'minutes-my-decisions': 'minutes_view',
  'minutes-reports': 'minutes_reports',
  'minutes-new': 'minutes_create',
  'minutes-edit': 'minutes_edit',
  'minutes-config': 'minutes_config',
  'minutes-followup': 'minutes_decisions.track',
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
