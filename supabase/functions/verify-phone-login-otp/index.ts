import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Vary": "Origin",
};

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const h: Record<string, string> = { ...baseHeaders };
  if (allowedOrigin) h["Access-Control-Allow-Origin"] = allowedOrigin;
  return h;
}

async function getConfig(): Promise<{ origins: string[] }> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await admin.rpc("get_phone_auth_config");
  if (error || !data) throw new Error("CONFIG_UNAVAILABLE");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("CONFIG_UNAVAILABLE");
  const allowedOrigins: string[] = Array.isArray(row?.allowed_origins) ? row.allowed_origins : [];
  return { origins: allowedOrigins };
}

Deno.serve(async (req: Request) => {
  let allowedOrigin: string | null = null;

  try {
    const config = await getConfig();
    const origin = req.headers.get("Origin");
    if (origin && config.origins.includes(origin)) allowedOrigin = origin;
  } catch {
    return new Response(JSON.stringify({ error: "LOGIN_UNAVAILABLE" }), {
      status: 503,
      headers: { ...corsHeaders(null), "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(allowedOrigin) });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "LOGIN_ROUTE_REPLACED" }), {
    status: 410,
    headers: { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" },
  });
});
