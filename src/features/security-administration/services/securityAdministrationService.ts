import { supabase } from '../../../lib/supabase';
import { mapSecurityAdminError } from '../utils/securityAdministrationValidation';
import type {
  AdminManagementState,
  AdminManagementError,
  AuditPageResult,
  ChangeSecurityAdminRoleParams,
  ChangeSecurityAdminRoleResult,
  SecurityAdminErrorCode,
} from '../types/securityAdministration';

export async function loadSecurityAdminManagementState(
  search?: string,
  limit?: number,
  offset?: number
): Promise<AdminManagementState | AdminManagementError> {
  const rpcResult = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  }).rpc('get_security_admin_management_state', {
    p_search: search ?? null,
    p_limit: limit ?? 50,
    p_offset: offset ?? 0,
  });
  const { data, error } = rpcResult;

  if (error) {
    return { ok: false, error: 'UNKNOWN_SECURITY_ADMIN_ERROR' };
  }

  if (!data || (data as { ok?: boolean }).ok === false) {
    const errCode = (data as { error?: string })?.error;
    return { ok: false, error: mapSecurityAdminError(errCode) };
  }

  return data as unknown as AdminManagementState;
}

export async function changeSecurityAdminRole(
  params: ChangeSecurityAdminRoleParams
): Promise<ChangeSecurityAdminRoleResult> {
  const rpcResult = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  }).rpc('set_user_security_admin', {
    p_target_user_id: params.targetUserId,
    p_new_value: params.newValue,
    p_expected_version: params.expectedVersion,
    p_change_reason: params.changeReason,
  });
  const { data, error } = rpcResult;

  if (error) {
    return { ok: false, error: 'UNKNOWN_SECURITY_ADMIN_ERROR' };
  }

  if (!data || (data as { ok?: boolean }).ok === false) {
    const errCode = (data as { error?: string })?.error;
    const currentVersion = (data as { current_version?: number })?.current_version;
    return {
      ok: false,
      error: mapSecurityAdminError(errCode),
      currentVersion,
    };
  }

  return {
    ok: true,
    newVersion: (data as { new_version?: number }).new_version,
  };
}

export interface LoadAuditPageParams {
  category?: string | null;
  severity?: string | null;
  result?: string | null;
  eventType?: string | null;
  actorUserId?: string | null;
  targetUserId?: string | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  beforeCreatedAt?: string | null;
  beforeId?: string | null;
}

export async function loadSecurityAuditPage(
  params: LoadAuditPageParams
): Promise<AuditPageResult | { ok: false; error: SecurityAdminErrorCode }> {
  const rpcResult = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  }).rpc('get_security_audit_page', {
    p_category: params.category ?? null,
    p_severity: params.severity ?? null,
    p_result: params.result ?? null,
    p_event_type: params.eventType ?? null,
    p_actor_user_id: params.actorUserId ?? null,
    p_target_user_id: params.targetUserId ?? null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
    p_limit: params.limit ?? 50,
    p_before_created_at: params.beforeCreatedAt ?? null,
    p_before_id: params.beforeId ?? null,
  });
  const { data, error } = rpcResult;

  if (error) {
    return { ok: false, error: 'UNKNOWN_SECURITY_ADMIN_ERROR' };
  }

  if (!data || (data as { ok?: boolean }).ok === false) {
    const errCode = (data as { error?: string })?.error;
    return { ok: false, error: mapSecurityAdminError(errCode) };
  }

  return data as unknown as AuditPageResult;
}
