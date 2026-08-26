import { supabase } from './supabase';

type ErrorPayload = { error?: unknown; code?: unknown; message?: unknown };

export class EdgeFunctionCallError extends Error {
  readonly code: string;

  constructor(code: string, message?: string) {
    super(message || code);
    this.name = 'EdgeFunctionCallError';
    this.code = code;
  }
}

function payloadCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as ErrorPayload;
  for (const value of [candidate.error, candidate.code]) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

async function functionErrorCode(error: unknown): Promise<string> {
  if (!error || typeof error !== 'object') return 'EDGE_FUNCTION_ERROR';
  const candidate = error as { context?: unknown; message?: unknown };
  if (candidate.context instanceof Response) {
    try {
      const payload: unknown = await candidate.context.clone().json();
      const code = payloadCode(payload);
      if (code) return code;
    } catch {
      // The response body is optional; fall back to the SDK message below.
    }
  }
  return typeof candidate.message === 'string' && candidate.message.trim()
    ? candidate.message
    : 'EDGE_FUNCTION_ERROR';
}

export async function invokeEdgeFunctionWithTimeout<T>(
  functionName: string,
  body: Record<string, unknown>,
  // Recovery request paths can legitimately include an external SMS-provider
  // call plus deliberate anti-enumeration timing padding. Keep the shared
  // default above that worst-case path; callers can still pass a tighter value.
  timeoutMs = 25_000,
): Promise<T> {
  const controller = new AbortController();
  let didTimeout = false;
  const timeoutId = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  try {
    const { data, error } = await supabase.functions.invoke<T>(functionName, {
      body,
      signal: controller.signal,
    });
    if (didTimeout) throw new EdgeFunctionCallError('REQUEST_TIMEOUT');
    if (error) throw new EdgeFunctionCallError(await functionErrorCode(error));
    if (data === null || data === undefined) {
      throw new EdgeFunctionCallError('EMPTY_RESPONSE');
    }
    return data;
  } catch (error) {
    if (didTimeout) throw new EdgeFunctionCallError('REQUEST_TIMEOUT');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
