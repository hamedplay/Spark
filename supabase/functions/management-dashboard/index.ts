import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.111.0";
import { deniedResponse, requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), { status: 405, headers: corsHeaders });
  }

  const auth = await requireFullAuthAccess(req);
  if (!auth.ok || !auth.userId) return deniedResponse();

  const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await service.rpc("get_management_dashboard_for_user_v1", {
    p_user_id: auth.userId,
  });

  if (error) {
    const forbidden = error.message?.includes("MANAGEMENT_DASHBOARD_FORBIDDEN");
    return new Response(JSON.stringify({ error: forbidden ? "MANAGEMENT_DASHBOARD_FORBIDDEN" : "MANAGEMENT_DASHBOARD_FAILED" }), {
      status: forbidden ? 403 : 500,
      headers: corsHeaders,
    });
  }

  return new Response(JSON.stringify({ ok: true, data }), { status: 200, headers: corsHeaders });
});
