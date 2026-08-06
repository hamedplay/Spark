import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  return headers;
}

async function getAllowedOrigins(): Promise<string[]> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await admin.rpc("get_phone_auth_config");
  if (error || !data) return [];

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !Array.isArray(row.allowed_origins)) return [];

  return Array.from(new Set(
    row.allowed_origins
      .filter((o: unknown): o is string => typeof o === "string")
      .map((o: string) => o.trim())
      .filter(Boolean),
  ));
}

Deno.serve(async (req: Request) => {
  const allowedOrigins = await getAllowedOrigins();
  if (allowedOrigins.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, error: "RUNTIME_CONFIG_UNAVAILABLE" }),
      { status: 503, headers: { "Content-Type": "application/json", "Vary": "Origin", "Cache-Control": "no-store" } },
    );
  }

  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = allowedOrigins.includes(origin) ? origin : null;
  const cors = corsHeaders(allowedOrigin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { "Content-Type": "application/json", ...cors } });
  }

  if (!allowedOrigin) {
    return new Response(
      JSON.stringify({ ok: false, error: "ORIGIN_NOT_ALLOWED" }),
      { status: 403, headers: { "Content-Type": "application/json", ...cors } },
    );
  }

  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) {
    return new Response(
      JSON.stringify({ error: "AUTH_ACCESS_RESTRICTED" }),
      { status: 403, headers: { "Content-Type": "application/json", ...cors } },
    );
  }

  const callerUserId = authResult.userId!;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("is_admin, is_active")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (profileErr || !profile || !profile.is_active || !profile.is_admin) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_ADMIN" }),
        { status: 403, headers: { "Content-Type": "application/json", ...cors } });
    }

    const secret = Deno.env.get("PHONE_PASSWORD_RESET_SECRET") || "";
    const secretConfigured = new TextEncoder().encode(secret).byteLength >= 32;
    const originsConfigured = allowedOrigins.length > 0;
    const runtimeReady = secretConfigured && originsConfigured;

    const { data: updatedRows, error: updateError } = await supabase
      .from("system_config")
      .update({ value: runtimeReady ? "true" : "false" })
      .eq("section", "security")
      .eq("key", "phone_password_recovery_secret_operator_confirmed")
      .select("value");

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      return new Response(
        JSON.stringify({ ok: false, error: "CONFIG_UPDATE_FAILED" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } },
      );
    }

    const { data: confirmRows } = await supabase
      .from("system_config")
      .select("value")
      .eq("section", "security")
      .eq("key", "phone_password_recovery_secret_operator_confirmed")
      .maybeSingle();

    const confirmedValue = confirmRows?.value === "true";
    if (confirmedValue !== runtimeReady) {
      return new Response(
        JSON.stringify({ ok: false, error: "CONFIG_UPDATE_FAILED" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } },
      );
    }

    return new Response(JSON.stringify({
      ok: true,
      secret_configured: secretConfigured,
      origins_configured: originsConfigured,
      runtime_confirmed: runtimeReady,
    }), { status: 200, headers: { "Content-Type": "application/json", ...cors } });

  } catch {
    return new Response(JSON.stringify({ ok: false, error: "INTERNAL_ERROR" }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } });
  }
});
