export type SecurityAdminErrorCode =
  | 'UNAUTHORIZED'
  | 'SESSION_REQUIRED'
  | 'SESSION_INVALID'
  | 'SESSION_EXPIRED'
  | 'SECURITY_ADMIN_REQUIRED'
  | 'FORBIDDEN'
  | 'TARGET_REQUIRED'
  | 'TARGET_NOT_FOUND'
  | 'TARGET_NOT_ELIGIBLE'
  | 'TARGET_TOTP_REQUIRED'
  | 'NEW_VALUE_REQUIRED'
  | 'EXPECTED_VERSION_REQUIRED'
  | 'CANNOT_CHANGE_OWN_SECURITY_ADMIN'
  | 'CANNOT_REMOVE_LAST_SECURITY_ADMIN'
  | 'VERSION_CONFLICT'
  | 'NO_EFFECTIVE_CHANGE'
  | 'STEPUP_REQUIRED'
  | 'CHANGE_REASON_REQUIRED'
  | 'CHANGE_REASON_TOO_SHORT'
  | 'CHANGE_REASON_TOO_LONG'
  | 'INVALID_LIMIT'
  | 'INVALID_OFFSET'
  | 'INVALID_CURSOR'
  | 'INVALID_CATEGORY'
  | 'INVALID_SEVERITY'
  | 'INVALID_RESULT'
  | 'INVALID_DATE_RANGE'
  | 'SEARCH_TOO_LONG'
  | 'UNKNOWN_SECURITY_ADMIN_ERROR';

export type BlockedReason =
  | 'SELF_CHANGE_FORBIDDEN'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'TOTP_REQUIRED'
  | 'ALREADY_SECURITY_ADMIN'
  | 'NOT_SECURITY_ADMIN'
  | 'LAST_ACTIVE_SECURITY_ADMIN'
  | 'ELIGIBLE';

export interface AdminUserEligibility {
  can_grant: boolean;
  can_revoke: boolean;
  blocked_reason: BlockedReason;
}

export interface AdminUserRow {
  user_id: string;
  full_name: string | null;
  username: string | null;
  email: string | null;
  avatar_url: string | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  account_status: string | null;
  is_security_admin: boolean | null;
  security_role_version: number | null;
  has_verified_totp: boolean;
  is_current_actor: boolean;
  eligibility: AdminUserEligibility;
}

export interface AdminManagementSummary {
  total_users: number;
  active_security_admins: number;
  security_admins_without_verified_totp: number;
  eligible_promotion_candidates: number;
  current_actor_has_verified_totp: boolean;
}

export interface RoleHistoryEntry {
  id: string;
  target_user_id: string;
  target_display_name: string;
  actor_user_id: string | null;
  actor_display_name: string | null;
  old_value: boolean | null;
  new_value: boolean | null;
  old_version: number | null;
  new_version: number | null;
  change_reason: string | null;
  changed_at: string;
}

export interface AdminManagementState {
  ok: true;
  users: AdminUserRow[];
  summary: AdminManagementSummary;
  history: RoleHistoryEntry[];
}

export interface AdminManagementError {
  ok: false;
  error: SecurityAdminErrorCode;
  current_version?: number;
}

export interface AuditEventActor {
  user_id: string;
  display_name: string;
}

export interface AuditEvent {
  id: string;
  created_at: string;
  event_type: string;
  event_category: string;
  severity: string;
  result: string | null;
  error_code: string | null;
  actor: AuditEventActor | null;
  target: AuditEventActor | null;
  request_id: string | null;
  session_id: string | null;
  metadata: Record<string, unknown>;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
}

export interface AuditPageCursor {
  before_created_at: string;
  before_id: string;
}

export interface AuditPageResult {
  ok: true;
  events: AuditEvent[];
  has_more: boolean;
  next_cursor: AuditPageCursor | null;
}

export interface ChangeSecurityAdminRoleParams {
  targetUserId: string;
  newValue: boolean;
  expectedVersion: number;
  changeReason: string;
}

export interface ChangeSecurityAdminRoleResult {
  ok: boolean;
  newVersion?: number;
  error?: SecurityAdminErrorCode;
  currentVersion?: number;
}

export interface VersionConflictSnapshot {
  targetUserId: string;
  targetDisplayName: string;
  requestedValue: boolean;
  expectedVersion: number;
  changeReason: string;
}
