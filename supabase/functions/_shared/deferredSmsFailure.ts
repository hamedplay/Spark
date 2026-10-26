/** Preserve the Edge Function's structured error instead of the generic HTTP wrapper. */
export async function deferredSmsFailure(result: any, error: any): Promise<string> {
  let body = result;
  if (error?.context instanceof Response) {
    try { body = await error.context.clone().json(); } catch { /* Network/proxy error without JSON. */ }
  }
  const code = typeof body?.errorCode === 'string' ? body.errorCode : '';
  const message = typeof body?.error === 'string' ? body.error : error?.message || 'DEFERRED_SMS_FAILED';
  return code ? `${code}: ${message}` : message;
}
