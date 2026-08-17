export type RecoveryIdentifierType = 'username' | 'email' | 'phone';
export type RecoveryChannel = 'email' | 'phone' | 'bale';

export interface RecoveryRequestResponse {
  ok: boolean;
  challenge_id?: string;
  requires_channel?: boolean;
  email_hint?: string;
  phone_hint?: string;
  error?: string;
  retry_after_seconds?: number;
}

export interface RecoveryVerifyResponse {
  ok: boolean;
  reset_token?: string;
  error?: string;
}

export interface RecoveryCompleteResponse {
  ok: boolean;
  error?: string;
}

export interface SessionInfo {
  session_id: string;
  created_at: string;
  last_activity_at: string;
  idle_expiry_at: string;
  absolute_expiry_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  device_summary: string | null;
  status: 'active' | 'revoked' | 'idle_expired' | 'absolute_expired';
}

export interface SessionListResponse {
  ok: boolean;
  sessions: SessionInfo[];
  error?: string;
}

export interface SessionHeartbeatResponse {
  ok: boolean;
  idle_expiry_at?: string;
  absolute_expiry_at?: string;
  error?: string;
}

export interface SessionRevokeResponse {
  ok: boolean;
  revoked_count?: number;
  error?: string;
}
