export const CONFIG_SECTION_PERMISSION: Record<string, string> = {
  general: 'config_platform.general',
  appearance: 'config_platform.appearance',
  regional: 'config_platform.regional',
  ui_settings: 'config_platform.ui_settings',
  users_list: 'config_users.users_list',
  users_online: 'config_users.users_online',
  user_groups: 'config_users.user_groups',
  group_events: 'config_users.group_events',
  org_structure: 'config_users.org_structure',
  security: 'config_access.security',
  server: 'config_access.server',
  backup: 'config_backup',
  audit_log: 'config_audit.audit_log',
  notifications: 'config_notifications.notifications',
  sms: 'config_notifications.sms',
  social_notifications: 'config_notifications.social_notifications',
  email: 'config_notifications.email',
  daily_report: 'config_notifications.daily_report',
  video_conference: 'config_modules.video_conference',
  calendar: 'config_modules.calendar',
  minutes_config: 'config_modules.minutes_config',
  monitoring: 'config_modules.monitoring',
  spark_config: 'config_spark.spark_config',
};

export const CONFIG_SECTION_PERMISSION_KEYS = Object.values(CONFIG_SECTION_PERMISSION);

export function canOpenPortalConfig(
  isAdmin: boolean,
  userPermissions: Record<string, boolean> | null | undefined,
): boolean {
  if (isAdmin || userPermissions === null) return true;
  if (!userPermissions) return false;
  return userPermissions.config_view === true;
}

export function canAccessConfigSection(
  sectionKey: string,
  isAdmin: boolean,
  userPermissions: Record<string, boolean> | null | undefined,
): boolean {
  if (isAdmin || userPermissions === null) return true;
  if (!userPermissions) return false;
  const permissionKey = CONFIG_SECTION_PERMISSION[sectionKey];
  return permissionKey ? userPermissions[permissionKey] === true : false;
}

export function getVisibleConfigNavigationItems<
  T extends { sub: Array<{ key: string }> },
>(
  items: T[],
  isAdmin: boolean,
  userPermissions: Record<string, boolean> | null | undefined,
): T[] {
  return items
    .map((group) => ({
      ...group,
      sub: group.sub.filter((item) =>
        canAccessConfigSection(item.key, isAdmin, userPermissions)
      ),
    }))
    .filter((group) => group.sub.length > 0) as T[];
}

export function getFirstVisibleConfigSection<
  T extends { sub: Array<{ key: string }> },
>(items: T[]): string | null {
  return items[0]?.sub[0]?.key ?? null;
}
