import { createContext, useContext } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase, guestSupabase } from '../../lib/supabase';
import type { Database } from '../../types/supabase';

export type ConferenceSupabaseClient = SupabaseClient<Database>;

export const ConferenceClientContext = createContext<ConferenceSupabaseClient>(supabase);

export function useConferenceClient(): ConferenceSupabaseClient {
  return useContext(ConferenceClientContext);
}

export { supabase as defaultConferenceClient, guestSupabase };
