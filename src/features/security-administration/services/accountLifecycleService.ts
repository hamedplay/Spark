import { supabase } from '../../../lib/supabase';
import type { LifecycleState, LifecycleAction } from '../types/accountLifecycle';

export async function loadLifecycleState(
  status?: string | null,
  search?: string | null,
  limit?: number,
  offset?: number,
): Promise<LifecycleState> {
  const { data, error } = await (supabase.rpc as any)('get_account_lifecycle_management_state', {
    p_status: status ?? null,
    p_search: search ?? null,
    p_limit: limit ?? 50,
    p_offset: offset ?? 0,
  } as any) as any;
  if (error) throw error;
  return data as LifecycleState;
}

export async function setLifecycleState(
  targetUserId: string,
  action: LifecycleAction,
  expectedVersion: number,
  changeReason: string,
): Promise<{ ok: boolean; error?: string; new_version?: number; new_status?: string }> {
  const { data, error } = await (supabase.rpc as any)('set_user_account_lifecycle_state', {
    p_target_user_id: targetUserId,
    p_action: action,
    p_expected_version: expectedVersion,
    p_change_reason: changeReason,
  } as any) as any;
  if (error) throw error;
  return data;
}

export async function loadLifecycleHistory(
  targetUserId: string,
): Promise<any[]> {
  const { data, error } = await supabase
    .from('account_lifecycle_history')
    .select('*')
    .eq('target_user_id', targetUserId)
    .order('changed_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return data || [];
}
