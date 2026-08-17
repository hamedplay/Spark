import { supabase } from '../../../lib/supabase';
import type {
  RecoveryRequestResponse,
  RecoveryVerifyResponse,
  RecoveryCompleteResponse,
  SessionListResponse,
  SessionHeartbeatResponse,
  SessionRevokeResponse,
  RecoveryIdentifierType,
  RecoveryChannel,
} from '../types/recovery';

async function invokeRecovery<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('unified-recovery', { body });
  if (error || !data) throw new Error('RECOVERY_OPERATION_FAILED');
  return data as T;
}

export function requestRecovery(
  identifierType: RecoveryIdentifierType,
  identifierValue: string,
  channel?: RecoveryChannel,
  channelValue?: string,
): Promise<RecoveryRequestResponse> {
  return invokeRecovery<RecoveryRequestResponse>({
    mode: 'request',
    identifier_type: identifierType,
    identifier_value: identifierValue,
    channel,
    channel_value: channelValue,
  });
}

export function verifyRecovery(challengeId: string, code: string): Promise<RecoveryVerifyResponse> {
  return invokeRecovery<RecoveryVerifyResponse>({ mode: 'verify', challenge_id: challengeId, code });
}

export function completeRecovery(challengeId: string, resetToken: string, newPassword: string): Promise<RecoveryCompleteResponse> {
  return invokeRecovery<RecoveryCompleteResponse>({ mode: 'complete', challenge_id: challengeId, reset_token: resetToken, new_password: newPassword });
}

async function invokeSession<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('session-management', { body });
  if (error || !data) throw new Error('SESSION_OPERATION_FAILED');
  return data as T;
}

export function listSessions(): Promise<SessionListResponse> {
  return invokeSession<SessionListResponse>({ mode: 'list' });
}

export function heartbeatSession(): Promise<SessionHeartbeatResponse> {
  return invokeSession<SessionHeartbeatResponse>({ mode: 'heartbeat' });
}

export function revokeSession(sessionId: string, reason?: string): Promise<SessionRevokeResponse> {
  return invokeSession<SessionRevokeResponse>({ mode: 'revoke_one', session_id: sessionId, reason });
}

export function revokeOtherSessions(): Promise<SessionRevokeResponse> {
  return invokeSession<SessionRevokeResponse>({ mode: 'revoke_others' });
}

export function revokeAllSessions(): Promise<SessionRevokeResponse> {
  return invokeSession<SessionRevokeResponse>({ mode: 'revoke_all' });
}
