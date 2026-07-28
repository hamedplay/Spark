import { supabase } from '../../lib/supabase';

export interface PublicProfile {
  user_id: string;
  full_name: string | null;
  username: string | null;
  avatar_url: string | null;
  position: string | null;
  department: string | null;
  organization: string | null;
  primary_unit_id: string | null;
  primary_unit_name: string | null;
  primary_position_id: string | null;
  primary_position_title: string | null;
}

const COLUMNS = 'user_id, full_name, username, avatar_url, position, department, organization, primary_unit_id, primary_unit_name, primary_position_id, primary_position_title';

export async function getPublicProfilesByUserIds(userIds: string[]): Promise<PublicProfile[]> {
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return [];
  const { data, error } = await supabase
    .from('profiles_public')
    .select(COLUMNS)
    .in('user_id', uniqueIds);
  if (error) {
    console.error('[publicProfileRepository] getPublicProfilesByUserIds failed', {
      message: error.message,
      code: error.code,
      requestedCount: uniqueIds.length,
    });
    return [];
  }
  return (data || []) as unknown as PublicProfile[];
}

export async function getPublicProfileByUserId(userId: string): Promise<PublicProfile | null> {
  if (!userId) return null;
  const { data, error } = await supabase
    .from('profiles_public')
    .select(COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    console.error('[publicProfileRepository] getPublicProfileByUserId failed', {
      message: error.message,
      code: error.code,
    });
    return null;
  }
  return data as unknown as PublicProfile | null;
}

export async function getPublicProfiles(): Promise<PublicProfile[]> {
  const { data, error } = await supabase
    .from('profiles_public')
    .select(COLUMNS)
    .order('full_name');
  if (error) {
    console.error('[publicProfileRepository] getPublicProfiles failed', {
      message: error.message,
      code: error.code,
    });
    return [];
  }
  return (data || []) as unknown as PublicProfile[];
}

export function resolveDisplayName(profile: { full_name: string | null; username: string | null } | null | undefined): string {
  const name = profile?.full_name?.trim() || profile?.username?.trim();
  return name || 'کاربر';
}
