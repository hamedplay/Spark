// PWA install/update bootstrap kept as an external same-origin script so CSP
// can enforce script-src 'self' without unsafe-inline.
window.deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  window.deferredInstallPrompt = event;
  window.dispatchEvent(new Event('pwa-installable'));
});
window.addEventListener('appinstalled', () => {
  window.deferredInstallPrompt = null;
  window.dispatchEvent(new Event('pwa-installed'));
});

function isInstalledPwa() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
}

function armInstalledPwaNotificationPermission() {
  if (!isInstalledPwa()) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;

  let requesting = false;
  const requestOnce = async () => {
    if (requesting || Notification.permission !== 'default') return;
    requesting = true;
    try {
      await Notification.requestPermission();
    } catch {
      // Browsers can reject permission requests depending on platform policy.
    } finally {
      window.removeEventListener('pointerup', requestOnce, true);
      window.removeEventListener('keydown', requestOnce, true);
    }
  };

  // Permission prompts must be triggered by a real user gesture. Restrict this
  // to the installed PWA so ordinary browser users are not prompted unexpectedly.
  window.addEventListener('pointerup', requestOnce, { capture: true, once: true });
  window.addEventListener('keydown', requestOnce, { capture: true, once: true });
}

if (
  'serviceWorker' in navigator &&
  !window.location.hostname.includes('stackblitz') &&
  !window.location.hostname.includes('webcontainer') &&
  !window.location.hostname.includes('localhost') &&
  !window.location.hostname.includes('127.0.0.1') &&
  window.location.hostname !== ''
) {
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/pwa-sw.js', { scope: '/' });
      console.log('SW registered:', registration.scope);
      armInstalledPwaNotificationPermission();
      registration.addEventListener('updatefound', () => {
        const newWorker = registration.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new Event('sw-updated'));
          }
        });
      });
    } catch (error) {
      if (!window.location.hostname.includes('localhost')) {
        console.error('SW registration failed:', error);
      }
    }
  });
}
