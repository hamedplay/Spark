import { supabase } from '../../../lib/supabase';
import type {
  SecurityConsoleState,
  SecuritySettingsPatch,
  SecurityErrorCode,
} from '../types/securitySettings';
import { mapSecurityError } from '../types/securitySettings';

export async function loadSecurityConsoleState(): Promise<SecurityConsoleState> {
  const { data, error } = await supabase.rpc('get_auth_security_console_state' as never) as unknown as { data: unknown; error: { message?: string } | null };

  if (error) {
    return {
      ok: false,
      settings: {} as never,
      impact: {} as never,
      recent_history: [],
      error: 'UNKNOWN_SECURITY_ERROR',
    };
  }

  if (!data || (data as { ok?: boolean }).ok === false) {
    const errCode = (data as { error?: string })?.error;
    if (errCode === 'UNAUTHORIZED' || errCode === 'SESSION_INVALID' || errCode === 'SECURITY_ADMIN_REQUIRED' || errCode === 'SETTINGS_NOT_FOUND') {
      return {
        ok: false,
        settings: {} as never,
        impact: {} as never,
        recent_history: [],
        error: errCode,
      };
    }
    return {
      ok: false,
      settings: {} as never,
      impact: {} as never,
      recent_history: [],
      error: 'UNKNOWN_SECURITY_ERROR',
    };
  }

  return data as unknown as SecurityConsoleState;
}

export interface SaveSecuritySettingsParams {
  expectedVersion: number;
  patch: SecuritySettingsPatch;
  changeReason: string;
}

export interface SaveResult {
  ok: boolean;
  error?: SecurityErrorCode;
  currentVersion?: number;
}

export async function saveSecuritySettingsPatch(
  params: SaveSecuritySettingsParams
): Promise<SaveResult> {
  const rpcResult = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  }).rpc('set_auth_security_settings_patch', {
    p_expected_version: params.expectedVersion,
    p_patch: params.patch,
    p_change_reason: params.changeReason,
  });
  const { data, error } = rpcResult;

  if (error) {
    return { ok: false, error: 'UNKNOWN_SECURITY_ERROR' };
  }

  if (!data || (data as { ok?: boolean }).ok === false) {
    const errCode = (data as { error?: string })?.error;
    if (errCode === 'SESSION_INVALID') {
      return { ok: false, error: 'SESSION_INVALID' };
    }
    return {
      ok: false,
      error: mapSecurityError(errCode),
    };
  }

  return {
    ok: true,
    currentVersion: (data as { new_version?: number }).new_version ?? undefined,
  };
}
