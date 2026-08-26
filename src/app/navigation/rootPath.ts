function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

/**
 * Spark currently has one application root plus the existing /admin route.
 * Feature navigation is React state, not URL pathname routing.
 */
export function isKnownSparkPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === '/' || path === '/admin' || path.startsWith('/admin/');
}
