import { createContext, useContext } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';
import { supabase } from '../../lib/supabase';

export type ConferenceSupabaseClient = SupabaseClient<Database>;

export const ConferenceClientContext = createContext<ConferenceSupabaseClient | null>(null);

export function useConferenceClient(): ConferenceSupabaseClient {
  return useContext(ConferenceClientContext) ?? supabase;
}
