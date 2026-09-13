import { useEffect } from 'react';
import { supabase } from '../../../lib/supabase';

const DEFAULT_HEARTBEAT_SECONDS = 300;
const MIN_HEARTBEAT_SECONDS = 30;
const MAX_HEARTBEAT_SECONDS = 3600;
const RETRY_SECONDS = 60;

function normalizeIntervalSeconds(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_HEARTBEAT_SECONDS;
  return Math.min(MAX_HEARTBEAT_SECONDS, Math.max(MIN_HEARTBEAT_SECONDS, Math.trunc(parsed)));
}

const FATAL_SESSION_ERRORS = new Set([
  'AUTH_ACCESS_RESTRICTED',
  'SESSION_REVOKED',
  'EPOCH_MISMATCH',
  'SESSION_ABSOLUTE_EXPIRED',
  'SESSION_IDLE_EXPIRED',
  'SESSION_INVALID',
]);

export function useSessionHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: number | null = null;

    const schedule = (seconds: number) => {
      if (cancelled) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void heartbeat(); }, seconds * 1000);
    };

    const heartbeat = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('session-management', {
          method: 'POST',
          body: { mode: 'heartbeat' },
        });

        if (cancelled) return;

        const errorCode = typeof data?.error === 'string' ? data.error : null;
        if ((!data?.ok || error) && errorCode && FATAL_SESSION_ERRORS.has(errorCode)) {
          await supabase.auth.signOut({ scope: 'local' });
          return;
        }

        if (!data?.ok || error) {
          schedule(RETRY_SECONDS);
          return;
        }

        schedule(normalizeIntervalSeconds(data.heartbeat_interval_seconds));
      } catch {
        if (!cancelled) schedule(RETRY_SECONDS);
      }
    };

    void heartbeat();

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);
}
