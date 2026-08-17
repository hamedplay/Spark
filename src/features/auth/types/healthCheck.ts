export interface HealthCheckResponse {
  ok: boolean;
  timestamp: string;
  database: {
    ok: boolean;
    timestamp: string;
    tables: {
      required: string[];
      missing: string[];
      all_present: boolean;
    };
    rpcs: {
      required: string[];
      missing: string[];
      all_present: boolean;
    };
    rls: { all_enabled: boolean };
    security_definer: { search_path_empty: boolean };
    settings: Record<string, unknown>;
    secrets: Record<string, 'ready' | 'not_ready'>;
    deprecated_routes: Array<{ route: string; status: string; action: string }>;
  };
  identity_integrity: {
    ok: boolean;
    auth_users_without_profile: number;
    profiles_without_auth_user: number;
    lifecycle_status_mismatches: number;
    phone_identity_mismatches: number;
  };
  edge_functions: Array<{ name: string; status: string }>;
  transport: { sms: string; bale: string; email: string };
  settings: Record<string, unknown>;
  deprecated_routes: Array<{ route: string; status: string; action: string }>;
  error?: string;
}

export interface AuditEventEntry {
  id: string;
  created_at: string;
  event_type: string;
  event_category: string;
  severity: string;
  result: string | null;
  error_code: string | null;
  actor_user_id: string | null;
  target_user_id: string | null;
  session_id: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
}

export interface AuditPageResponse {
  ok: boolean;
  events: AuditEventEntry[];
  total: number;
  error?: string;
}
