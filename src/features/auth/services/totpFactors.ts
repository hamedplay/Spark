import type { Factor } from '@supabase/auth-js';

export type TotpFactorStatus = 'verified' | 'unverified';

export interface TotpFactor {
  id: string;
  friendlyName: string | null;
  factorType: string;
  status: TotpFactorStatus;
  createdAt: string;
}

/** Converts the Supabase Auth MFA wire model to Spark's internal model. */
export function normalizeSupabaseTotpFactors(factors: readonly Factor[]): TotpFactor[] {
  return factors
    .filter((factor) => factor.factor_type === 'totp')
    .map((factor) => ({
      id: factor.id,
      friendlyName: factor.friendly_name ?? null,
      factorType: factor.factor_type,
      status: factor.status,
      createdAt: factor.created_at,
    }));
}
