export interface AuthSessionState {
  isAuthenticated: boolean;
  loading: boolean;
  isAdmin: boolean;
  currentUserId: string | null;
  userPermissions: Record<string, boolean> | null | undefined;
}
