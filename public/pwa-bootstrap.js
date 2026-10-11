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

let pushBanner = null;

function removePushBanner() {
  if (pushBanner?.isConnected) pushBanner.remove();
  pushBanner = null;
}

function showPushBanner(message, actionLabel, action) {
  if (!isInstalledPwa()) return;
  removePushBanner();
  const box = document.createElement('div');
  box.setAttribute('role', 'status');
  box.dir = 'rtl';
  Object.assign(box.style, {
    position: 'fixed',
    left: '12px',
    right: '12px',
    bottom: 'max(12px, env(safe-area-inset-bottom))',
    zIndex: '10000',
    background: '#0f172a',
    color: '#fff',
    borderRadius: '14px',
    padding: '12px 14px',
    boxShadow: '0 12px 30px rgba(0,0,0,.28)',
    fontFamily: 'Vazirmatn, sans-serif',
    fontSize: '14px',
    lineHeight: '1.8',
  });

  const text = document.createElement('div');
  text.textContent = message;
  box.appendChild(text);

  if (actionLabel && action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = actionLabel;
    Object.assign(button.style, {
      marginTop: '10px',
      border: '0',
      borderRadius: '10px',
      padding: '9px 14px',
      font: 'inherit',
      fontWeight: '700',
      cursor: 'pointer',
    });
    button.addEventListener('click', action);
    box.appendChild(button);
  }

  document.body.appendChild(box);
  pushBanner = box;
}

async function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  try {
    const permission = await Notification.requestPermission();
    window.dispatchEvent(new Event('pwa-notification-permission-changed'));
    if (permission === 'denied') {
      showPushBanner('اعلان‌های اسپارک در تنظیمات گوشی/مرورگر مسدود است. دسترسی Notifications را برای این برنامه فعال کنید.');
    }
  } catch {
    showPushBanner('فعال‌سازی اعلان‌های موبایل ناموفق بود.', 'تلاش مجدد', requestNotificationPermission);
  }
}

function armInstalledPwaNotificationPermission() {
  if (!isInstalledPwa() || typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    showPushBanner(
      'برای دریافت اعلان جلسه‌ها و رویدادهای اسپارک هنگام بسته بودن برنامه، اعلان‌های موبایل را فعال کنید.',
      'فعال‌سازی اعلان‌ها',
      requestNotificationPermission,
    );
  } else if (Notification.permission === 'denied') {
    showPushBanner('اعلان‌های اسپارک در تنظیمات گوشی/مرورگر مسدود است. دسترسی Notifications را برای این برنامه فعال کنید.');
  }
}

window.addEventListener('pwa-push-status-changed', (event) => {
  if (!isInstalledPwa()) return;
  const detail = event.detail || {};
  switch (detail.status) {
    case 'ready':
      removePushBanner();
      break;
    case 'permission-required':
      armInstalledPwaNotificationPermission();
      break;
    case 'permission-denied':
      showPushBanner('اعلان‌های اسپارک در تنظیمات گوشی/مرورگر مسدود است. دسترسی Notifications را برای این برنامه فعال کنید.');
      break;
    case 'registering':
      showPushBanner('در حال فعال‌سازی اعلان‌های موبایل اسپارک…');
      break;
    case 'error':
      showPushBanner(
        'ثبت این دستگاه برای دریافت اعلان‌ها کامل نشد. اتصال سرویس Push را دوباره بررسی کنید.',
        'تلاش مجدد',
        () => window.dispatchEvent(new Event('pwa-push-retry')),
      );
      break;
    case 'unsupported':
      showPushBanner('این مرورگر یا نسخه سیستم‌عامل از Web Push موردنیاز اسپارک پشتیبانی نمی‌کند.');
      break;
    default:
      break;
  }
});

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
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        window.dispatchEvent(new Event('pwa-notification-permission-changed'));
      }
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
        showPushBanner('Service Worker اسپارک ثبت نشد؛ اعلان‌های پس‌زمینه در دسترس نیست.');
      }
    }
  });
}
