import { useLiveData } from '../../../shared/realtime/useLiveData';
import type { ConferenceSupabaseClient } from '../conferenceClient';

// Keep the conference's authenticated client boundary. Canonical app clients
// share one bus; a distinct client never borrows another client's credentials.
export function useConferenceLiveData(tables: readonly string[], refresh: () => Promise<unknown>, client: ConferenceSupabaseClient, roomId: string, enabled = true) {
  return useLiveData(tables, refresh, enabled && !!roomId, client, roomId);
}
