import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export interface UseMinutesFollowupAccessParams {
  isAuthenticated: boolean;
  isAdmin: boolean;
  userId: string | null;
  hasGlobalPermission: boolean;
}

export interface MinutesFollowupAccessState {
  allowed: boolean;
  loading: boolean;
  error: string | null;
}

function normalizeRpcResult(data: unknown): boolean {
  if (typeof data === 'boolean') return data;
  if (Array.isArray(data) && data.length > 0) {
    const first = data[0];
    if (first && typeof first === 'object') {
      const row = first as Record<string, unknown>;
      const value = row[Object.keys(row)[0]];
      return value === true || value === 't' || value === 1;
    }
    return first === true;
  }
  return false;
}

export function useMinutesFollowupAccess(
  params: UseMinutesFollowupAccessParams
): MinutesFollowupAccessState {
  const { isAuthenticated, isAdmin, userId, hasGlobalPermission } = params;

  const [state, setState] = useState<MinutesFollowupAccessState>({
    allowed: false,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!isAuthenticated) {
      setState({ allowed: false, loading: false, error: null });
      return;
    }
    if (isAdmin || hasGlobalPermission) {
      setState({ allowed: true, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ allowed: false, loading: true, error: null });

    (async () => {
      try {
        const { data, error } = await supabase.rpc('has_any_trackable_minutes_decision');
        if (cancelled) return;
        if (error) {
          setState({ allowed: false, loading: false, error: error.message });
          return;
        }
        setState({ allowed: normalizeRpcResult(data), loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ allowed: false, loading: false, error: message });
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, isAdmin, userId, hasGlobalPermission]);

  return state;
}
