import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";
import { postJsonCorsBaseHeaders as baseCorsHeaders, createServiceRoleClient as adminClient, getPhoneAuthAllowedOrigins as getAllowedOrigins, createJsonResponseHeaders } from "../_shared/runtimeHttp.ts";

const responseHeaders = createJsonResponseHeaders(baseCorsHeaders);

function tokenClaims(token: string): { session_id?: string } | null {
  try {
    const encoded = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!encoded) return null;
    const padded = encoded.padEnd(encoded.length + ((4 - encoded.length % 4) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

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
  const callerUserId = authResult.userId;

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  const claims = tokenClaims(token);
  if (!claims?.session_id) {
    return json({ ok: false, error: "AUTH_ACCESS_RESTRICTED" }, 403);
  }

  const supabase = adminClient();

  const { data: callerProfile, error: callerProfileError } = await supabase
    .from("profiles")
    .select("is_admin, is_security_admin, is_active, account_status")
    .eq("user_id", callerUserId)
    .maybeSingle();

  if (callerProfileError || !callerProfile) {
    return json({ ok: false, error: "AUTH_ACCESS_RESTRICTED" }, 403);
  }
  if (
    callerProfile.is_admin !== true ||
    callerProfile.is_active !== true ||
    callerProfile.account_status !== "ACTIVE"
  ) {
    return json({ ok: false, error: "NOT_ADMIN" }, 403);
  }

  const body = await req.json().catch(() => null);
  const targetUserId = body && typeof body === "object"
    ? (body as { user_id?: unknown }).user_id
    : null;

  if (!isUuid(targetUserId)) {
    return json({ ok: false, error: "INVALID_USER_ID" }, 400);
  }
  if (targetUserId === callerUserId) {
    return json({ ok: false, error: "SELF_DELETE_FORBIDDEN" }, 409);
  }

  const { data: targetProfile, error: targetProfileError } = await supabase
    .from("profiles")
    .select("user_id, full_name, email, is_admin, is_security_admin, is_active, account_status")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (targetProfileError) {
    return json({ ok: false, error: "USER_LOOKUP_FAILED" }, 500);
  }
  if (!targetProfile) {
    return json({ ok: false, error: "USER_NOT_FOUND" }, 404);
  }

  if (
    (targetProfile.is_admin === true || targetProfile.is_security_admin === true) &&
    callerProfile.is_security_admin !== true
  ) {
    return json({ ok: false, error: "PRIVILEGED_TARGET_REQUIRES_SECURITY_ADMIN" }, 403);
  }

  if (targetProfile.is_admin === true && targetProfile.is_active === true && targetProfile.account_status === "ACTIVE") {
    const { count, error } = await supabase
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("is_admin", true)
      .eq("is_active", true)
      .eq("account_status", "ACTIVE");
    if (error) return json({ ok: false, error: "ADMIN_COUNT_FAILED" }, 500);
    if ((count ?? 0) <= 1) {
      return json({ ok: false, error: "LAST_ADMIN_FORBIDDEN" }, 409);
    }
  }

  if (targetProfile.is_security_admin === true && targetProfile.is_active === true && targetProfile.account_status === "ACTIVE") {
    const { count, error } = await supabase
      .from("profiles")
      .select("user_id", { count: "exact", head: true })
      .eq("is_security_admin", true)
      .eq("is_active", true)
      .eq("account_status", "ACTIVE");
    if (error) return json({ ok: false, error: "SECURITY_ADMIN_COUNT_FAILED" }, 500);
    if ((count ?? 0) <= 1) {
      return json({ ok: false, error: "LAST_SECURITY_ADMIN_FORBIDDEN" }, 409);
    }
  }

  const { data: blockerData, error: blockerError } = await supabase.rpc("get_admin_user_delete_blockers", {
    p_user_id: targetUserId,
  });
  if (blockerError || !blockerData || blockerData.ok !== true) {
    return json({ ok: false, error: "DELETE_PREFLIGHT_FAILED" }, 500);
  }
  if (blockerData.blocked === true) {
    return json({
      ok: false,
      error: "USER_HAS_DEPENDENCIES",
      has_storage_objects: Number(blockerData.storage_objects ?? 0) > 0,
      has_protected_records: Number(blockerData.protected_relations ?? 0) > 0,
    }, 409);
  }

  const { error: auditError } = await supabase.from("security_audit_events").insert({
    user_id: callerUserId,
    actor_user_id: callerUserId,
    target_user_id: targetUserId,
    event_type: "admin_user_delete_requested",
    event_category: "access",
    severity: "warning",
    result: "success",
    session_id: claims.session_id,
    metadata: { operation: "hard_delete_user" },
  });
  if (auditError) {
    console.error("admin-delete-user audit write failed", {
      code: auditError.code,
      message: auditError.message,
    });
    return json({ ok: false, error: "AUDIT_WRITE_FAILED" }, 500);
  }

  const { error: deleteError } = await supabase.auth.admin.deleteUser(targetUserId);
  if (deleteError) {
    try {
      await supabase.from("security_audit_events").insert({
        user_id: callerUserId,
        actor_user_id: callerUserId,
        target_user_id: targetUserId,
        event_type: "admin_user_delete_failed",
        event_category: "access",
        severity: "warning",
        result: "failure",
        session_id: claims.session_id,
        metadata: { operation: "hard_delete_user" },
      });
    } catch { /* best-effort */ }

    const message = deleteError.message?.toLowerCase() ?? "";
    if (message.includes("foreign key") || message.includes("storage") || message.includes("owner")) {
      return json({ ok: false, error: "USER_HAS_DEPENDENCIES" }, 409);
    }
    return json({ ok: false, error: "USER_DELETE_FAILED" }, 500);
  }

  try {
    await supabase.rpc("revoke_all_sessions", { p_user_id: targetUserId });
  } catch { /* best-effort */ }

  try {
    await supabase.from("security_audit_events").insert({
      user_id: callerUserId,
      actor_user_id: callerUserId,
      target_user_id: targetUserId,
      event_type: "admin_user_deleted",
      event_category: "access",
      severity: "warning",
      result: "success",
      session_id: claims.session_id,
      metadata: { operation: "hard_delete_user" },
    });
  } catch { /* request audit already exists */ }

  return json({ ok: true, deleted_user_id: targetUserId });
});
