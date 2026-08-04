import { supabase } from '../../lib/supabase';
import type {
  SecurityConsoleState,
  SecuritySettingsPatch,
  SecurityErrorCode,
} from '../types/securitySettings';
import { mapSecurityError } from '../types/securitySettings';

export async function loadSecurityConsoleState(): Promise<SecurityConsoleState> {
  const { data, error } = await supabase.rpc('get_auth_security_console_state');

  if (error) {
    return {
      ok: false,
      settings: {} as never,
      impact: {} as never,
      recent_history: [],
      error: 'UNKNOWN_SECURITY_ERROR',
    };
  }

  if (!data || data.ok === false) {
    return {
      ok: false,
      settings: {} as never,
      impact: {} as never,
      recent_history: [],
      error: data?.error ?? 'UNKNOWN_SECURITY_ERROR',
    };
  }

  return data as SecurityConsoleState;
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
  const { data, error } = await supabase.rpc('set_auth_security_settings_patch', {
    p_expected_version: params.expectedVersion,
    p_patch: params.patch,
    p_change_reason: params.changeReason,
  });

  if (error) {
    return { ok: false, error: 'UNKNOWN_SECURITY_ERROR' };
  }

  if (!data || data.ok === false) {
    return {
      ok: false,
      error: mapSecurityError(data?.error),
    };
  }

  return {
    ok: true,
    currentVersion: data.settings_version ?? undefined,
  };
}
