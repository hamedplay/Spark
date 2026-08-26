import { supabase } from '../../../lib/supabase';
import type {
  UserPreferences,
  UserPreferencesRow,
} from '../types/userPreferences';

export async function fetchUserPreferencesRow(
  userId: string
): Promise<UserPreferencesRow | null> {
  const { data } = await supabase
    .from('user_preferences')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  return data as UserPreferencesRow | null;
}

export async function upsertUserPreferences(
  userId: string,
  preferences: UserPreferences,
  updatedAt: string
): Promise<void> {
  await supabase
    .from('user_preferences')
    .upsert(
      {
        user_id: userId,
        ...preferences,
        updated_at: updatedAt,
      },
      {
        onConflict: 'user_id',
      }
    );
}
