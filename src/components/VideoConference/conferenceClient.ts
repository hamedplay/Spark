import { createContext, useContext } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/supabase';

export type ConferenceSupabaseClient = SupabaseClient<Database>;

export const ConferenceClientContext = createContext<ConferenceSupabaseClient | null>(null);

export function useConferenceClient(): ConferenceSupabaseClient {
  const client = useContext(ConferenceClientContext);
  if (!client) {
    throw new Error('useConferenceClient must be used within a ConferenceClientContext.Provider');
  }
  return client;
}
