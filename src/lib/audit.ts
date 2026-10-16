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

let _cachedUserId: string | null = null;
let _cachedUserName: string | null = null;

async function getActor(): Promise<{ userId: string | null; userName: string | null }> {
  if (_cachedUserId) return { userId: _cachedUserId, userName: _cachedUserName };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user) return { userId: null, userName: null };

    _cachedUserId = user.id;
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name, email')
      .eq('user_id', user.id)
      .maybeSingle();
    _cachedUserName = profile?.full_name || profile?.email || user.email || null;
    return { userId: _cachedUserId, userName: _cachedUserName };
  } catch {
    return { userId: null, userName: null };
  }
}

// Reset cache on auth state change so next call re-fetches fresh user.
supabase.auth.onAuthStateChange(() => {
  _cachedUserId = null;
  _cachedUserName = null;
});

export async function logAudit(payload: AuditPayload): Promise<void> {
  try {
    const { userId, userName } = await getActor();
    // Do not issue a REST write while auth is being established or torn down.
    // Those transient calls produced misleading 401s and never represented a
    // valid auditable actor.
    if (!userId) return;

    const { error } = await supabase.from('audit_log').insert({
      user_id: userId,
      user_name: userName,
      ip_address: null,
      user_agent: navigator.userAgent,
      module: payload.module,
      action: payload.action,
      entity_name: payload.entity_name ?? null,
      entity_id: payload.entity_id ?? null,
      details: payload.details ?? null,
      severity: payload.severity ?? 'info',
      url: window.location.href,
    });

    // Audit logging is best-effort and must never interfere with the action
    // being audited. The error is intentionally consumed here.
    void error;
  } catch {
    // Audit logging must never break the main flow.
  }
}
