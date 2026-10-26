import type { AppNotification } from '../types/appNotification';

// Apply incoming changes immediately; a slower count response must not undo
// events received after its request began. Server counts still include >50 rows.
export function createNotificationUnreadTracker() {
  let count = 0, revision = 0, request = 0;
  let rows = new Map<string, boolean>();
  const announced = new Set<string>();
  const delta = (value: number) => { revision++; count = Math.max(0, count + value); return count; };
  return {
    get count() { return count; },
    reset() { count = 0; revision++; request++; rows.clear(); announced.clear(); },
    invalidate() { revision++; },
    snapshot(notifications: AppNotification[]) { revision++; rows = new Map(notifications.map(n => [n.id, Boolean(n.read)])); },
    inserted(n: AppNotification) {
      if (announced.has(n.id)) return count;
      announced.add(n.id); if (announced.size > 256) announced.delete(announced.values().next().value!);
      rows.set(n.id, Boolean(n.read)); return delta(n.read ? 0 : 1);
    },
    updated(n: AppNotification) {
      const read = Boolean(n.read);
      const previous = rows.get(n.id); rows.set(n.id, read);
      return delta(previous === undefined || previous === read ? 0 : read ? -1 : 1);
    },
    deleted(id: string) { const previous = rows.get(id); rows.delete(id); return delta(previous === false ? -1 : 0); },
    markAllRead() { revision++; count = 0; rows.forEach((_read, id) => rows.set(id, true)); return count; },
    beginRequest() { return { revision, request: ++request }; },
    applyResponse(token: { revision: number; request: number }, value: number) {
      if (token.revision !== revision || token.request !== request) return false;
      count = Math.max(0, value); return true;
    },
  };
}
