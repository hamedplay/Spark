export type CustomMfaFactor = 'totp' | 'sms' | 'bale' | 'email' | 'recovery';

export interface CustomMfaChallengeResponse {
  ok: boolean;
  challenge_id?: string;
  expires_at?: string;
  factor_type?: Exclude<CustomMfaFactor, 'totp' | 'recovery'>;
  error?: string;
}

export interface CustomMfaGrantResponse {
  ok: boolean;
  grant_expires_at?: string;
  error?: string;
}

export interface CustomMfaState {
  ok: boolean;
  enabled: boolean;
  required: boolean;
  allowed_factors: CustomMfaFactor[];
  challenge_ttl_seconds: number;
  max_resends: number;
  max_attempts: number;
  grant_lifetime_minutes: number;
  factors: Array<{
    factor_type: CustomMfaFactor;
    factor_status: 'pending' | 'active' | 'disabled';
    has_totp_secret: boolean;
    has_phone: boolean;
    has_email: boolean;
    has_bale: boolean;
    recovery_codes_count: number;
  }>;
  error?: string;
}
