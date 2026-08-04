const SIX_DIGIT_PATTERN = /^[0-9]{6}$/;

/**
 * Validates a TOTP code: must be exactly 6 ASCII digits after trimming.
 * Returns the validated code, or null if invalid.
 * Unicode digits (e.g. Persian) are rejected.
 */
export function validateTotpCode(raw: string): string | null {
  const trimmed = raw.trim();
  if (!SIX_DIGIT_PATTERN.test(trimmed)) return null;
  return trimmed;
}
