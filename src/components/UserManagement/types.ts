export interface AdminProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  username?: string | null;
  phone?: string | null;
  organization?: string | null;
  position: string | null;
  department: string | null;
  employee_id?: string | null;
  hire_date?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  city?: string | null;
  location?: string | null;
  bio?: string | null;
  national_id?: string | null;
  avatar_url?: string | null;
  is_admin: boolean | null;
  is_security_admin?: boolean | null;
  security_role_version?: number | null;
  is_active: boolean | null;
  is_hidden?: boolean | null;
  account_status?: string | null;
  created_at: string | null;
}

export interface AuditRow {
  id: string;
  created_at: string;
  ip_address: string | null;
  user_agent: string | null;
  action: string;
  module: string | null;
  entity_name: string | null;
  details: string | null;
  severity: string;
}

export type Panel = 'list' | 'edit' | 'add' | 'password' | 'deactivate' | 'access' | 'roles' | 'activity' | 'logins' | 'urls' | 'preview' | 'relations' | 'phonesync';

export interface GroupMembership {
  group_id: string;
  group_name: string | null;
  permissions: Record<string, boolean>;
}

export interface Props {
  currentUserId: string;
}

export interface ImportRowError {
  row: number;
  email: string;
  reason: string;
}

export interface ImportResult {
  total: number;
  created: number;
  failed: number;
  errors: ImportRowError[];
}

export interface Relation {
  id: string;
  user_id: string;
  related_user_id: string;
  relation_type: string;
  note: string | null;
  created_at: string;
}
