// Realtime is an invalidation signal. Reconcile on reconnect/resume and use a
// low-frequency safety refresh for dropped events, without refreshing hidden tabs.
export function createChatRealtimeSync(refresh: () => Promise<unknown>, env = {
  window, document,
  setInterval: (fn: () => void, ms: number) => window.setInterval(fn, ms),
  clearInterval: (id: number) => window.clearInterval(id),
}) {
  let disposed = false;
  let pending = false;
  let running: Promise<void> | null = null;
  let interval: number | undefined;
  const request = (): Promise<void> => {
    if (disposed) return Promise.resolve();
    pending = true;
    if (!running) {
      running = (async () => {
        while (pending && !disposed) {
          pending = false;
          try { await refresh(); } catch { /* retain data; retry on next invalidation */ }
        }
      })().finally(() => {
        running = null;
        if (pending && !disposed) void request();
      });
    }
    return running;
  };
  const resume = () => { if (env.document.visibilityState === 'visible') void request(); };
  const schedule = (ms: number) => {
    if (interval !== undefined) env.clearInterval(interval);
    interval = env.setInterval(resume, ms);
  };
  schedule(60_000);
  env.window.addEventListener('online', resume);
  env.window.addEventListener('focus', resume);
  env.document.addEventListener('visibilitychange', resume);
  return {
    request,
    onStatus(status: string) {
      if (disposed) return;
      if (status === 'SUBSCRIBED') { schedule(60_000); void request(); }
      else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(status)) schedule(15_000);
    },
    dispose() {
      disposed = true;
      pending = false;
      if (interval !== undefined) env.clearInterval(interval);
      env.window.removeEventListener('online', resume);
      env.window.removeEventListener('focus', resume);
      env.document.removeEventListener('visibilitychange', resume);
    },
  };
}
