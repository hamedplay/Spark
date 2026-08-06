import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import {
  requireFullAuthAccess,
  deniedResponse,
} from "../_shared/requireFullAuthAccess.ts";

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

  // ── Centralized auth gate ──────────────────────────────────────────────────
  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return deniedResponse();

  const callerUserId = authResult.userId!;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Check profile is active and is_admin=true
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("is_admin, is_active")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (profileErr || !profile || !profile.is_active || !profile.is_admin) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_ADMIN" }),
        { status: 403, headers: { "Content-Type": "application/json", ...cors } });
    }

    // Check PHONE_PASSWORD_RESET_SECRET by byte length (not string length)
    const secret = Deno.env.get("PHONE_PASSWORD_RESET_SECRET") || "";
    const secretBytes = new TextEncoder().encode(secret).byteLength;
    const secretConfigured = secretBytes >= 32;

    // Check PHONE_LOGIN_ALLOWED_ORIGINS exists
    const originsConfigured = allowedStr.length > 0 && allowed.length > 0;

    // Compute runtime ready
    const runtimeReady = secretConfigured && originsConfigured;

    // Update config securely with select
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

    // Re-read config to confirm it matches runtimeReady
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

    // Return only status — no secret values or full origins
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
