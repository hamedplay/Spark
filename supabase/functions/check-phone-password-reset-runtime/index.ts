import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin || "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

Deno.serve(async (req: Request) => {
  const allowedStr = Deno.env.get("PHONE_LOGIN_ALLOWED_ORIGINS") || "";
  const allowed = allowedStr.split(",").map(s => s.trim()).filter(Boolean);
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = origin && allowed.includes(origin) ? origin : null;
  const cors = corsHeaders(allowedOrigin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { "Content-Type": "application/json", ...cors } });
  }

  // Fail-closed: if origin is empty or not allowed, reject immediately without touching config
  if (!allowedOrigin) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "ORIGIN_NOT_ALLOWED",
        secret_configured: false,
        origins_configured: false,
      }),
      { status: 403, headers: { "Content-Type": "application/json", ...cors } },
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 1. Verify JWT from Authorization header
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ ok: false, error: "NO_TOKEN" }),
        { status: 401, headers: { "Content-Type": "application/json", ...cors } });
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "INVALID_TOKEN" }),
        { status: 401, headers: { "Content-Type": "application/json", ...cors } });
    }

    // 2. Check profile is active and is_admin=true
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("is_admin, is_active")
      .eq("user_id", userData.user.id)
      .maybeSingle();

    if (profileErr || !profile || !profile.is_active || !profile.is_admin) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_ADMIN" }),
        { status: 403, headers: { "Content-Type": "application/json", ...cors } });
    }

    // 3. Check PHONE_PASSWORD_RESET_SECRET by byte length (not string length)
    const secret = Deno.env.get("PHONE_PASSWORD_RESET_SECRET") || "";
    const secretBytes = new TextEncoder().encode(secret).byteLength;
    const secretConfigured = secretBytes >= 32;

    // 4. Check PHONE_LOGIN_ALLOWED_ORIGINS exists
    const originsConfigured = allowedStr.length > 0 && allowed.length > 0;

    // 5. Compute runtime ready
    const runtimeReady = secretConfigured && originsConfigured;

    // 6. Update config securely with select
    const { data: updatedRows, error: updateError } = await supabase
      .from("system_config")
      .update({ value: runtimeReady ? "true" : "false" })
      .eq("section", "security")
      .eq("key", "phone_password_recovery_secret_operator_confirmed")
      .select("value");

    if (updateError || !updatedRows || updatedRows.length !== 1) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "CONFIG_UPDATE_FAILED",
          secret_configured: false,
          origins_configured: false,
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } },
      );
    }

    // 7. Re-read config to confirm it matches runtimeReady
    const { data: confirmRows } = await supabase
      .from("system_config")
      .select("value")
      .eq("section", "security")
      .eq("key", "phone_password_recovery_secret_operator_confirmed")
      .maybeSingle();

    const confirmedValue = confirmRows?.value === "true";
    if (confirmedValue !== runtimeReady) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "CONFIG_UPDATE_FAILED",
          secret_configured: false,
          origins_configured: false,
        }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } },
      );
    }

    // 8. Return only status — no secret values or full origins
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
