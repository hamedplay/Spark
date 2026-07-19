import { useState, useEffect } from 'react';
import { supabase } from './supabase';

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
}

export function useOrgUsers(currentUserId: string | null): UseOrgUsersResult {
  const [groups, setGroups] = useState<OrgUnitGroup[]>([]);
  const [allUsers, setAllUsers] = useState<OrgUserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUserId) return;
    load();
  }, [currentUserId]);

  const load = async () => {
    setLoading(true);
    try {
      // همه کاربران قابل انتخاب به همراه جایگاه سازمانی — از RPC امن
      const { data, error } = await supabase.rpc('get_selectable_users');
      if (error) throw error;

      const enriched: OrgUserProfile[] = (data || []).map((p: any) => ({
        user_id: p.user_id,
        full_name: p.full_name,
        email: null,
        avatar_url: p.avatar_url,
        position: p.position,
        unit_id: p.unit_id || null,
        unit_name: p.unit_name || null,
        position_title: p.position_title || null,
        level: p.level || null,
      }));

      setAllUsers(enriched);

      // گروه‌بندی بر اساس واحد
      const unitMap: Map<string, OrgUnitGroup> = new Map();

      for (const u of enriched) {
        const key = u.unit_id || '__no_unit__';
        if (!unitMap.has(key)) {
          unitMap.set(key, {
            unit_id: u.unit_id,
            unit_name: u.unit_name || 'بدون واحد سازمانی',
            users: [],
          });
        }
        unitMap.get(key)!.users.push(u);
      }

      // واحدهای دارای کاربر، مرتب‌شده: اول واحدهای تعریف‌شده، بعد بدون واحد
      const sorted = [...unitMap.values()].sort((a, b) => {
        if (a.unit_id && !b.unit_id) return -1;
        if (!a.unit_id && b.unit_id) return 1;
        return a.unit_name.localeCompare(b.unit_name, 'fa');
      });

      setGroups(sorted);
    } catch (err) {
      console.error('useOrgUsers error:', err);
    } finally {
      setLoading(false);
    }
  };

  return { groups, allUsers, loading };
}
