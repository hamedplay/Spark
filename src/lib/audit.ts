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
let _cachedIp: string | null = null;

async function getClientIp(): Promise<string | null> {
  if (_cachedIp) return _cachedIp;
  try {
    const res = await fetch('https://api.ipify.org?format=json', { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    const data = await res.json();
    _cachedIp = data?.ip || null;
    return _cachedIp;
  } catch {
    return null;
  }
}

async function getActor(): Promise<{ userId: string | null; userName: string | null }> {
  if (_cachedUserId) return { userId: _cachedUserId, userName: _cachedUserName };
  try {
    const { data: { user } } = await supabase.auth.getUser();
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

// Reset cache on auth state change so next call re-fetches fresh user
supabase.auth.onAuthStateChange(() => {
  _cachedUserId = null;
  _cachedUserName = null;
  _cachedIp = null;
});

export async function logAudit(payload: AuditPayload): Promise<void> {
  try {
    const [{ userId, userName }, ip] = await Promise.all([getActor(), getClientIp()]);
    const ua = navigator.userAgent;
    await supabase.from('audit_log').insert({
      user_id: userId,
      user_name: userName,
      ip_address: ip,
      user_agent: ua,
      module: payload.module,
      action: payload.action,
      entity_name: payload.entity_name ?? null,
      entity_id: payload.entity_id ?? null,
      details: payload.details ?? null,
      severity: payload.severity ?? 'info',
      url: window.location.href,
    });
  } catch {
    // Audit logging must never break the main flow
  }
}
