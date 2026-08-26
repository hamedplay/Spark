import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
});

async function forwardToUnified(req: Request, payload: unknown): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
  };
  const forwardedFor = req.headers.get("x-forwarded-for");
  const userAgent = req.headers.get("user-agent");
  if (forwardedFor) headers["x-forwarded-for"] = forwardedFor;
  if (userAgent) headers["user-agent"] = userAgent;

  // The unified request path may spend up to 10s on the SMS provider and then
  // deliberately pads response timing to reduce account-enumeration signals.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")!}/functions/v1/unified-recovery`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({ ok: false, error: "RECOVERY_UPSTREAM_FAILED" }));
    return json(data, response.status);
  } catch {
    return json({ ok: false, error: "RECOVERY_UNAVAILABLE" }, 503);
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  try {
    const body = await req.json() as { phone?: string };
    if (!body.phone || String(body.phone).trim().length > 64) {
      return json({ ok: false, error: "INVALID_PARAMS" }, 400);
    }
    return await forwardToUnified(req, {
      mode: "request",
      identifier_type: "phone",
      identifier_value: String(body.phone).trim(),
    });
  } catch {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  }
});
