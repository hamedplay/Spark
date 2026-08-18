import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";
import { postJsonCorsBaseHeaders as baseCorsHeaders, createServiceRoleClient as adminClient, getPhoneAuthAllowedOrigins as getAllowedOrigins, createJsonResponseHeaders } from "../_shared/runtimeHttp.ts";
import { decodeJwtClaims as tokenClaims, isUuid } from "../_shared/securityPrimitives.ts";

const responseHeaders = createJsonResponseHeaders(baseCorsHeaders);

Deno.serve(async (req: Request) => {
  const allowedOrigins = await getAllowedOrigins();
  const requestOrigin = req.headers.get("Origin");
  const origin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: responseHeaders(origin) });

  if (allowedOrigins.length === 0) {
    return json({ ok: false, error: "RUNTIME_CONFIG_UNAVAILABLE" }, 503);
  }
  if (requestOrigin && !origin) {
    return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  }
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(origin) });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);
  }

  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok || !authResult.userId) {
    return json({ ok: false, error: "AUTH_ACCESS_RESTRICTED" }, 403);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const claims = tokenClaims(token);
  if (!claims?.session_id || !isUuid(claims.session_id)) {
    return json({ ok: false, error: "AUTH_ACCESS_RESTRICTED" }, 403);
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return json({ ok: false, error: "INVALID_REQUEST" }, 400);
  }

  const targetUserId = (body as { user_id?: unknown }).user_id;
  const rawAction = (body as { action?: unknown }).action;
  const rawReason = (body as { reason?: unknown }).reason;
  const action = typeof rawAction === "string" ? rawAction.trim().toUpperCase() : "";
  const reason = typeof rawReason === "string" ? rawReason.trim() : "";

  if (!isUuid(targetUserId)) {
    return json({ ok: false, error: "INVALID_USER_ID" }, 400);
  }
  if (targetUserId === authResult.userId) {
    return json({ ok: false, error: "SELF_CHANGE_FORBIDDEN" }, 409);
  }
  if (!['SUSPEND', 'REACTIVATE'].includes(action)) {
    return json({ ok: false, error: "INVALID_ACTION" }, 400);
  }
  if (reason.length < 10 || reason.length > 500) {
    return json({ ok: false, error: "CHANGE_REASON_REQUIRED" }, 400);
  }

  const supabase = adminClient();
  const { data: targetProfile, error: targetError } = await supabase
    .from("profiles")
    .select("account_lifecycle_version")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (targetError) {
    return json({ ok: false, error: "USER_LOOKUP_FAILED" }, 500);
  }
  if (!targetProfile) {
    return json({ ok: false, error: "TARGET_NOT_FOUND" }, 404);
  }

  const expectedVersion = Number(targetProfile.account_lifecycle_version ?? 1);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    return json({ ok: false, error: "INVALID_ACCOUNT_VERSION" }, 500);
  }

  const { data, error } = await supabase.rpc("admin_set_user_lifecycle_service", {
    p_actor_user_id: authResult.userId,
    p_target_user_id: targetUserId,
    p_session_id: claims.session_id,
    p_action: action,
    p_expected_version: expectedVersion,
    p_change_reason: reason,
  });

  if (error) {
    console.error("admin-user-lifecycle rpc failed", {
      code: error.code,
      message: error.message,
    });
    return json({ ok: false, error: "LIFECYCLE_UPDATE_FAILED" }, 500);
  }

  const result = data as Record<string, unknown> | null;
  if (!result?.ok) {
    const code = typeof result?.error === "string" ? result.error : "LIFECYCLE_UPDATE_FAILED";
    const status = [
      "SELF_CHANGE_FORBIDDEN",
      "LAST_ADMIN_FORBIDDEN",
      "LAST_SECURITY_ADMIN_FORBIDDEN",
      "INVALID_TRANSITION",
      "VERSION_CONFLICT",
    ].includes(code) ? 409 : [
      "NOT_ADMIN",
      "PRIVILEGED_TARGET_REQUIRES_SECURITY_ADMIN",
      "SESSION_INVALID",
    ].includes(code) ? 403 : 400;
    return json(result, status);
  }

  return json(result);
});
