import { supabase } from './supabase';

export type AuditSeverity = 'info' | 'warning' | 'error' | 'critical';

export interface AuditPayload {
  module: string;
  action: string;
  entity_name?: string;
  entity_id?: string;
  details?: string;
  severity?: AuditSeverity;
}

export async function logAudit(payload: AuditPayload): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) return;

    const { error } = await supabase.rpc('write_audit_log' as never, {
      p_module: payload.module,
      p_action: payload.action,
      p_entity_name: payload.entity_name ?? null,
      p_entity_id: payload.entity_id ?? null,
      p_details: payload.details ?? null,
      p_severity: payload.severity ?? 'info',
      p_user_agent: navigator.userAgent,
      p_url: window.location.href,
      p_referrer: document.referrer || null,
    } as never);

    // Audit logging is best-effort and must never interfere with the action
    // being audited. Actor identity and client IP are derived server-side.
    void error;
  } catch {
    // Audit logging must never break the main flow.
  }
}
