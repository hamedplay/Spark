import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
};

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const h: Record<string, string> = { ...baseHeaders };
  if (allowedOrigin) {
    h["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  return h;
}

function json(data: unknown, status: number, allowedOrigin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" },
  });
}

async function getAllowedOrigin(req: Request): Promise<string | null> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await admin.rpc("get_phone_auth_config");
  if (error || !data) return null;
  const row = Array.isArray(data) ? data[0] : data;
  const allowedOrigins: string[] = Array.isArray(row?.allowed_origins) ? row.allowed_origins : [];
  const origin = req.headers.get("Origin");
  if (!origin) return null;
  for (const allowed of allowedOrigins) {
    if (origin === allowed) return origin;
  }
  return null;
}

Deno.serve(async (req: Request) => {
  const allowedOrigin = await getAllowedOrigin(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(allowedOrigin) });
  }

  if (req.method === "POST") {
    return json({ error: "LOGIN_ROUTE_REPLACED" }, 410, allowedOrigin);
  }

  return json({ error: "METHOD_NOT_ALLOWED" }, 405, allowedOrigin);
});
