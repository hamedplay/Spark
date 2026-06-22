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
    load(currentUserId);
  }, [currentUserId]);

  const load = async (userId: string) => {
    setLoading(true);
    try {
      // همه پروفایل‌ها به همراه پست اصلی و واحد سازمانی آن پست
      const { data: members } = await supabase
        .from('org_position_members')
        .select(`
          user_id,
          is_primary,
          org_positions (
            id,
            title,
            level,
            unit_id,
            org_units ( id, name )
          )
        `)
        .eq('is_primary', true);

      // مپ user_id → اطلاعات سازمانی
      const orgMap: Record<string, {
        unit_id: string | null;
        unit_name: string | null;
        position_title: string | null;
        level: number | null;
      }> = {};

      for (const m of (members || [])) {
        const pos = (m as any).org_positions;
        if (!pos) continue;
        const unit = pos.org_units;
        orgMap[m.user_id] = {
          unit_id: unit?.id || null,
          unit_name: unit?.name || null,
          position_title: pos.title || null,
          level: pos.level || null,
        };
      }

      // همه پروفایل‌ها
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, avatar_url, position')
        .not('is_active', 'eq', false)
        .not('is_hidden', 'eq', true)
        .order('full_name');

      const enriched: OrgUserProfile[] = (profiles || []).map(p => ({
        user_id: p.user_id,
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
        position: p.position,
        unit_id: orgMap[p.user_id]?.unit_id || null,
        unit_name: orgMap[p.user_id]?.unit_name || null,
        position_title: orgMap[p.user_id]?.position_title || null,
        level: orgMap[p.user_id]?.level || null,
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
