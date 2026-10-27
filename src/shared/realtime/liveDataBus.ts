import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { createLiveDataBus } from './liveDataCoordinator';

const buses = new WeakMap<SupabaseClient, ReturnType<typeof createLiveDataBus>>();
export function watchLiveData(tables: readonly string[], refresh: () => Promise<unknown>, client: SupabaseClient = supabase) {
  let bus = buses.get(client);
  if (!bus) { bus = createLiveDataBus(client, window, document); buses.set(client, bus); }
  return bus.watchLiveData(tables, refresh);
}
