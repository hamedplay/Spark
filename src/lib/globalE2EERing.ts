// Module-level singleton so GlobalCallContext and useE2EECall can share
// pending E2EE ring state without React context coupling or circular imports.

export interface GlobalE2EERing {
  from:        string;
  sessionId:   string;
  callerName:  string;
  callerId:    string;
  expiresAt:   number;
  acceptToken: string;
}

let _pending: GlobalE2EERing | null = null;
const _listeners = new Set<(ring: GlobalE2EERing | null) => void>();

export function setPendingE2EERing(ring: GlobalE2EERing | null): void {
  _pending = ring;
  _listeners.forEach(fn => fn(ring));
}

export function getPendingE2EERing(): GlobalE2EERing | null {
  return _pending;
}

export function subscribeE2EERing(fn: (ring: GlobalE2EERing | null) => void): () => void {
  _listeners.add(fn);
  return () => { _listeners.delete(fn); };
}
