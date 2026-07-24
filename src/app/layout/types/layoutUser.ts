export type LayoutUserStatus =
  | 'online'
  | 'busy'
  | 'away'
  | 'dnd'
  | 'offline';

export interface LayoutUserProfile {
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  position: string | null;
}
