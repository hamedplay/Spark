import type { SupabaseClient } from '@supabase/supabase-js';
import { LIVE_DATA, LIVE_DATA_TABLES } from './liveDataScopes';
import { createLiveDataQueue } from './liveDataQueue';

interface Reader { tables: ReadonlySet<string>; request: () => void }
export function createLiveDataBus(supabase: SupabaseClient, window: Window, document: Document) {
  const readers = new Set<Reader>();
  let stop: (() => void) | undefined;
  const allowedTables = new Set<string>(LIVE_DATA_TABLES);
  function start() {
    let disposed = false;
    let subscribing = false;
    let subscribed = false;
    const reconcile = () => {
      if (!subscribed && !subscribing) connect();
      if (document.visibilityState === 'visible') readers.forEach(reader => reader.request());
    };
    const channel = supabase.channel('app-data-changes', { config: { private: true } })
      .on('broadcast', { event: 'data_changed' }, ({ payload }) => {
        if (disposed || document.visibilityState !== 'visible' || typeof payload?.table !== 'string' || !allowedTables.has(payload.table)) return;
        readers.forEach(reader => { if (reader.tables.has(payload.table) || (LIVE_DATA.people as readonly string[]).includes(payload.table)) reader.request(); });
      });
    let interval = window.setInterval(reconcile, 60_000);
    const schedule = (ms: number) => { window.clearInterval(interval); interval = window.setInterval(reconcile, ms); };
    const connect = () => {
      subscribing = true;
      void supabase.realtime.setAuth().then(() => {
        if (disposed) return;
        subscribed = true; // Once subscribed, the SDK owns socket rejoining.
        channel.subscribe(status => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') { schedule(60_000); reconcile(); }
          else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) schedule(15_000);
        });
      }).catch(() => { if (!disposed) schedule(15_000); }).finally(() => { subscribing = false; });
    };
    connect();
    window.addEventListener('focus', reconcile);
    window.addEventListener('online', reconcile);
    document.addEventListener('visibilitychange', reconcile);
    stop = () => {
      disposed = true; window.clearInterval(interval);
      window.removeEventListener('focus', reconcile);
      window.removeEventListener('online', reconcile);
      document.removeEventListener('visibilitychange', reconcile);
      void supabase.removeChannel(channel);
    };
  }
  function watchLiveData(tables: readonly string[], refresh: () => Promise<unknown>) {
    const queue = createLiveDataQueue(refresh);
    const reader: Reader = { tables: new Set(tables), request: queue.request };
    readers.add(reader);
    if (!stop) start();
    queue.request();
    return () => {
      queue.dispose(); readers.delete(reader);
      if (readers.size === 0) { stop?.(); stop = undefined; }
    };
  }

  return { watchLiveData };
}
