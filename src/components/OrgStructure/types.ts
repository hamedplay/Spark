export interface OrgUnit {
  id: string;
  name: string;
  code: string | null;
  parent_id: string | null;
  manager_user_id: string | null;
  sort_order: number;
  created_at: string;
}

export interface OrgPosition {
  id: string;
  unit_id: string | null;
  title: string;
  level: number;
  parent_position_id: string | null;
  sort_order: number;
  color: string;
  icon: string;
  created_at: string;
}

export interface PositionMember {
  id: string;
  position_id: string;
  user_id: string;
  is_primary: boolean;
  assigned_at: string;
  profile?: { full_name: string | null; email: string | null; avatar_url: string | null; position: string | null; department: string | null };
}

export interface Profile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  position: string | null;
  department: string | null;
  primary_position_id: string | null;
  primary_unit_id: string | null;
}

export interface LevelDef {
  id?: string;
  level: number;
  label: string;
  color: string;
  icon: string;
  sort_order: number;
}

export interface HrSsoConfig {
  id: string;
  config_type: 'hr' | 'sso';
  provider_name: string;
  base_url: string;
  api_key: string;
  client_id: string;
  client_secret: string;
  sync_enabled: boolean;
  sync_interval_minutes: number;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_message: string | null;
  field_mappings: Record<string, string>;
  is_active: boolean;
}

export interface OrgOrganization {
  id: string;
  name: string;
  short_name: string;
  description: string;
  logo_url: string;
  website: string;
}

export interface LevelPermState { [permKey: string]: boolean }
