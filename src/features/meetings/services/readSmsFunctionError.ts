function payloadMessage(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const payload = value as Record<string, unknown>;
  const detail = [payload.error, payload.message, payload.errorCode]
    .find(item => typeof item === 'string' && item.trim());
  return typeof detail === 'string' ? detail.slice(0, 500) : undefined;
}

/** Read the response without consuming the original error response body. */
export async function readSmsFunctionError(error: unknown): Promise<string> {
  const fallback = error instanceof Error ? error.message : 'ارسال پیامک ناموفق بود';
  const context = error && typeof error === 'object'
    ? (error as { context?: unknown }).context : undefined;
  if (!(context instanceof Response)) return fallback;
  try {
    const detail = payloadMessage(await context.clone().json());
    if (detail) return detail;
  } catch {
    // Empty or non-JSON response: retain a useful HTTP status, not raw HTML.
  }
  return `${fallback} (HTTP ${context.status})`;
}
