export interface JwtClaims {
  session_id?: string;
  aal?: string;
  [key: string]: unknown;
}

export function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const encoded = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!encoded) return null;
    const padded = encoded.padEnd(encoded.length + ((4 - encoded.length % 4) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
