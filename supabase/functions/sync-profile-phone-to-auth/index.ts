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
  if (phone.length >= 9) {
    return phone.slice(0, 5) + "****" + phone.slice(-2);
  }
  return "****";
}

interface SyncCheckResult {
  ok: boolean;
  error?: string;
  profile_exists?: boolean;
  profile_active?: boolean;
  profile_phone_masked?: string;
  auth_user_exists?: boolean;
  auth_phone_masked?: string | null;
  already_synced?: boolean;
  conflict?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }),
      { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders } });
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
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const { data: callerData, error: callerErr } = await supabase.auth.getUser(token);
    if (callerErr || !callerData?.user) {
      return new Response(JSON.stringify({ ok: false, error: "INVALID_TOKEN" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const callerId = callerData.user.id;

    // 2. Check caller is active admin
    const { data: callerProfile, error: callerProfileErr } = await supabase
      .from("profiles")
      .select("is_admin, is_active")
      .eq("user_id", callerId)
      .maybeSingle();

    if (callerProfileErr || !callerProfile || !callerProfile.is_active || !callerProfile.is_admin) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_ADMIN" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 3. Parse request body
    const body = await req.json();
    const targetUserId: string | undefined = body.user_id;
    const action: string = body.action || "check"; // "check" or "sync"

    if (!targetUserId) {
      return new Response(JSON.stringify({ ok: false, error: "USER_ID_REQUIRED" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 4. Fetch target profile
    const { data: targetProfile, error: targetErr } = await supabase
      .from("profiles")
      .select("user_id, phone, is_active, full_name")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      return new Response(JSON.stringify({ ok: false, error: "PROFILE_NOT_FOUND" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (!targetProfile.is_active) {
      return new Response(JSON.stringify({ ok: false, error: "PROFILE_INACTIVE" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 5. Normalize profile phone
    const normalizedPhone = normalizeIranPhone(targetProfile.phone);
    if (!normalizedPhone || !/^989\d{9}$/.test(normalizedPhone)) {
      return new Response(JSON.stringify({
        ok: false,
        error: "PROFILE_PHONE_INVALID",
        profile_exists: true,
        profile_active: true,
        profile_phone_masked: "",
      } satisfies SyncCheckResult),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 6. Check phone uniqueness in active profiles
    const { data: profilePhoneCount, error: countErr } = await supabase
      .rpc("resolve_phone_password_reset_target_detailed", {
        p_normalized_phone: normalizedPhone,
      });

    const resolveRow = Array.isArray(profilePhoneCount) ? profilePhoneCount[0] : profilePhoneCount;
    if (countErr || !resolveRow) {
      return new Response(JSON.stringify({ ok: false, error: "RESOLVE_FAILED" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const resolveStatus: string = resolveRow.status;
    const profilePhoneMasked = maskPhone(normalizedPhone);

    // 7. Fetch auth user
    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(targetUserId);

    if (authErr || !authUser?.user) {
      const result: SyncCheckResult = {
        ok: false,
        error: "AUTH_USER_NOT_FOUND",
        profile_exists: true,
        profile_active: true,
        profile_phone_masked: profilePhoneMasked,
        auth_user_exists: false,
      };
      return new Response(JSON.stringify(result),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    const authPhoneRaw = authUser.user.phone || null;
    const authPhoneNorm = authPhoneRaw ? normalizeIranPhone(authPhoneRaw) : "";
    const authPhoneMasked = authPhoneNorm ? maskPhone(authPhoneNorm) : null;

    // 8. Check if phone is on a different auth user
    let conflict = false;
    if (authPhoneNorm && authPhoneNorm === normalizedPhone) {
      // Same phone — check it's not on another user
      const { data: conflictCheck } = await supabase
        .from("profiles")
        .select("user_id")
        .neq("user_id", targetUserId)
        .eq("is_active", true);
      // We can't directly query auth.users via the client, but the resolve
      // function already checked uniqueness. If resolveStatus is MATCHED,
      // there's exactly one profile + one auth user with this phone.
    }

    // 9. Determine status
    let alreadySynced = false;
    if (authPhoneNorm === normalizedPhone && resolveStatus === "MATCHED") {
      alreadySynced = true;
    }

    // Check if auth phone belongs to a different user
    if (authPhoneNorm && authPhoneNorm === normalizedPhone && resolveStatus === "AUTH_PROFILE_MISMATCH") {
      conflict = true;
    }

    // 10. Build check response
    const checkResult: SyncCheckResult = {
      ok: true,
      profile_exists: true,
      profile_active: true,
      profile_phone_masked: profilePhoneMasked,
      auth_user_exists: true,
      auth_phone_masked: authPhoneMasked,
      already_synced: alreadySynced,
      conflict,
    };

    if (action === "check") {
      return new Response(JSON.stringify(checkResult),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 11. Sync action
    if (action !== "sync") {
      return new Response(JSON.stringify({ ok: false, error: "INVALID_ACTION" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Fail if already synced (idempotent success)
    if (alreadySynced) {
      return new Response(JSON.stringify({
        ...checkResult,
        ok: true,
        message: "ALREADY_SYNCED",
      }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Fail if conflict (phone on another auth user)
    if (conflict) {
      return new Response(JSON.stringify({
        ...checkResult,
        ok: false,
        error: "CONFLICT_PHONE_ON_ANOTHER_USER",
      }),
        { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Fail if auth user already has a different phone
    if (authPhoneNorm && authPhoneNorm !== normalizedPhone) {
      return new Response(JSON.stringify({
        ...checkResult,
        ok: false,
        error: "AUTH_PHONE_CONFLICT",
      }),
        { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // Fail if profile phone is not unique
    if (resolveStatus === "PROFILE_DUPLICATE" || resolveStatus === "AUTH_PHONE_DUPLICATE") {
      return new Response(JSON.stringify({
        ...checkResult,
        ok: false,
        error: "PHONE_DUPLICATE",
      }),
        { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 12. Update auth user phone via Admin API
    const e164 = `+${normalizedPhone}`;
    const { error: updateErr } = await supabase.auth.admin.updateUserById(targetUserId, {
      phone: e164,
      phone_confirm: true,
    });

    if (updateErr) {
      return new Response(JSON.stringify({
        ...checkResult,
        ok: false,
        error: "AUTH_UPDATE_FAILED",
      }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 13. Log audit
    try {
      await supabase.from("audit_logs").insert({
        user_id: callerId,
        module: "security",
        action: "sync_profile_phone_to_auth",
        entity_name: "user",
        entity_id: targetUserId,
        details: `Sync profile phone ${profilePhoneMasked} to auth user`,
        severity: "warning",
      });
    } catch { /* audit is best-effort */ }

    return new Response(JSON.stringify({
      ...checkResult,
      ok: true,
      message: "SYNCED",
    }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: "INTERNAL_ERROR" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
