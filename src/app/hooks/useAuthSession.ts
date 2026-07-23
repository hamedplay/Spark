import { useState, useEffect, useCallback } from 'react';
import { supabase, handleSupabaseError } from '../../lib/supabase';
import { resolveUserPermissions } from './resolveUserPermissions';

interface AuthSessionState {
  isAuthenticated: boolean;
  loading: boolean;
  isAdmin: boolean;
  currentUserId: string | null;
  userPermissions: Record<string, boolean> | null | undefined;
}

export function useAuthSession(): AuthSessionState {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userPermissions, setUserPermissions] = useState<Record<string, boolean> | null | undefined>(undefined);

  const loadUserPermissions = useCallback(async (userId: string) => {
    try {
      const result = await resolveUserPermissions(userId);
      setUserPermissions(result);
    } catch (err) {
      console.error('loadUserPermissions error:', err);
      setUserPermissions({});
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.error("Auth session error:", error);
        localStorage.removeItem('meeting-manager-auth');
        await supabase.auth.signOut();
        setIsAuthenticated(false);
        setLoading(false);
        return;
      }

      setIsAuthenticated(!!session);

      if (session) {
        try {
          const { data: { user }, error: userError } = await supabase.auth.getUser();
          if (userError || !user) {
            console.error("Auth user error:", userError);
            localStorage.removeItem('meeting-manager-auth');
            await supabase.auth.signOut();
            setIsAuthenticated(false);
          } else {
            setCurrentUserId(user.id);
            const { data: profile, error: profileError } = await supabase
              .from('profiles')
              .select('is_admin')
              .eq('user_id', user.id)
              .maybeSingle();

            if (!profileError && profile) {
              const adminStatus = profile.is_admin === true;
              setIsAdmin(adminStatus);
              if (!adminStatus) {
                await loadUserPermissions(user.id);
              } else {
                setUserPermissions(null);
              }
            } else {
              await loadUserPermissions(user.id);
            }
          }
        } catch (userCheckError) {
          console.error("Error checking user:", userCheckError);
          localStorage.removeItem('meeting-manager-auth');
          await supabase.auth.signOut();
          setIsAuthenticated(false);
        }
      }
    } catch (error) {
      console.error("Auth check error:", error);
      localStorage.removeItem('meeting-manager-auth');
      handleSupabaseError(error);
      setIsAuthenticated(false);
      setUserPermissions({});
    } finally {
      setLoading(false);
    }
  }, [loadUserPermissions]);

  useEffect(() => {
    checkAuth();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
      if (!session) {
        setIsAdmin(false);
        setUserPermissions(undefined);
      } else {
        (async () => {
          const { data: profile } = await supabase
            .from('profiles')
            .select('is_admin')
            .eq('user_id', session.user.id)
            .maybeSingle();
          const adminStatus = profile?.is_admin === true;
          setIsAdmin(adminStatus);
          setCurrentUserId(session.user.id);
          if (adminStatus) {
            setUserPermissions(null);
          } else {
            await loadUserPermissions(session.user.id);
          }
        })();
      }
    });

    return () => subscription.unsubscribe();
  }, [checkAuth, loadUserPermissions]);

  return { isAuthenticated, loading, isAdmin, currentUserId, userPermissions };
}
