import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
    "Cache-Control": "no-store",
  };
  if (allowedOrigin) headers["Access-Control-Allow-Origin"] = allowedOrigin;
  return headers;
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function getAllowedOrigins(): Promise<string[]> {
  const admin = adminClient();
  const { data, error } = await admin.rpc("get_phone_auth_config");
  if (error || !data) return [];

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !Array.isArray(row.allowed_origins)) return [];

  return Array.from(new Set(
    row.allowed_origins
      .filter((origin: unknown): origin is string => typeof origin === "string")
      .map((origin: string) => origin.trim())
      .filter(Boolean),
  ));
}

async function computeUnifiedRecoveryReadiness(admin: ReturnType<typeof adminClient>, allowedOrigins: string[]) {
  const [{ data: settings }, { data: canonicalRow }, { data: providerIdRow }, { data: template }] = await Promise.all([
    admin.from("auth_security_settings")
      .select("recovery_enabled,unified_recovery_enabled,recovery_otp_ttl_seconds,recovery_reset_token_ttl_seconds,recovery_max_attempts")
      .eq("id", 1)
      .maybeSingle(),
    admin.from("system_config")
      .select("value")
      .eq("section", "security")
      .eq("key", "phone_password_recovery_canonical_enabled")
      .maybeSingle(),
    admin.from("system_config")
      .select("value")
      .eq("section", "sms")
      .eq("key", "phone_login_sms_provider_id")
      .maybeSingle(),
    admin.from("notification_templates")
      .select("body,is_active")
      .eq("category", "auth")
      .eq("event_type", "password_reset_otp")
      .eq("audience", "all")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  const providerId = String(providerIdRow?.value || "");
  const { data: provider } = providerId
    ? await admin.from("sms_providers")
      .select("provider_type,api_url,api_key,line_number,is_active")
      .eq("id", providerId)
      .maybeSingle()
    : { data: null };

  const recoveryEnabled = settings?.recovery_enabled === true;
  const unifiedEnabled = settings?.unified_recovery_enabled === true;
  const canonicalEnabled = canonicalRow?.value === "true";
  const originsConfigured = allowedOrigins.length > 0;
  const templateReady = template?.is_active === true && typeof template.body === "string" && template.body.includes("{{otp}}");

  const otpTtl = Number(settings?.recovery_otp_ttl_seconds ?? 0);
  const resetTtl = Number(settings?.recovery_reset_token_ttl_seconds ?? 0);
  const maxAttempts = Number(settings?.recovery_max_attempts ?? 0);
  // create_unified_recovery_challenge rejects expiries beyond one hour.
  const otpTtlValid = Number.isInteger(otpTtl) && otpTtl >= 60 && otpTtl <= 3600;
  const resetTtlValid = Number.isInteger(resetTtl) && resetTtl >= 60 && resetTtl <= 1800;
  const maxAttemptsValid = Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 20;

  const providerType = String(provider?.provider_type || "").toLowerCase();
  const providerUrl = String(provider?.api_url || "").trim();
  const providerIsSmsIr = providerType === "rest" && providerUrl.toLowerCase().includes("sms.ir");
  const providerReady = provider?.is_active === true && Boolean(providerId) && (
    providerIsSmsIr
      ? Boolean(String(provider?.api_key || "").trim()) && Boolean(String(provider?.line_number || "").trim())
      : Boolean(providerUrl)
  );

  const runtimeReady = recoveryEnabled && unifiedEnabled && canonicalEnabled && originsConfigured &&
    templateReady && providerReady && otpTtlValid && resetTtlValid && maxAttemptsValid;

  return {
    runtimeReady,
    recoveryEnabled,
    unifiedEnabled,
    canonicalEnabled,
    originsConfigured,
    templateReady,
    providerReady,
    otpTtlValid,
    resetTtlValid,
    maxAttemptsValid,
  };
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

  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: cors });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { "Content-Type": "application/json", ...cors } });
  }
  if (!allowedOrigin) {
    return new Response(JSON.stringify({ ok: false, error: "ORIGIN_NOT_ALLOWED" }),
      { status: 403, headers: { "Content-Type": "application/json", ...cors } });
  }

  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) {
    return new Response(JSON.stringify({ error: "AUTH_ACCESS_RESTRICTED" }),
      { status: 403, headers: { "Content-Type": "application/json", ...cors } });
  }

  try {
    const admin = adminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("is_admin,account_status")
      .eq("user_id", authResult.userId!)
      .maybeSingle();

    if (profileError || !profile || profile.account_status !== "ACTIVE" || profile.is_admin !== true) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_ADMIN" }),
        { status: 403, headers: { "Content-Type": "application/json", ...cors } });
    }

    const readiness = await computeUnifiedRecoveryReadiness(admin, allowedOrigins);

    const compatibilityRows = [
      { section: "security", key: "unified_recovery_runtime_ready", value: readiness.runtimeReady ? "true" : "false" },
      // Legacy keys are retained only for old admin UI/report compatibility. They no longer
      // represent a dedicated PHONE_PASSWORD_RESET_SECRET and must not drive public readiness.
      { section: "security", key: "phone_password_recovery_secret_configured", value: readiness.runtimeReady ? "true" : "false" },
      { section: "security", key: "phone_password_recovery_secret_operator_confirmed", value: readiness.runtimeReady ? "true" : "false" },
    ];

    const { error: updateError } = await admin.from("system_config")
      .upsert(compatibilityRows, { onConflict: "section,key" });

    if (updateError) {
      return new Response(JSON.stringify({ ok: false, error: "CONFIG_UPDATE_FAILED" }),
        { status: 500, headers: { "Content-Type": "application/json", ...cors } });
    }

    return new Response(JSON.stringify({
      ok: true,
      runtime_confirmed: readiness.runtimeReady,
      recovery_enabled: readiness.recoveryEnabled,
      unified_recovery_enabled: readiness.unifiedEnabled,
      canonical_enabled: readiness.canonicalEnabled,
      origins_configured: readiness.originsConfigured,
      provider_ready: readiness.providerReady,
      template_ready: readiness.templateReady,
      otp_ttl_valid: readiness.otpTtlValid,
      reset_token_ttl_valid: readiness.resetTtlValid,
      max_attempts_valid: readiness.maxAttemptsValid,
    }), { status: 200, headers: { "Content-Type": "application/json", ...cors } });
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "INTERNAL_ERROR" }),
      { status: 500, headers: { "Content-Type": "application/json", ...cors } });
  }
});
