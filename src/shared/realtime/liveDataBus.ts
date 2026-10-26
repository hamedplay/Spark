import { supabase } from '../../lib/supabase';
import { createLiveDataBus } from './liveDataCoordinator';

let bus: ReturnType<typeof createLiveDataBus> | undefined;
export function watchLiveData(tables: readonly string[], refresh: () => Promise<unknown>) {
  bus ??= createLiveDataBus(supabase, window, document);
  return bus.watchLiveData(tables, refresh);
}
