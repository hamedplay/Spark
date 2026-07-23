import { supabase } from '../../../lib/supabase';
import type { ContactEmail } from '../../../types';

export interface MeetingContactInput {
  userId: string;
  name: string;
  email: string;
  phone: string;
}

export async function fetchMeetingContacts(
  userId: string
): Promise<ContactEmail[]> {
  const { data, error } = await supabase
    .from('contacts_email')
    .select('*')
    .eq('user_id', userId)
    .order('name');
  if (error) throw error;
  return data ?? [];
}

export async function createExternalMeetingContact(
  input: MeetingContactInput
): Promise<ContactEmail> {
  const { data, error } = await supabase
    .from('contacts_email')
    .insert([{
      name: input.name,
      email: input.email,
      phone: input.phone,
      user_id: input.userId,
    }])
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function saveRepresentativeMeetingContact(
  input: MeetingContactInput
): Promise<void> {
  const { error } = await supabase
    .from('contacts_email')
    .insert([{
      name: input.name,
      phone: input.phone,
      email: input.email,
      user_id: input.userId,
    }]);
  if (error) throw error;
}
