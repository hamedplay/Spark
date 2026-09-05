function normalizePathname(pathname: string): string {
  if (!pathname || pathname === '/') return '/';
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

export function isStandaloneConferencePath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === '/conference' || path.startsWith('/conference/');
}

/**
 * Spark has its main application root, the existing /admin route, and
 * a standalone /conference/:code root that intentionally renders outside
 * the authenticated application shell.
 */
export function isKnownSparkPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === '/'
    || path === '/admin'
    || path.startsWith('/admin/')
    || isStandaloneConferencePath(path);
}
