export interface UserGroup {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  is_system: boolean;
  is_public: boolean;
  permissions: Record<string, boolean>;
  member_count?: number;
}

export interface Member {
  id: string;
  user_id: string;
  group_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  joined_at: string;
}

export interface AuditRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  ip_address: string | null;
  module: string | null;
  action: string;
  details: string | null;
  severity: string;
}

export interface AllProfile {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export type Panel = 'list' | 'add' | 'edit' | 'delete' | 'members' | 'access' | 'events';

export interface Props { currentUserId: string; }

export const inp = 'w-full pr-10 pl-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-sm';
