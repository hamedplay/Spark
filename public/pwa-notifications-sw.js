self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json?.() || {};
  } catch {
    try {
      payload = JSON.parse(event.data?.text?.() || '{}');
    } catch {
      payload = {};
    }
  }

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title.trim()
    : 'اسپارک';
  const body = typeof payload.body === 'string' && payload.body.trim()
    ? payload.body.trim()
    : 'یک اعلان جدید در اسپارک دارید.';
  const actionUrl = typeof payload.actionUrl === 'string' && payload.actionUrl
    ? payload.actionUrl
    : '/';
  const notificationId = typeof payload.notificationId === 'string'
    ? payload.notificationId
    : null;

  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-192x192.png',
    tag: notificationId ? `spark-push-${notificationId}` : 'spark-push',
    renotify: Boolean(notificationId),
    data: { actionUrl, notificationId },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const rawTarget = event.notification?.data?.actionUrl || '/';
  let targetUrl;
  try {
    targetUrl = new URL(rawTarget, self.location.origin).href;
  } catch {
    targetUrl = new URL('/', self.location.origin).href;
  }

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) {
        if ('navigate' in client) {
          try { await client.navigate(targetUrl); } catch { /* keep existing client */ }
        }
        await client.focus();
        return;
      }
    }
    if (self.clients.openWindow) await self.clients.openWindow(targetUrl);
  })());
});
