/**
 * Shared Iranian phone number normalizer.
 * Converts all valid Iranian mobile formats to the canonical `989XXXXXXXXX` form.
 * Returns empty string for invalid/unrecognized numbers.
 *
 * Accepted inputs:
 *   +989121234567  →  989121234567
 *   00989121234567 →  989121234567
 *   09121234567    →  989121234567
 *   9121234567     →  989121234567
 */
export function normalizeIranPhone(value?: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');

  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;

  return '';
}
