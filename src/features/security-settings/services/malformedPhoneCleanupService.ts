import { supabase } from '../../../lib/supabase';

export interface MalformedPhoneRecord {
  user_id: string;
  email: string | null;
  profile_phone: string | null;
  auth_phone: string | null;
  profile_problem: boolean;
  auth_problem: boolean;
}

export interface ClearMalformedPhoneResult {
  ok: boolean;
  error?: string;
  auth_phone_cleared?: boolean;
  profile_phone_cleared?: boolean;
}

type RpcClient = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
};

const rpcClient = supabase as unknown as RpcClient;

export async function listMalformedPhoneRecords(): Promise<MalformedPhoneRecord[]> {
  const { data, error } = await rpcClient.rpc('list_malformed_phone_records');

  if (error) {
    throw new Error(error.message ?? 'LIST_MALFORMED_PHONE_RECORDS_FAILED');
  }

  if (!Array.isArray(data)) return [];
  return data as MalformedPhoneRecord[];
}

export async function clearMalformedPhoneRecord(
  userId: string
): Promise<ClearMalformedPhoneResult> {
  const { data, error } = await rpcClient.rpc('clear_malformed_phone_record', {
    p_user_id: userId,
  });

  if (error) {
    return { ok: false, error: error.message ?? 'UNKNOWN_SECURITY_ERROR' };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'UNKNOWN_SECURITY_ERROR' };
  }

  const result = data as Record<string, unknown>;
  return {
    ok: result.ok === true,
    error: typeof result.error === 'string' ? result.error : undefined,
    auth_phone_cleared: result.auth_phone_cleared === true,
    profile_phone_cleared: result.profile_phone_cleared === true,
  };
}
