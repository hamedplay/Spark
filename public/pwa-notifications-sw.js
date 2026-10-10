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
