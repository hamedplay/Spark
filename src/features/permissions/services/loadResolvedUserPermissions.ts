import { supabase } from '../../../lib/supabase';

/**
 * Loads and resolves effective permissions for a non-admin user.
 * Returns `null` for full access (when a group grants `all`),
 * otherwise a merged record of granted permission keys.
 *
 * Precedence (later sources override earlier):
 *   1. Legacy user-group permissions
 *   2. Organization-level permissions (by primary position level)
 *   3. Position-level overrides
 *
 * This function performs Supabase queries and merges results.
 * The merging logic is identical to the original implementation.
 */
export async function loadResolvedUserPermissions(
  userId: string,
): Promise<Record<string, boolean> | null> {
  // ── ۱. دسترسی‌های گروه‌بندی (روش قدیمی) ──────────────────────────────
  const { data: memberships } = await supabase
    .from('user_group_members')
    .select('group_id')
    .eq('user_id', userId);

  const merged: Record<string, boolean> = {};

  if (memberships && memberships.length > 0) {
    const groupIds = memberships.map((m: { group_id: string }) => m.group_id);
    const { data: groups } = await supabase
      .from('user_groups')
      .select('permissions')
      .in('id', groupIds);
    for (const g of (groups || [])) {
      const p = (g.permissions || {}) as Record<string, boolean>;
      if (p['all']) { return null; }
      Object.entries(p).forEach(([k, v]) => { if (v) merged[k] = true; });
    }
  }

  // ── ۲. دسترسی از ساختار سازمانی ─────────────────────────────────────
  const { data: primaryMember } = await supabase
    .from('org_position_members')
    .select('position_id, org_positions(level)')
    .eq('user_id', userId)
    .eq('is_primary', true)
    .maybeSingle();

  if (primaryMember?.position_id) {
    const positionId = primaryMember.position_id;
    const posLevel = (primaryMember as unknown as { org_positions?: { level?: number } }).org_positions?.level as number | undefined;

    if (posLevel) {
      const { data: levelPerms } = await supabase
        .from('org_level_permissions')
        .select('permission_key, granted')
        .eq('level', posLevel);
      for (const p of (levelPerms || [])) {
        if (p.granted) merged[p.permission_key] = true;
        else delete merged[p.permission_key];
      }
    }

    const { data: posPerms } = await supabase
      .from('org_position_permissions')
      .select('permission_key, granted')
      .eq('position_id', positionId);
    for (const p of (posPerms || [])) {
      if (p.granted) merged[p.permission_key] = true;
      else delete merged[p.permission_key];
    }
  }

  return merged;
}
