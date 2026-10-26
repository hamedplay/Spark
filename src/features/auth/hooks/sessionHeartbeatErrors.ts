/** Preserve structured 401/403 errors so a rejected session stops heartbeating. */
export async function readSessionHeartbeatError(
  data: { error?: unknown } | null | undefined,
  error: { context?: unknown } | null | undefined,
): Promise<string | null> {
  if (typeof data?.error === 'string') return data.error;
  if (error?.context instanceof Response) {
    try {
      const body = await error.context.clone().json() as { error?: unknown };
      return typeof body.error === 'string' ? body.error : null;
    } catch { return null; }
  }
  return null;
}

export function sessionHeartbeatRetrySeconds(attempt: number): number {
  return Math.min(300, 60 * 2 ** Math.min(attempt, 3));
}
