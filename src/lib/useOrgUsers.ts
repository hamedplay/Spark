import { useState, useEffect, useMemo } from 'react';
import { supabase } from './supabase';

export interface OrgUserAssignment {
  positionId: string;
  positionTitle: string | null;
  unitId: string | null;
  unitName: string | null;
  level: number | null;
  isPrimary: boolean;
}

export interface OrgUserProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  position: string | null;
  // واحد سازمانی اصلی
  unit_id: string | null;
  unit_name: string | null;
  // پست سازمانی
  position_title: string | null;
  level: number | null;
  // تمام جایگاه‌های کاربر
  assignments: OrgUserAssignment[];
}

export interface OrgUnitGroup {
  unit_id: string | null;
  unit_name: string;
  users: OrgUserProfile[];
}

interface UseOrgUsersResult {
  groups: OrgUnitGroup[];
  allUsers: OrgUserProfile[];
  loading: boolean;
  error: boolean;
  usersById: Record<string, OrgUserProfile>;
}

const FALLBACK_NAME = 'همکار سازمانی';
const LOADING_NAME = 'در حال دریافت نام...';

function resolveUserDisplay(
  usersById: Record<string, OrgUserProfile>,
  userId: string,
  storedName?: string | null,
  loading = false,
): string {
  if (loading) return LOADING_NAME;
  const u = usersById[userId];
  if (u?.full_name) return u.full_name;
  if (storedName) return storedName;
  return FALLBACK_NAME;
}

export { resolveUserDisplay, FALLBACK_NAME, LOADING_NAME };

const EMPTY_STATE_MESSAGE = 'کاربری در سازمان شما یافت نشد یا سازمان حساب شما تعیین نشده است.';

function parseAssignments(raw: unknown): OrgUserAssignment[] {
  if (!Array.isArray(raw)) return [];
  const out: OrgUserAssignment[] = [];
  const seen = new Set<string>();
  for (const a of raw as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object') continue;
    const positionId = typeof a.position_id === 'string' ? a.position_id : '';
    if (!positionId || seen.has(positionId)) continue;
    seen.add(positionId);
    out.push({
      positionId,
      positionTitle: typeof a.position_title === 'string' ? a.position_title : null,
      unitId: typeof a.unit_id === 'string' ? a.unit_id : null,
      unitName: typeof a.unit_name === 'string' ? a.unit_name : null,
      level: typeof a.level === 'number' ? a.level : null,
      isPrimary: a.is_primary === true,
    });
  }
  return out;
}

export function useOrgUsers(currentUserId: string | null): UseOrgUsersResult {
  const [groups, setGroups] = useState<OrgUnitGroup[]>([]);
  const [allUsers, setAllUsers] = useState<OrgUserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!currentUserId) { setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const { data, error: rpcError } = await supabase.rpc('get_selectable_users_v2');
        if (rpcError) throw rpcError;
        if (cancelled) return;

        const seen = new Set<string>();
        const enriched: OrgUserProfile[] = [];
        for (const p of (data || []) as any[]) {
          if (!p?.user_id || seen.has(p.user_id)) continue;
          seen.add(p.user_id);
          enriched.push({
            user_id: p.user_id,
            full_name: p.full_name,
            email: null,
            avatar_url: p.avatar_url,
            position: p.position,
            unit_id: p.unit_id || null,
            unit_name: p.unit_name || null,
            position_title: p.position_title || null,
            level: p.level || null,
            assignments: parseAssignments(p.assignments),
          });
        }

        setAllUsers(enriched);

        const unitMap: Map<string, OrgUnitGroup> = new Map();
        for (const u of enriched) {
          const key = u.unit_id || '__no_unit__';
          if (!unitMap.has(key)) {
            unitMap.set(key, {
              unit_id: u.unit_id,
              unit_name: u.unit_name || 'بدون جایگاه سازمانی',
              users: [],
            });
          }
          unitMap.get(key)!.users.push(u);
        }

        const sorted = [...unitMap.values()].sort((a, b) => {
          if (a.unit_id && !b.unit_id) return -1;
          if (!a.unit_id && b.unit_id) return 1;
          return a.unit_name.localeCompare(b.unit_name, 'fa');
        });

        setGroups(sorted);
      } catch (err) {
        console.error('useOrgUsers error:', err);
        if (!cancelled) { setError(true); setGroups([]); setAllUsers([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [currentUserId]);

  const usersById = useMemo(() => {
    const map: Record<string, OrgUserProfile> = {};
    for (const u of allUsers) map[u.user_id] = u;
    return map;
  }, [allUsers]);

  return { groups, allUsers, loading, error, usersById };
}

export { EMPTY_STATE_MESSAGE };
