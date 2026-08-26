const PHONE_RE = /^(\+?98|0098|0)?9[0-9]{9}$/;

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;
  return "";
}

export function isValidPhone(raw: string): boolean {
  return PHONE_RE.test(raw.replace(/\s/g, ""));
}
