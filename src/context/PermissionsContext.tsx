import React, { createContext, useContext } from 'react';

export const ALL_PERMISSION_KEYS = [
  'meetings', 'meetings_create', 'meetings_edit', 'meetings_delete', 'meetings_export', 'meetings_delegate',
  'calendar', 'calendar_create_event', 'calendar_create_occasion', 'calendar_subscribe',
  'chat', 'chat_send_urgent', 'chat_send_confidential', 'chat_forward_message', 'chat_delete_message',
  'channels', 'channels_create_channel', 'channels_create_group', 'channels_manage_members', 'channels_delete',
  'video_conference', 'video_create_room',
  'tasks', 'tasks_create', 'tasks_edit', 'tasks_delete', 'tasks_assign',
  'notes', 'notes_create', 'notes_edit', 'notes_delete',
  'contacts', 'contacts_create', 'contacts_edit', 'contacts_delete', 'contacts_email', 'contacts_share',
  'reports', 'reports_export', 'reports_view_all',
  'spark', 'spark_meeting_req',
  'admin_panel', 'org_manage_structure', 'org_manage_permissions', 'user_management',
  'system_config', 'notification_config', 'sms_config', 'backup_access', 'audit_log',
] as const;

export type PermissionKey = typeof ALL_PERMISSION_KEYS[number];

interface PermissionsContextValue {
  isAdmin: boolean;
  userPermissions: Record<string, boolean> | null | undefined;
  hasPermission: (key: string) => boolean;
}

const PermissionsContext = createContext<PermissionsContextValue>({
  isAdmin: false,
  userPermissions: undefined,
  hasPermission: () => false,
});

export function PermissionsProvider({
  isAdmin,
  userPermissions,
  children,
}: {
  isAdmin: boolean;
  userPermissions: Record<string, boolean> | null | undefined;
  children: React.ReactNode;
}) {
  const hasPermission = (key: string): boolean => {
    if (isAdmin) return true;
    if (userPermissions === null) return true;
    if (userPermissions === undefined) return false;
    return !!userPermissions[key];
  };

  return (
    <PermissionsContext.Provider value={{ isAdmin, userPermissions, hasPermission }}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function usePermissions() {
  return useContext(PermissionsContext);
}
