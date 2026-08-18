import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";
import { postJsonCorsBaseHeaders as baseCorsHeaders, createServiceRoleClient as adminClient, getPhoneAuthAllowedOrigins as getAllowedOrigins, createJsonResponseHeaders } from "../_shared/runtimeHttp.ts";

const responseHeaders = createJsonResponseHeaders(baseCorsHeaders);

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function statusForError(code: string | undefined): number {
  switch (code) {
    case "INVALID_PARAMS":
    case "CHANGE_REASON_REQUIRED":
    case "CHANGE_REASON_TOO_LONG":
      return 400;
    case "NOT_ADMIN":
    case "PRIVILEGED_TARGET_REQUIRES_SECURITY_ADMIN":
      return 403;
    case "USER_NOT_FOUND":
      return 404;
    case "SELF_RETIRE_FORBIDDEN":
    case "LAST_ADMIN_FORBIDDEN":
    case "LAST_SECURITY_ADMIN_FORBIDDEN":
      return 409;
    default:
      return 500;
  }
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
  const reasonValue = body && typeof body === "object"
    ? (body as { reason?: unknown }).reason
    : null;
  const reason = typeof reasonValue === "string"
    ? reasonValue.trim()
    : "حذف دائمی حساب توسط مدیر با حفظ سوابق سازمانی";

  if (!isUuid(targetUserId)) {
    return json({ ok: false, error: "INVALID_USER_ID" }, 400);
  }
  if (targetUserId === callerUserId) {
    return json({ ok: false, error: "SELF_RETIRE_FORBIDDEN" }, 409);
  }
  if (reason.length < 10 || reason.length > 500) {
    return json({ ok: false, error: "CHANGE_REASON_REQUIRED" }, 400);
  }

  const { data: targetProfile, error: targetProfileError } = await supabase
    .from("profiles")
    .select("user_id, full_name, email, is_admin, is_security_admin, account_status, retirement_auth_completed_at")
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

  const { data: prepareData, error: prepareError } = await supabase.rpc(
    "admin_prepare_user_retirement_service",
    {
      p_target_user_id: targetUserId,
      p_actor_user_id: callerUserId,
      p_reason: reason,
    },
  );

  if (prepareError) {
    console.error("admin-retire-user prepare failed", {
      code: prepareError.code,
      message: prepareError.message,
    });
    return json({ ok: false, error: "RETIRE_PREPARE_FAILED" }, 500);
  }
  if (!prepareData || prepareData.ok !== true) {
    const code = typeof prepareData?.error === "string" ? prepareData.error : "RETIRE_PREPARE_FAILED";
    return json({ ok: false, error: code }, statusForError(code));
  }

  // Official Supabase Auth soft-delete obfuscates email/phone identities,
  // removes password/MFA/sessions and keeps auth.users.id as a historical tombstone.
  const { error: authDeleteError } = await supabase.auth.admin.deleteUser(targetUserId, true);
  if (authDeleteError) {
    console.error("admin-retire-user auth soft delete failed", {
      message: authDeleteError.message,
    });
    try {
      await supabase.from("security_audit_events").insert({
        user_id: callerUserId,
        actor_user_id: callerUserId,
        target_user_id: targetUserId,
        event_type: "admin_user_retirement_auth_pending",
        event_category: "access",
        severity: "error",
        result: "error",
        metadata: { operation: "retire_user" },
      });
    } catch { /* best-effort */ }
    return json({
      ok: false,
      error: "AUTH_RETIRE_PENDING",
      retryable: true,
    }, 502);
  }

  const { data: finalizeData, error: finalizeError } = await supabase.rpc(
    "admin_finalize_user_retirement_service",
    {
      p_target_user_id: targetUserId,
      p_actor_user_id: callerUserId,
      p_reason: reason,
    },
  );

  if (finalizeError) {
    console.error("admin-retire-user finalize failed", {
      code: finalizeError.code,
      message: finalizeError.message,
    });
    return json({
      ok: false,
      error: "RETIRE_FINALIZE_PENDING",
      retryable: true,
    }, 500);
  }
  if (!finalizeData || finalizeData.ok !== true) {
    const code = typeof finalizeData?.error === "string" ? finalizeData.error : "RETIRE_FINALIZE_PENDING";
    return json({ ok: false, error: code, retryable: true }, statusForError(code));
  }

  return json({
    ok: true,
    retired_user_id: targetUserId,
    identifiers_released: true,
    history_preserved: true,
  });
});
