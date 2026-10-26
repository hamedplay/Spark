import { useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import { readSessionHeartbeatError, sessionHeartbeatRetrySeconds } from './sessionHeartbeatErrors';

const DEFAULT_HEARTBEAT_SECONDS = 300;
const MIN_HEARTBEAT_SECONDS = 30;
const MAX_HEARTBEAT_SECONDS = 3600;

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
  'SESSION_NOT_FOUND',
  'PROFILE_NOT_FOUND',
  'UNAUTHORIZED',
]);

export function useSessionHeartbeat(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let timer: number | null = null;
    let retryAttempt = 0;

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

        const errorCode = await readSessionHeartbeatError(data, error);
        if (cancelled) return;
        if ((!data?.ok || error) && errorCode && FATAL_SESSION_ERRORS.has(errorCode)) {
          await supabase.auth.signOut({ scope: 'local' });
          return;
        }

        if (!data?.ok || error) {
          schedule(sessionHeartbeatRetrySeconds(retryAttempt++));
          return;
        }

        retryAttempt = 0;
        schedule(normalizeIntervalSeconds(data.heartbeat_interval_seconds));
      } catch {
        if (!cancelled) schedule(sessionHeartbeatRetrySeconds(retryAttempt++));
      }
    };

    // Auth bootstrap has just validated the session. Avoid duplicating that
    // network work during first paint; begin the heartbeat after the minimum
    // policy interval, then continue using the server-provided cadence.
    schedule(MIN_HEARTBEAT_SECONDS);

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled]);
}
