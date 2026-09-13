import React, { createContext, useContext } from 'react';
import { ALL_PERMISSION_ITEMS } from '../features/permissions';

// The feature registry is the single runtime source of truth for permission keys.
// Keep this compatibility export for older consumers without maintaining a second list.
export const ALL_PERMISSION_KEYS = Object.freeze(
  ALL_PERMISSION_ITEMS.map((item) => item.key)
) as readonly string[];

export type PermissionKey = (typeof ALL_PERMISSION_KEYS)[number];

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
