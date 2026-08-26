import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { createServiceRoleClient as adminClient, createJsonResponseHeaders } from "../_shared/runtimeHttp.ts";
import { decodeJwtClaims as tokenClaims } from "../_shared/securityPrimitives.ts";

const baseCorsHeaders = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const responseHeaders = createJsonResponseHeaders(baseCorsHeaders);

function allowedOrigin(req: Request): string | null {
  const origin = req.headers.get("Origin");
  if (!origin) return null;
  const allowed = (Deno.env.get("PHONE_LOGIN_ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return allowed.includes(origin) ? origin : null;
}

const json = (body: unknown, status = 200, origin: string | null = null) =>
  new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });

interface HealthPrincipal { userId: string; sessionId: string }

async function authenticate(req: Request): Promise<HealthPrincipal | null> {
  const header = req.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7);
  const claims = tokenClaims(token);
  if (!claims?.session_id || claims.aal !== "aal2") return null;
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return null;
  const admin = adminClient();
  const { data: profile } = await admin.from("profiles").select("is_security_admin, account_status").eq("user_id", data.user.id).maybeSingle();
  if (profile?.account_status !== "ACTIVE") return null;
  if (profile.is_security_admin !== true) return null;
  const { data: hasStepUp, error: stepUpError } = await admin.rpc("has_recent_totp_stepup_grant", {
    p_user_id: data.user.id,
    p_session_id: claims.session_id,
  });
  if (stepUpError || hasStepUp !== true) return null;
  return { userId: data.user.id, sessionId: claims.session_id };
}

Deno.serve(async (req: Request) => {
  const requestOrigin = req.headers.get("Origin");
  const origin = allowedOrigin(req);
  if (requestOrigin && !origin) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (req.method !== "GET" && req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405, origin);

  const principal = await authenticate(req);
  if (!principal) return json({ ok: false, error: "MFA_STEP_UP_REQUIRED" }, 403, origin);

  try {
    const admin = adminClient();

    // ── Health check ─────────────────────────────────────────────────────
    const { data: health, error: healthError } = await admin.rpc("get_auth_health_check");
    if (healthError || !health) return json({ ok: false, error: "HEALTH_CHECK_FAILED" }, 500, origin);

    const { data: identityIntegrity, error: identityError } = await admin.rpc("get_auth_identity_integrity_v1");
    if (identityError || !identityIntegrity) {
      return json({ ok: false, error: "IDENTITY_INTEGRITY_CHECK_FAILED" }, 500, origin);
    }

    // ── Edge function readiness (not hardcoded — unknown unless introspectable) ──
    const requiredFunctions = [
      "custom-mfa", "unified-recovery", "session-management",
      "password-login", "send-sms", "send-bale-message",
      "auth-send-sms-hook", "spark-ai",
    ];
    const functionsStatus = requiredFunctions.map((fn) => ({ name: fn, status: "not_verified" as const }));

    // ── SMS readiness: active provider in DB ──────────────────────────────
    const { data: smsConfig } = await admin.from("sms_providers").select("id, is_active, is_default").eq("is_active", true).limit(1).maybeSingle();

    // ── Bale readiness: Edge Secret only ──────────────────────────────────
    const baleSecret = Deno.env.get("BALE_BOT_TOKEN") ?? "";
    const baleReady = baleSecret.length > 0;

    // ── Email readiness: Edge Secret ──────────────────────────────────────
    const emailSecret = Deno.env.get("SMTP_HOST") ?? "";
    const emailReady = emailSecret.length > 0;

    // ── Settings ──────────────────────────────────────────────────────────
    const { data: settings } = await admin.from("auth_security_settings").select("unified_recovery_enabled, progressive_lock_enabled, session_management_enabled, custom_mfa_enabled, recovery_enabled").eq("id", 1).maybeSingle();

    const { error: auditError } = await admin.from("security_audit_events").insert({
      user_id: principal.userId,
      actor_user_id: principal.userId,
      event_type: "auth_health_check_executed",
      event_category: "security_admin",
      severity: "info",
      result: "success",
      session_id: principal.sessionId,
      metadata: { identity_integrity_ok: Boolean(identityIntegrity.ok), database_ok: Boolean(health.ok) },
    });

    if (auditError) {
      return json({ ok: false, error: "AUDIT_WRITE_FAILED" }, 500, origin);
    }

    return json({
      ok: Boolean(health.ok) && Boolean(identityIntegrity.ok),
      timestamp: new Date().toISOString(),
      database: health,
      identity_integrity: identityIntegrity,
      edge_functions: functionsStatus,
      transport: {
        sms: smsConfig ? "ready" : "not_ready",
        bale: baleReady ? "ready" : "not_ready",
        email: emailReady ? "ready" : "not_ready",
      },
      settings: settings ?? {},
      deprecated_routes: health.deprecated_routes ?? [],
    }, 200, origin);
  } catch {
    return json({ ok: false, error: "HEALTH_CHECK_FAILED" }, 500, origin);
  }
});
