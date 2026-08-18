export const DEFAULT_OTP_LENGTH = 6;

const PERSIAN_ZERO = '۰'.charCodeAt(0);
const ARABIC_ZERO = '٠'.charCodeAt(0);

function normalizeDigit(character: string): string {
  const code = character.charCodeAt(0);
  if (code >= PERSIAN_ZERO && code <= PERSIAN_ZERO + 9) {
    return String(code - PERSIAN_ZERO);
  }
  if (code >= ARABIC_ZERO && code <= ARABIC_ZERO + 9) {
    return String(code - ARABIC_ZERO);
  }
  return character;
}

export function normalizeOtpDigits(value: string): string {
  return Array.from(value, normalizeDigit).join('').replace(/\D/g, '');
}

export function normalizeOtpCode(value: string, length = DEFAULT_OTP_LENGTH): string {
  return normalizeOtpDigits(value).slice(0, Math.max(1, length));
}

export function applyOtpFragment(
  currentValue: string,
  startIndex: number,
  fragment: string,
  length = DEFAULT_OTP_LENGTH,
): string {
  const current = normalizeOtpCode(currentValue, length);
  const incoming = normalizeOtpDigits(fragment);
  if (!incoming) return current;
  if (incoming.length >= length) return incoming.slice(0, length);

  const start = Math.max(0, Math.min(startIndex, current.length));
  return `${current.slice(0, start)}${incoming}${current.slice(start + incoming.length)}`.slice(0, length);
}

export function removeOtpDigit(
  currentValue: string,
  index: number,
  length = DEFAULT_OTP_LENGTH,
): string {
  const current = normalizeOtpCode(currentValue, length);
  if (index < 0 || index >= current.length) return current;
  return `${current.slice(0, index)}${current.slice(index + 1)}`;
}
