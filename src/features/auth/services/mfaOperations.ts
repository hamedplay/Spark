import { supabase } from '../../../lib/supabase';
import { validateTotpCode } from './totpValidation';

export { validateTotpCode } from './totpValidation';

export type TotpFactorStatus = 'verified' | 'unverified';

export interface TotpFactor {
  id: string;
  friendlyName: string | null;
  factorType: string;
  status: TotpFactorStatus;
  createdAt: string;
}

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

export async function listCurrentUserTotpFactors(): Promise<TotpFactor[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;

  const factors = data?.all ?? [];
  return factors
    .filter((f) => f.factorType === 'totp')
    .map((f) => ({
      id: f.id,
      friendlyName: f.friendlyName ?? null,
      factorType: f.factorType,
      status: f.status as TotpFactorStatus,
      createdAt: f.createdAt ?? new Date().toISOString(),
    }));
}

export async function startTotpEnrollment(
  friendlyName = 'Spark Authenticator'
): Promise<TotpEnrollmentResult> {
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'totp',
    friendlyName,
  });
  if (error) throw error;
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

  const { error: challengeError } = await supabase.auth.mfa.challenge({
    factorId,
  });
  if (challengeError) throw challengeError;

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId,
    challengeId: '',
    code: validCode,
  });
  if (verifyError) throw verifyError;

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const currentLevel = aalData?.currentLevel ?? '';
  if (currentLevel !== 'aal2') throw new Error('AAL2_NOT_REACHED');

  return { currentAal: currentLevel };
}

export async function cancelCurrentTotpEnrollment(factorId: string): Promise<void> {
  const { error } = await supabase.auth.mfa.unenroll({
    factorId,
  });
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

  const { error: challengeError } = await supabase.auth.mfa.challenge({
    factorId: params.factorId,
  });
  if (challengeError) {
    return { ok: false, grantId: null, purpose: null, expiresAt: null, error: 'CHALLENGE_FAILED' };
  }

  const { error: verifyError } = await supabase.auth.mfa.verify({
    factorId: params.factorId,
    challengeId: '',
    code: validCode,
  });
  if (verifyError) {
    return { ok: false, grantId: null, purpose: null, expiresAt: null, error: 'VERIFY_FAILED' };
  }

  const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const currentLevel = aalData?.currentLevel ?? '';
  if (currentLevel !== 'aal2') {
    return { ok: false, grantId: null, purpose: null, expiresAt: null, error: 'AAL2_NOT_REACHED' };
  }

  await supabase.auth.getSession();

  const { data: rpcData, error: rpcError } = await supabase.rpc('issue_totp_stepup_grant', {
    p_purpose: params.purpose,
  });

  if (rpcError || !rpcData || !rpcData.ok) {
    const errorCode = rpcData?.error || rpcError?.message || 'RPC_FAILED';
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
