import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function normalizeIranPhone(value?: string | null): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;
  return "";
}

function maskPhone(phone: string): string {
  if (!phone || phone.length <= 4) return "***";
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Verify JWT
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ ok: false, error: "NO_TOKEN" }, 401);

    const { data: { user }, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !user) return json({ ok: false, error: "INVALID_TOKEN" }, 401);

    // Check admin
    const { data: callerProfile } = await supabase
      .from("profiles").select("is_admin, is_active").eq("user_id", user.id).maybeSingle();
    if (!callerProfile?.is_admin || !callerProfile?.is_active) {
      return json({ ok: false, error: "NOT_ADMIN" }, 403);
    }

    if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

    const body = await req.json();
    const targetUserId: string | undefined = body.user_id;
    const newPhone: string | undefined = body.new_phone;

    if (!targetUserId) return json({ ok: false, error: "USER_ID_REQUIRED" }, 400);
    if (!newPhone) return json({ ok: false, error: "NEW_PHONE_REQUIRED" }, 400);

    // 1. Validate and normalize new phone
    const normalized = normalizeIranPhone(newPhone);
    if (!normalized || !/^989\d{9}$/.test(normalized)) {
      return json({ ok: false, error: "INVALID_PHONE" }, 400);
    }

    // 2. Check uniqueness in profiles
    const { data: profileConflict } = await supabase
      .from("profiles")
      .select("user_id")
      .neq("user_id", targetUserId)
      .filter("phone", "eq", normalized)
      .maybeSingle();
    if (profileConflict) {
      return json({ ok: false, error: "PHONE_USED_BY_OTHER_PROFILE" }, 409);
    }

    // 3. Check uniqueness in auth.users
    const { data: authUsers } = await supabase.auth.admin.listUsers();
    const authConflict = authUsers?.users?.find(
      (u: { id: string; phone?: string }) =>
        u.id !== targetUserId && normalizeIranPhone(u.phone) === normalized,
    );
    if (authConflict) {
      return json({ ok: false, error: "PHONE_USED_BY_OTHER_AUTH_USER" }, 409);
    }

    // 4. Verify target auth user exists
    const { data: targetAuth, error: targetErr } = await supabase.auth.admin.getUserById(targetUserId);
    if (targetErr || !targetAuth?.user) {
      return json({ ok: false, error: "AUTH_USER_NOT_FOUND" }, 404);
    }

    // 5. Update auth.users.phone via Admin API (raw fetch)
    const authBaseUrl = Deno.env.get("SUPABASE_INTERNAL_URL") ?? Deno.env.get("SUPABASE_URL") ?? "http://kong:8000";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const e164 = `+${normalized}`;

    let authSuccess = false;
    let authStatus = 0;
    let authError: string | null = null;

    try {
      const authResp = await fetch(
        `${authBaseUrl}/auth/v1/admin/users/${targetUserId}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "apikey": serviceRoleKey,
            "Authorization": `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({ phone: e164, phone_confirm: true }),
          signal: AbortSignal.timeout(10000),
        },
      );
      authStatus = authResp.status;
      authSuccess = authResp.ok;
      if (!authSuccess) authError = (await authResp.text()).slice(0, 300);
    } catch (fetchErr) {
      authError = fetchErr instanceof Error ? fetchErr.message : "fetch error";
    }

    if (!authSuccess) {
      // Auth failed — do NOT update profile, record repair queue
      try {
        await supabase.from("phone_auth_sync_repairs").insert({
          user_id: targetUserId,
          operation_type: "change_phone",
          masked_phone: maskPhone(normalized),
          status: "NEEDS_ADMIN_REVIEW",
          last_error_code: `AUTH_${authStatus}`,
        });
      } catch { /* best-effort */ }

      return json({ ok: false, error: "AUTH_UPDATE_FAILED", status: authStatus, detail: authError }, 500);
    }

    // 6. Update profiles.phone
    const { error: profileUpdateErr } = await supabase
      .from("profiles")
      .update({ phone: normalized })
      .eq("user_id", targetUserId);

    if (profileUpdateErr) {
      // Auth succeeded but profile failed — record repair queue
      try {
        await supabase.from("phone_auth_sync_repairs").insert({
          user_id: targetUserId,
          operation_type: "change_phone",
          masked_phone: maskPhone(normalized),
          status: "PENDING",
          last_error_code: "PROFILE_UPDATE_FAILED",
        });
      } catch { /* best-effort */ }

      try {
        await supabase.from("audit_log").insert({
          user_id: user.id,
          module: "security",
          action: "phone_change_partial",
          entity_name: "user",
          entity_id: targetUserId,
          details: `Auth phone updated to ${maskPhone(normalized)} but profile update failed. Repair queue entry created.`,
          severity: "error",
        });
      } catch { /* best-effort */ }

      return json({ ok: false, error: "PROFILE_UPDATE_FAILED_AUTH_UPDATED", detail: "Auth phone was updated but profile update failed. Repair queue entry created." }, 500);
    }

    // 7. Verify both
    const { data: verifyAuth } = await supabase.auth.admin.getUserById(targetUserId);
    const { data: verifyProfile } = await supabase
      .from("profiles").select("phone").eq("user_id", targetUserId).maybeSingle();

    const authPhoneOk = normalizeIranPhone(verifyAuth?.user?.phone) === normalized;
    const profilePhoneOk = normalizeIranPhone(verifyProfile?.phone) === normalized;

    if (!authPhoneOk || !profilePhoneOk) {
      try {
        await supabase.from("phone_auth_sync_repairs").insert({
          user_id: targetUserId,
          operation_type: "change_phone",
          masked_phone: maskPhone(normalized),
          status: "NEEDS_ADMIN_REVIEW",
          last_error_code: "VERIFY_MISMATCH",
        });
      } catch { /* best-effort */ }

      return json({ ok: false, error: "VERIFY_FAILED", detail: { auth_phone_ok: authPhoneOk, profile_phone_ok: profilePhoneOk } }, 500);
    }

    // 8. Audit
    try {
      await supabase.from("audit_log").insert({
        user_id: user.id,
        module: "security",
        action: "change_phone",
        entity_name: "user",
        entity_id: targetUserId,
        details: `Phone changed to ${maskPhone(normalized)} for user ${targetUserId}`,
        severity: "warning",
      });
    } catch { /* best-effort */ }

    return json({ ok: true, message: "PHONE_CHANGED", masked_phone: maskPhone(normalized) });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return json({ ok: false, error: "INTERNAL_ERROR", detail: message }, 500);
  }
});
