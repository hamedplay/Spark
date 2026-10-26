interface HistoryError {
  code?: string;
  message?: string;
}
interface HistoryRow {
  id: string;
  caller_id: string;
  callee_id: string;
  created_at: string;
  duration_seconds: number;
}
interface HistoryResult {
  data: HistoryRow[] | null;
  error: HistoryError | null;
}
interface HistoryQuery extends PromiseLike<HistoryResult> {
  select(columns: string): HistoryQuery;
  or(filter: string): HistoryQuery;
  in(column: string, values: string[]): HistoryQuery;
  order(column: string, options: { ascending: boolean }): HistoryQuery;
  limit(count: number): HistoryQuery;
}
export interface CallHistoryClient {
  rpc(name: 'get_my_call_history', args: { p_limit: number }): PromiseLike<HistoryResult>;
  from(table: 'call_sessions'): Pick<HistoryQuery, 'select'>;
}

export async function loadCallHistory(client: CallHistoryClient, currentUserId: string) {
  const result = await client.rpc('get_my_call_history', { p_limit: 100 });
  // Only a missing API function permits legacy reading. Do not bypass a
  // permission/network/server error or expose history hidden by the new RPC.
  if (result.error?.code !== 'PGRST202') {
    return { ...result, canClear: !result.error };
  }
  const legacy = await client.from('call_sessions')
    .select('*')
    .or(`caller_id.eq.${currentUserId},callee_id.eq.${currentUserId}`)
    .in('status', ['ended', 'declined', 'missed'])
    .order('created_at', { ascending: false })
    .limit(100);
  return { ...legacy, canClear: false };
}

export function callHistoryLoadError(error: HistoryError | null) {
  return `دریافت تاریخچه تماس‌ها ناموفق بود${error?.code ? ` (${error.code})` : ''}`;
}
