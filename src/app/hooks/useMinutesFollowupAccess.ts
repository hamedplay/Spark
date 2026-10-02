import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';

export interface UseMinutesFollowupAccessParams {
  isAuthenticated: boolean;
  userId: string | null;
  immediate?: boolean;
}

export interface MinutesFollowupAccessState {
  allowed: boolean;
  loading: boolean;
  error: string | null;
}

export function useMinutesFollowupAccess(
  params: UseMinutesFollowupAccessParams
): MinutesFollowupAccessState {
  const { isAuthenticated, userId, immediate = false } = params;

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
    let timer: number | null = null;
    let idleId: number | null = null;
    setState({ allowed: false, loading: true, error: null });

    const load = async () => {
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
    };

    if (immediate) {
      void load();
    } else {
      const idleWindow = window as Window & {
        requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
        cancelIdleCallback?: (id: number) => void;
      };
      if (idleWindow.requestIdleCallback) {
        idleId = idleWindow.requestIdleCallback(() => void load(), { timeout: 1800 });
      } else {
        timer = window.setTimeout(() => void load(), 1000);
      }
    }

    return () => {
      cancelled = true;
      if (timer !== null) window.clearTimeout(timer);
      if (idleId !== null) (window as Window & { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback?.(idleId);
    };
  }, [isAuthenticated, userId, immediate]);

  return state;
}
