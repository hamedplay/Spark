/** Only these ingress-generated fields cross internal HTTP hops; never copy auth/cookies/body. */
export function connectionHeaders(req: Request): Record<string, string> {
  const headers: Record<string, string> = { 'user-agent': (req.headers.get('user-agent') ?? '').slice(0, 512) };
  if (req.headers.get('x-spark-client-ip-source') === 'nginx-v2') {
    const ip = req.headers.get('x-spark-client-ip')?.trim();
    if (ip && ip.length <= 64 && !/[\s/%,]/.test(ip)) {
      headers['x-spark-client-ip'] = ip;
      headers['x-spark-client-ip-source'] = 'nginx-v2';
    }
  }
  return headers;
}
export async function recordLoginConnection(
  client: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> },
  req: Request, sessionId: string, userId: string,
): Promise<void> {
  try {
    const { error } = await client.rpc('record_session_connection_service_v1', {
      p_session_id: sessionId, p_user_id: userId, p_headers: connectionHeaders(req),
    });
    if (error) console.error('[session-context] persistence failed');
  } catch { console.error('[session-context] persistence failed'); }
}
