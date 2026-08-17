import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../../../lib/supabase';
import type { AuthSessionState, AuthAccessState, AccessLevel, ReasonCode, NextStep } from '../types/authSession';

export function useAuthSession(): AuthSessionState {
  const [loading, setLoading] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [isFullyAuthorized, setIsFullyAuthorized] = useState(false);
  const [accessLevel, setAccessLevel] = useState<AccessLevel | null>(null);
  const [reasonCode, setReasonCode] = useState<ReasonCode | null>(null);
  const [nextStep, setNextStep] = useState<NextStep>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [accountStatus, setAccountStatus] = useState<string | null>(null);
  const [profileCompletionStatus, setProfileCompletionStatus] = useState<string | null>(null);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [hasVerifiedTotp, setHasVerifiedTotp] = useState(false);
  const [currentAal, setCurrentAal] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userPermissions, setUserPermissions] = useState<Record<string, boolean> | null | undefined>(undefined);

  const generationRef = useRef(0);

  const resetSessionState = useCallback((next: NextStep = 'login') => {
    setHasSession(false);
    setIsFullyAuthorized(false);
    setAccessLevel(null);
    setReasonCode(null);
    setNextStep(next);
    setCurrentUserId(null);
    setSessionId(null);
    setAccountStatus(null);
    setProfileCompletionStatus(null);
    setMfaRequired(false);
    setHasVerifiedTotp(false);
    setCurrentAal(null);
    setIsAdmin(false);
    setUserPermissions(undefined);
  }, []);

  const refreshAccessState = useCallback(async () => {
    const gen = ++generationRef.current;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        if (gen === generationRef.current) resetSessionState('login');
        return;
      }

      // One RPC now returns the canonical auth gate result plus the admin flag
      // and effective UI permissions. This replaces the previous auth RPC ->
      // profiles query -> several permission queries waterfall.
      const { data, error } = await supabase.rpc('get_my_app_bootstrap_v1');
      if (gen !== generationRef.current) return;

      if (error || !data) {
        const isNetworkError =
          (error?.code && String(error.code).startsWith('PGRST')) ||
          (error?.message && (/fetch/i.test(error.message) || /network/i.test(error.message)));
        if (isNetworkError) {
          setHasSession(true);
          setIsFullyAuthorized(false);
          setAccessLevel('BLOCKED');
          setReasonCode('ACCESS_CHECK_FAILED');
        } else {
          try { localStorage.removeItem('meeting-manager-auth'); } catch { /* ignore */ }
          await supabase.auth.signOut();
          resetSessionState('login');
          setAccessLevel('BLOCKED');
          setReasonCode('SESSION_INVALID');
        }
        return;
      }

      const state = data as AuthAccessState;
      const fullAccess = state.access_level === 'FULL';
      const adminStatus = fullAccess && state.is_admin === true;

      setHasSession(state.has_session);
      setAccessLevel(state.access_level);
      setReasonCode(state.reason_code);
      setNextStep(state.next_step);
      setCurrentUserId(state.user_id);
      setSessionId(state.session_id);
      setAccountStatus(state.account_status);
      setProfileCompletionStatus(state.profile_completion_status);
      setMfaRequired(state.mfa_required);
      setHasVerifiedTotp(state.has_verified_totp);
      setCurrentAal(state.current_aal);
      setIsFullyAuthorized(fullAccess);
      setIsAdmin(adminStatus);

      if (fullAccess && state.user_id) {
        // `null` is intentional: it means unrestricted access (admin or a
        // group with permissions.all=true). An absent field fails closed.
        setUserPermissions(state.permissions === undefined ? {} : state.permissions);
      } else {
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
  }, [resetSessionState]);

  useEffect(() => {
    void refreshAccessState();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!session) {
        ++generationRef.current;
        resetSessionState('login');
        setLoading(false);
      } else if (event === 'TOKEN_REFRESHED' || event === 'MFA_CHALLENGE_VERIFIED' || event === 'SIGNED_IN') {
        void refreshAccessState();
      }
    });

    return () => subscription.unsubscribe();
  }, [refreshAccessState, resetSessionState]);

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
    sessionId,
    accountStatus,
    profileCompletionStatus,
    mfaRequired,
    hasVerifiedTotp,
    currentAal,
    isAdmin,
    userPermissions,
    refreshAccessState,
  };
}
