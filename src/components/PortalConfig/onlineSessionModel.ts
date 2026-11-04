export interface OnlineSession {
  session_id: string; user_id: string; full_name: string | null; email: string | null; position: string | null;
  is_admin: boolean; is_current: boolean; device_summary: string | null; client_hints: Record<string, unknown> | null;
  ip_address: string | null; ip_observed_at: string | null; last_seen: string; created_at: string;
}
export function groupOnlineSessions(rows: OnlineSession[]) {
  const users=new Map<string,OnlineSession[]>();
  for(const row of rows) { const list=users.get(row.user_id)||[]; list.push(row); users.set(row.user_id,list); }
  return [...users.entries()].map(([userId,sessions])=>({userId,sessions,profile:sessions[0]}));
}
