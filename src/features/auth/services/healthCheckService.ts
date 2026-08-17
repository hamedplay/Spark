import { supabase } from '../../../lib/supabase';
import type { HealthCheckResponse, AuditPageResponse } from '../types/healthCheck';

export async function fetchHealthCheck(): Promise<HealthCheckResponse> {
  const { data, error } = await supabase.functions.invoke('auth-health-check', {
    method: 'GET',
  });
  if (error || !data) throw new Error('HEALTH_CHECK_FAILED');
  return data as HealthCheckResponse;
}

export interface AuditFilter {
  category?: string;
  severity?: string;
  result?: string;
  event_type?: string;
  actor_user_id?: string;
  target_user_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  request_id?: string;
}

export async function fetchAuditPage(filter: AuditFilter = {}): Promise<AuditPageResponse> {
  const { data, error } = await supabase.rpc('get_security_audit_page_v2', {
    p_category: filter.category ?? null,
    p_severity: filter.severity ?? null,
    p_result: filter.result ?? null,
    p_event_type: filter.event_type ?? null,
    p_actor_user_id: filter.actor_user_id ?? null,
    p_target_user_id: filter.target_user_id ?? null,
    p_from: filter.from ?? null,
    p_to: filter.to ?? null,
    p_limit: filter.limit ?? 50,
    p_request_id: filter.request_id ?? null,
  });
  if (error || !data) throw new Error('AUDIT_FETCH_FAILED');
  return data as unknown as AuditPageResponse;
}
