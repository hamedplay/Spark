import { supabase } from '../../../lib/supabase';
import { validateTotpCode } from './totpValidation';
import { normalizeSupabaseTotpFactors } from './totpFactors';

export type { TotpFactor, TotpFactorStatus } from './totpFactors';
import type { TotpFactor } from './totpFactors';

export { validateTotpCode } from './totpValidation';

export interface TotpEnrollmentResult {
  factorId: string;
  qrCode: string;
  secret: string;
  uri: string;
}

export interface StepUpGrantResult {
  ok: boolean;
  grantId: string | null;
  purpose: string | null;
  expiresAt: string | null;
  error: string | null;
}

export type StepUpPurpose = 'auth_settings_change' | 'account_security_change';

export type MfaEnrollError =
  | 'INSUFFICIENT_AAL'
  | 'ENROLLMENT_FAILED'
  | 'NETWORK_ERROR'
  | 'INVALID_CODE'
  | 'CHALLENGE_FAILED'
  | 'VERIFY_FAILED'
  | 'AAL2_NOT_REACHED'
  | 'SESSION_INVALID'
  | 'STEPUP_DENIED'
  | 'RECENT_TOTP_REQUIRED'
  | 'SECURITY_ADMIN_REQUIRED'
  | 'PURPOSE_NOT_ALLOWED'
  | 'UNKNOWN_MFA_ERROR';

export type VerifyResult = {
  ok: boolean;
  error: MfaEnrollError | null;
  currentAal: string | null;
};

function mapMfaError(err: unknown): MfaEnrollError {
  if (!err || typeof err !== 'object') return 'UNKNOWN_MFA_ERROR';
  const code = (err as { code?: string }).code ?? '';
  const message = (err as { message?: string }).message ?? '';
  if (code === 'insufficient_aal') return 'INSUFFICIENT_AAL';
  if (/invalid|expired|code/i.test(message)) return 'INVALID_CODE';
  if (/challenge/i.test(message)) return 'CHALLENGE_FAILED';
  if (/verify/i.test(message)) return 'VERIFY_FAILED';
  if (/network|fetch/i.test(message)) return 'NETWORK_ERROR';
  return 'UNKNOWN_MFA_ERROR';
}

export async function getCurrentAal(): Promise<string> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel ?? '';
}

export async function listCurrentUserTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;

  return normalizeSupabaseTotpFactors(data?.all ?? []);
}

export async function startTotpEnrollment(): Promise<TotpEnrollmentResult> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName: `totp-${crypto.randomUUID()}`,
  });
  if (error) throw new Error(mapMfaError(error));
  if (!data) throw new Error('ENROLLMENT_FAILED');

  return {
    factorId: data.id,
    qrCode: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

export async function verifyTotpFactor(
  factorId: string,
  code: string
): Promise<{ currentAal: string }> {
  const validCode = validateTotpCode(code);
  if (!validCode) throw new Error('INVALID_CODE');

  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
    factorId,
    code: validCode,
  });
  if (verifyError) throw new Error(mapMfaError(verifyError));

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const currentLevel = aalData?.currentLevel ?? '';
  if (currentLevel !== 'aal2') throw new Error('AAL2_NOT_REACHED');

  return { currentAal: currentLevel };
}

/** Only call after a newly enrolled factor has been verified.  Login and
 * ordinary step-up verification must never change the canonical MFA method. */
export async function activateCanonicalTotpAfterEnrollment(): Promise<void> {
  const { data, error } = await supabase.rpc('activate_canonical_totp_mfa');
  if (error || !data?.ok) throw new Error(data?.error === 'MFA_SWITCH_REQUIRED' ? 'STEPUP_DENIED' : 'VERIFY_FAILED');
}

export async function cancelCurrentTotpEnrollment(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({
    factorId,
  });
  if (error) throw error;
}

export async function unenrollTotpFactor(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

export interface PerformTotpStepUpParams {
  factorId: string;
  code: string;
  purpose: StepUpPurpose;
}

export async function performTotpStepUp(
  params: PerformTotpStepUpParams
): Promise<StepUpGrantResult> {
  const validCode = validateTotpCode(params.code);
  if (!validCode) {
    return { ok: false, grantId: null, purpose: null, expiresAt: null, error: 'INVALID_CODE' };
  }

  const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
    factorId: params.factorId,
    code: validCode,
  });
  if (verifyError) {
    return { ok: false, grantId: null, purpose: null, expiresAt: null, error: mapMfaError(verifyError) };
  }

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const currentLevel = aalData?.currentLevel ?? '';
  if (currentLevel !== 'aal2') {
    return { ok: false, grantId: null, purpose: null, expiresAt: null, error: 'AAL2_NOT_REACHED' };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData?.session?.access_token) {
    return { ok: false, grantId: null, purpose: null, expiresAt: null, error: 'SESSION_INVALID' };
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('issue_totp_stepup_grant', {
    p_purpose: params.purpose,
  });

  if (rpcError || !rpcData || !rpcData.ok) {
    const errorCode: string = rpcData?.error ?? 'STEPUP_DENIED';
    return { ok: false, grantId: null, purpose: null, expiresAt: null, error: errorCode };
  }

  return {
    ok: true,
    grantId: rpcData.grant_id ?? null,
    purpose: rpcData.purpose ?? null,
    expiresAt: rpcData.expires_at ?? null,
    error: null,
  };
}
