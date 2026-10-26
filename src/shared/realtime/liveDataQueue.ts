// Coalesce bursts, retain one trailing invalidation while a request is in flight,
// and never run a stale callback after its view has unmounted.
export function createLiveDataQueue(refresh: () => Promise<unknown>, delay = 100) {
  let disposed = false, running = false, pending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const execute = async () => {
    timer = undefined;
    if (disposed || running) return;
    running = true;
    try {
      while (pending && !disposed) {
        pending = false;
        try { await refresh(); } catch { /* next signal/resume retries */ }
      }
    } finally { running = false; }
  };
  return {
    request() {
      if (disposed) return;
      pending = true;
      if (!running && timer === undefined) timer = setTimeout(() => { void execute(); }, delay);
    },
    dispose() { disposed = true; pending = false; if (timer !== undefined) clearTimeout(timer); },
  };
}
