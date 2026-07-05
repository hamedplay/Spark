const STATIC_CACHE = 'spark-static-v7';
const RUNTIME_CACHE = 'spark-runtime-v7';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/logo_spark.png',
  '/photo-1600880292203-757bb62b4baf.jpg',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/fonts/Vazirmatn-Regular.woff2',
  '/fonts/Vazirmatn-Bold.woff2',
];

/**
 * Base same-origin cacheable response check
 */
function isBasicOkResponse(response) {
  return response && response.ok && response.type === 'basic';
}

/**
 * Image validation.
 * Prevents caching index.html or any HTML fallback as image.
 */
function isImageResponse(response) {
  if (!isBasicOkResponse(response)) return false;

  const contentType = response.headers.get('content-type') || '';
  return contentType.toLowerCase().startsWith('image/');
}

/**
 * Manifest validation.
 */
function isManifestResponse(response) {
  if (!isBasicOkResponse(response)) return false;

  const contentType = response.headers.get('content-type') || '';
  const normalized = contentType.toLowerCase();

  return (
    normalized.includes('application/manifest+json') ||
    normalized.includes('application/json') ||
    normalized.includes('text/json')
  );
}

/**
 * Font validation.
 */
function isFontResponse(response) {
  if (!isBasicOkResponse(response)) return false;

  const contentType = response.headers.get('content-type') || '';
  const normalized = contentType.toLowerCase();

  return (
    normalized.includes('font/') ||
    normalized.includes('application/font') ||
    normalized.includes('application/x-font') ||
    normalized.includes('application/octet-stream')
  );
}

/**
 * CSS / JS / Vite assets validation.
 * For /assets/* we allow normal basic OK responses,
 * but explicitly reject HTML to prevent SPA fallback poisoning.
 */
function isBundledAssetResponse(response) {
  if (!isBasicOkResponse(response)) return false;

  const contentType = response.headers.get('content-type') || '';
  const normalized = contentType.toLowerCase();

  if (normalized.includes('text/html')) return false;

  return true;
}

/**
 * Generic static validation based on URL path.
 */
function isValidStaticResponse(url, response) {
  const pathname = url.pathname;

  if (pathname.startsWith('/icons/')) {
    return isImageResponse(response);
  }

  if (
    pathname === '/logo_spark.png' ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.jpg') ||
    pathname.endsWith('.jpeg') ||
    pathname.endsWith('.webp') ||
    pathname.endsWith('.svg')
  ) {
    return isImageResponse(response);
  }

  if (pathname === '/manifest.json') {
    return isManifestResponse(response);
  }

  if (
    pathname.startsWith('/fonts/') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.woff') ||
    pathname.endsWith('.ttf') ||
    pathname.endsWith('.otf')
  ) {
    return isFontResponse(response);
  }

  if (pathname.startsWith('/assets/')) {
    return isBundledAssetResponse(response);
  }

  return isBasicOkResponse(response);
}

/**
 * Precache one asset safely.
 */
async function precacheAsset(cache, assetUrl) {
  try {
    const request = new Request(assetUrl, {
      cache: 'reload',
      credentials: 'same-origin',
    });

    const response = await fetch(request);
    const url = new URL(assetUrl, self.location.origin);

    if (!isValidStaticResponse(url, response)) {
      console.warn('[SW] precache skipped - invalid response:', {
        url: assetUrl,
        status: response.status,
        type: response.type,
        contentType: response.headers.get('content-type'),
      });

      return;
    }

    await cache.put(assetUrl, response);
    console.info('[SW] precached:', assetUrl);
  } catch (err) {
    console.warn('[SW] precache failed:', assetUrl, err);
  }
}

/**
 * Install
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        Promise.all(
          STATIC_ASSETS.map((assetUrl) => precacheAsset(cache, assetUrl))
        )
      )
      .then(() => self.skipWaiting())
  );
});

/**
 * Activate
 */
self.addEventListener('activate', (event) => {
  const validCaches = [STATIC_CACHE, RUNTIME_CACHE];

  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith('spark-') && !validCaches.includes(key)
            )
            .map((key) => {
              console.info('[SW] deleting old cache:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Message handler
 */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/**
 * Fetch handler
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  /**
   * Only handle same-origin requests.
   */
  if (url.origin !== self.location.origin) return;

  /**
   * Do not interfere with auth routes.
   */
  if (url.pathname.startsWith('/auth/')) return;

  /**
   * Never cache the E2EE worker script — it must always be the latest version
   * so that any updates to ping/pong or frame-transform logic take effect immediately.
   */
  if (url.pathname === '/e2ee-worker.js') return;

  /**
   * Navigation requests:
   * network-first, fallback to cached index.html
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (isBasicOkResponse(response)) {
            const copy = response.clone();

            event.waitUntil(
              caches.open(STATIC_CACHE).then((cache) => {
                return cache.put('/index.html', copy);
              })
            );
          }

          return response;
        })
        .catch(async () => {
          const cachedIndex = await caches.match('/index.html');
          return cachedIndex || Response.error();
        })
    );

    return;
  }

  const isIconAsset = url.pathname.startsWith('/icons/');
  const isViteAsset = url.pathname.startsWith('/assets/');
  const isFontAsset = url.pathname.startsWith('/fonts/');
  const isManifest = url.pathname === '/manifest.json';
  const isLogo = url.pathname === '/logo_spark.png';
  const isKnownImage =
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.svg');

  const isStaticAsset =
    isIconAsset ||
    isViteAsset ||
    isFontAsset ||
    isManifest ||
    isLogo ||
    isKnownImage;

  /**
   * Static assets:
   * cache-first + background update
   *
   * Important:
   * If network returns HTML for /icons/icon-192x192.png,
   * it will NOT be cached.
   */
  if (isStaticAsset) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const fetchAndUpdate = fetch(request)
          .then((response) => {
            const isValid = isValidStaticResponse(url, response);

            if (!isValid) {
              console.warn('[SW] static asset not cached - invalid response:', {
                url: request.url,
                status: response.status,
                type: response.type,
                contentType: response.headers.get('content-type'),
              });

              return response;
            }

            const copy = response.clone();

            return caches.open(STATIC_CACHE).then((cache) => {
              cache.put(request, copy);
              return response;
            });
          })
          .catch((err) => {
            console.warn('[SW] static asset fetch failed:', request.url, err);
            return null;
          });

        if (cached) {
          event.waitUntil(fetchAndUpdate);
          return cached;
        }

        return fetchAndUpdate.then((response) => {
          return response || Response.error();
        });
      })
    );

    return;
  }

  /**
   * Other same-origin GET requests:
   * network-first + runtime cache fallback
   *
   * Also rejects HTML fallback poisoning for runtime cache only if needed.
   */
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (isBasicOkResponse(response)) {
          const contentType = response.headers.get('content-type') || '';

          /**
           * Avoid storing accidental HTML fallback for non-navigation requests.
           */
          const isHtml = contentType.toLowerCase().includes('text/html');

          if (!isHtml) {
            const copy = response.clone();

            event.waitUntil(
              caches.open(RUNTIME_CACHE).then((cache) => {
                return cache.put(request, copy);
              })
            );
          }
        }

        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        return cached || Response.error();
      })
  );
});
