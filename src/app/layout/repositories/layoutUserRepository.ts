import { supabase } from '../../../lib/supabase';
import type {
  LayoutUserProfile,
  LayoutUserStatus,
} from '../types/layoutUser';

export interface UpsertLayoutPresenceInput {
  userId: string;
  status: LayoutUserStatus;
  isOnline: boolean;
  lastSeen: string;
}

export async function fetchSidebarDefaultCollapsed():
  Promise<boolean | null> {
  const { data } = await supabase
    .from('system_config')
    .select('value')
    .eq('section', 'ui')
    .eq('key', 'sidebar_default_collapsed')
    .maybeSingle();

  return data
    ? data.value !== 'false'
    : null;
}

export async function fetchLayoutUserProfile(
  userId: string
): Promise<LayoutUserProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select(
      'full_name, email, avatar_url, position'
    )
    .eq('user_id', userId)
    .maybeSingle();

  return data as LayoutUserProfile | null;
}

export async function fetchLayoutUserPresenceStatus(
  userId: string
): Promise<LayoutUserStatus | null> {
  const { data } = await supabase
    .from('user_presence')
    .select('status')
    .eq('user_id', userId)
    .maybeSingle();

  return (data?.status as LayoutUserStatus) ?? null;
}

export async function upsertLayoutUserPresence(
  input: UpsertLayoutPresenceInput
): Promise<void> {
  await supabase
    .from('user_presence')
    .upsert(
      {
        user_id: input.userId,
        last_seen: input.lastSeen,
        is_online: input.isOnline,
        status: input.status,
      },
      { onConflict: 'user_id' }
    );
}

export async function markLayoutUserOffline(
  userId: string
): Promise<void> {
  await supabase
    .from('user_presence')
    .update({ is_online: false })
    .eq('user_id', userId);
}
