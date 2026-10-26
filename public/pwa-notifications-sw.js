// Both Web Push and Realtime enter the same serialized, persistent deduplication
// path. A push arriving after an open-page notification must not alert twice.
let notificationQueue = Promise.resolve();
const seenInMemory = new Set();
async function showSparkNotification(payload) {
  const id = typeof payload.notificationId === 'string' ? payload.notificationId : null;
  const key = new URL(`/__spark_notification_seen__/${encodeURIComponent(id || 'unknown')}`, self.location.origin).href;
  let cache;
  try {
    cache = await caches.open('spark-notification-events-v1');
    if (id && await cache.match(key)) return;
  } catch { /* Private browsing can restrict Cache Storage. */ }
  if (id && seenInMemory.has(id)) return;
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const visible = windows.filter(client => client.visibilityState === 'visible');
  const target = visible.find(client => client.focused) || visible[0];
  let actionUrl = '/';
  try {
    const parsed = new URL(payload.actionUrl || '/', self.location.origin);
    if (parsed.origin === self.location.origin) actionUrl = parsed.href;
  } catch { /* Keep a same-origin default. */ }
  await self.registration.showNotification(payload.title || 'اسپارک', {
    body: payload.body || 'یک اعلان جدید در اسپارک دارید.',
    icon: '/icons/icon-192x192.png', badge: '/icons/icon-192x192.png',
    tag: id ? `spark-notification-${id}` : 'spark-notification',
    silent: Boolean(target),
    data: { actionUrl, notificationId: id },
  });
  if (id) {
    seenInMemory.add(id);
    if (seenInMemory.size > 256) seenInMemory.delete(seenInMemory.values().next().value);
    try {
      if (cache) {
        await cache.put(key, new Response('seen'));
        const keys = await cache.keys();
        await Promise.all(keys.slice(0, Math.max(0, keys.length - 256)).map(old => cache.delete(old)));
      }
    } catch { /* In-memory deduplication still applies. */ }
  }
  // One visible client owns the custom sound. With no visible page, the OS owns it.
  target?.postMessage({ type: 'SPARK_NOTIFICATION_SHOWN', notificationId: id });
}
function enqueueNotification(payload) {
  const task = notificationQueue.catch(() => {}).then(() => showSparkNotification(payload));
  notificationQueue = task;
  return task;
}
self.addEventListener('push', event => {
  let payload = {};
  try { payload = event.data?.json?.() || {}; } catch { /* Use generic text for invalid payloads. */ }
  if (!payload || typeof payload !== 'object') payload = {};
  event.waitUntil(enqueueNotification(payload));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SPARK_REALTIME_NOTIFICATION' && event.data.payload) {
    event.waitUntil(enqueueNotification(event.data.payload));
  }
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  let targetUrl = new URL('/', self.location.origin).href;
  try {
    const parsed = new URL(event.notification?.data?.actionUrl || '/', self.location.origin);
    if (parsed.origin === self.location.origin) targetUrl = parsed.href;
  } catch { /* Keep a same-origin default. */ }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) { try { await client.navigate(targetUrl); } catch { /* Focus the existing app. */ } }
        await client.focus(); return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
