import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export interface UseMinutesFollowupAccessParams {
  isAuthenticated: boolean;
  userId: string | null;
}

export interface MinutesFollowupAccessState {
  allowed: boolean;
  loading: boolean;
  error: string | null;
}

export function useMinutesFollowupAccess(
  params: UseMinutesFollowupAccessParams
): MinutesFollowupAccessState {
  const { isAuthenticated, userId } = params;

  const [state, setState] = useState<MinutesFollowupAccessState>({
    allowed: false,
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!isAuthenticated || !userId) {
      setState({ allowed: false, loading: false, error: null });
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
        const allowed = typeof data === 'boolean'
          ? data
          : Array.isArray(data) && data.length > 0
            ? data[0] === true || (typeof data[0] === 'object' && data[0] !== null && Object.values(data[0])[0] === true)
            : false;
        setState({ allowed, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setState({ allowed: false, loading: false, error: message });
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated, userId]);

  return state;
}
