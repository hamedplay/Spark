import { supabase } from '../../../lib/supabase';

export type CanonicalMfaMethod = 'totp' | 'sms';

export interface CanonicalMfaState {
  ok: boolean;
  mfa_method: CanonicalMfaMethod | null;
  mfa_policy: 'disabled' | 'optional' | 'required';
  has_verified_totp: boolean;
  has_active_sms_factor: boolean;
  has_confirmed_phone: boolean;
  masked_phone: string | null;
  can_enroll_totp: boolean;
  totp_selectable: boolean;
  sms_enabled_by_admin: boolean;
  sms_provider_ready: boolean;
  sms_selectable: boolean;
  error?: string;
}

export interface BeginMfaMethodSwitchResult {
  ok: boolean;
  intent_id?: string;
  from_method?: CanonicalMfaMethod;
  to_method?: CanonicalMfaMethod;
  already_active?: boolean;
  error?: string;
}

export interface ConfirmMfaMethodSwitchResult {
  ok: boolean;
  intent_id?: string;
  from_method?: CanonicalMfaMethod;
  to_method?: CanonicalMfaMethod;
  current_method_verified_at?: string;
  error?: string;
}

export async function loadCanonicalMfaState(): Promise<CanonicalMfaState> {
  const { data, error } = await supabase.rpc('get_my_canonical_mfa_state' as never) as unknown as {
    data: CanonicalMfaState | null;
    error: { message?: string } | null;
  };

  if (error || !data) {
    throw new Error(error?.message || 'MFA_STATE_UNAVAILABLE');
  }
  if (!data.ok) {
    throw new Error(data.error || 'MFA_STATE_UNAVAILABLE');
  }
  return data;
}

export async function beginMfaMethodSwitch(
  toMethod: CanonicalMfaMethod,
): Promise<BeginMfaMethodSwitchResult> {
  const { data, error } = await supabase.rpc('begin_mfa_method_switch' as never, {
    p_to_method: toMethod,
  } as never) as unknown as {
    data: BeginMfaMethodSwitchResult | null;
    error: { message?: string } | null;
  };

  if (error || !data) {
    throw new Error(error?.message || 'MFA_SWITCH_START_FAILED');
  }
  return data;
}

export async function confirmCurrentMfaMethodSwitch(
  intentId: string,
): Promise<ConfirmMfaMethodSwitchResult> {
  const { data, error } = await supabase.rpc('confirm_mfa_method_switch_current' as never, {
    p_intent_id: intentId,
  } as never) as unknown as {
    data: ConfirmMfaMethodSwitchResult | null;
    error: { message?: string } | null;
  };

  if (error || !data) {
    throw new Error(error?.message || 'MFA_SWITCH_CONFIRM_FAILED');
  }
  return data;
}
