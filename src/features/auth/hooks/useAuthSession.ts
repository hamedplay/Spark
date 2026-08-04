import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, handleSupabaseError } from '../../../lib/supabase';
import { loadResolvedUserPermissions } from '../../permissions';
import type { AuthSessionState, AuthAccessState, AccessLevel, ReasonCode, NextStep } from '../types/authSession';

export function useAuthSession(): AuthSessionState {
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [isFullyAuthorized, setIsFullyAuthorized] = useState(false);
  const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null);
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null);
  const [nextStep, setNextStep] = useState<NextStep>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userPermissions, setUserPermissions] = useState<Record<string, boolean> | null | undefined>(undefined);

  const generationRef = useRef(0);

  const loadUserPermissions = useCallback(async (userId: string) => {
    try {
      const result = await loadResolvedUserPermissions(userId);
      setUserPermissions(result);
    } catch {
      setUserPermissions({});
    }
  }, []);

  const refreshAccessState = useCallback(async () => {
    const gen = ++generationRef.current;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (gen === generationRef.current) {
          setHasSession(false);
          setIsFullyAuthorized(false);
          setAccessLevel(null);
          setReasonCode(null);
          setNextStep('login');
          setCurrentUserId(null);
          setIsAdmin(false);
          setUserPermissions(undefined);
        }
        return;
      }

      const { data, error } = await supabase.rpc('get_my_auth_access_state');
      if (gen !== generationRef.current) return;

      if (error || !data) {
        const isNetworkError =
          (error?.code && String(error.code).startsWith('PGRST')) ||
          (error?.message && (/fetch/i.test(error.message) || /network/i.test(error.message)));
        if (isNetworkError) {
          // Network/server error — don't sign out, let the user retry
          setHasSession(true);
          setIsFullyAuthorized(false);
          setAccessLevel('BLOCKED');
          setReasonCode('ACCESS_CHECK_FAILED');
        } else {
          // Session error — auto sign out and clear storage
          try { localStorage.removeItem('meeting-manager-auth'); } catch { /* ignore */ }
          await supabase.auth.signOut();
          setHasSession(false);
          setIsFullyAuthorized(false);
          setAccessLevel('BLOCKED');
          setReasonCode('SESSION_INVALID');
        }
        return;
      }

      const state = data as AuthAccessState;
      setHasSession(state.has_session);
      setAccessLevel(state.access_level);
      setReasonCode(state.reason_code);
      setNextStep(state.next_step);
      setCurrentUserId(state.user_id);
      setIsFullyAuthorized(state.access_level === 'FULL');

      if (state.access_level === 'FULL' && state.user_id) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin')
          .eq('user_id', state.user_id)
          .maybeSingle();

        if (gen !== generationRef.current) return;

        const adminStatus = profile?.is_admin === true;
        setIsAdmin(adminStatus);
        if (!adminStatus) {
          await loadUserPermissions(state.user_id);
        } else {
          setUserPermissions(null);
        }
      } else {
        setIsAdmin(false);
        setUserPermissions(undefined);
      }
    } catch {
      if (gen === generationRef.current) {
        setHasSession(false);
        setIsFullyAuthorized(false);
      }
    } finally {
      if (gen === generationRef.current) {
        setLoading(false);
      }
    }
  }, [loadUserPermissions]);

  useEffect(() => {
    refreshAccessState();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        const gen = ++generationRef.current;
        setHasSession(false);
        setIsFullyAuthorized(false);
        setAccessLevel(null);
        setReasonCode(null);
        setNextStep('login');
        setCurrentUserId(null);
        setIsAdmin(false);
        setUserPermissions(undefined);
        setLoading(false);
      } else {
        refreshAccessState();
      }
    });

    return () => subscription.unsubscribe();
  }, [refreshAccessState]);

  const isAuthenticated = hasSession && isFullyAuthorized;

  return {
    loading,
    hasSession,
    isFullyAuthorized,
    isAuthenticated,
    accessLevel,
    reasonCode,
    nextStep,
    currentUserId,
    isAdmin,
    userPermissions,
    refreshAccessState,
  };
}
