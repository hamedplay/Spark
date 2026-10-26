import { useEffect, useRef, useState } from 'react';
import { watchLiveData } from './liveDataBus';
export { LIVE_DATA } from './liveDataScopes';

// Returns a ref so existing data loaders can refresh quietly, without resetting
// loading screens, filters, pagination, editor drafts or the calendar viewport.
export function useLiveData(tables: readonly string[], refresh: () => Promise<unknown>, enabled = true) {
  const latest = useRef(refresh); latest.current = refresh;
  const quiet = useRef(false);
  const key = [...tables].sort().join(',');
  useEffect(() => {
    if (!enabled || !key) return;
    return watchLiveData(key.split(','), async () => {
      quiet.current = true;
      try { await latest.current(); } finally { quiet.current = false; }
    });
  }, [key, enabled]);
  return quiet;
}


export function useLiveRevision(tables: readonly string[], enabled = true) {
  const [revision, setRevision] = useState(0);
  useLiveData(tables, async () => { setRevision(value => value + 1); }, enabled);
  return revision;
}
