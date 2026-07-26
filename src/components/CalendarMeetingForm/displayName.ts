import { FALLBACK_NAME, LOADING_NAME } from '../../lib/useOrgUsers';

export function isPlaceholderName(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return true;
  if (trimmed === 'همکار گرامی' || trimmed === FALLBACK_NAME || trimmed === LOADING_NAME) return true;
  // UUID or email are not valid display names
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed)) return true;
  if (/^\S+@\S+\.\S+$/.test(trimmed)) return true;
  return false;
}
