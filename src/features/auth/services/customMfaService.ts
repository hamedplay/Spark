import { supabase } from '../../../lib/supabase';
import type { CustomMfaChallengeResponse, CustomMfaFactor, CustomMfaGrantResponse, CustomMfaState } from '../types/customMfa';

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('custom-mfa', { body });
  if (error || !data) throw new Error('MFA_OPERATION_FAILED');
  return data as T;
}

export function createCustomMfaChallenge(factorType: Exclude<CustomMfaFactor, 'totp' | 'recovery'>): Promise<CustomMfaChallengeResponse> {
  return invoke<CustomMfaChallengeResponse>({ mode: 'create', factor_type: factorType });
}

export function verifyCustomMfaChallenge(challengeId: string, code: string): Promise<CustomMfaGrantResponse> {
  return invoke<CustomMfaGrantResponse>({ mode: 'verify', challenge_id: challengeId, code });
}

export function verifyCustomMfaRecovery(code: string): Promise<CustomMfaGrantResponse> {
  return invoke<CustomMfaGrantResponse>({ mode: 'recovery', code });
}

export async function loadCustomMfaState(): Promise<CustomMfaState> {
  const { data, error } = await supabase.rpc('get_custom_mfa_state');
  if (error || !data) throw new Error('MFA_STATE_UNAVAILABLE');
  return data as unknown as CustomMfaState;
}
