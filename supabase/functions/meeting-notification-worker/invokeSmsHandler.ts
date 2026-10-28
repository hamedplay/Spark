// Keep SMS dispatch on the Application node. SUPABASE_URL points at the
// Database gateway in split deployments, where no Functions runtime exists.
// This invokes the exact send-sms handler, including authentication, provider
// rules, timing policy and dispatch ledger, without another HTTP hop.
export async function invokeSmsHandler(
  handler: (request: Request) => Promise<Response>,
  serviceKey: string,
  body: Record<string, unknown>,
) {
  if (!serviceKey) throw new Error('SMS_SERVICE_CREDENTIAL_MISSING');
  const response = await handler(new Request('https://internal.invalid/send-sms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceKey}` },
    body: JSON.stringify(body),
  }));
  const data = await response.json();
  return { data, error: response.ok ? null : { status: response.status } };
}
