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
  auth_error_message?: string;
  auth_error_status?: number;
  auth_error_code?: string;
  profile_exists?: boolean;
  profile_active?: boolean;
  profile_phone_masked?: string;
  auth_user_exists?: boolean;
  auth_phone_masked?: string | null;
  already_synced?: boolean;
  conflict?: boolean;
  message?: string;
}

const ADMIN_UPDATE_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("TIMEOUT")), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(
      supabaseUrl,
      serviceRoleKey,
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
    const action: string = body.action || "check";

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

    // 6. Check phone uniqueness via detailed resolver
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

    // 8. Determine status
    let alreadySynced = false;
    if (authPhoneNorm === normalizedPhone && resolveStatus === "MATCHED") {
      alreadySynced = true;
    }

    let conflict = false;
    if (authPhoneNorm && authPhoneNorm === normalizedPhone && resolveStatus === "AUTH_PROFILE_MISMATCH") {
      conflict = true;
    }

    // 9. Build check response
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

    // 10. Sync action
    if (action !== "sync") {
      return new Response(JSON.stringify({ ok: false, error: "INVALID_ACTION" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (alreadySynced) {
      return new Response(JSON.stringify({
        ...checkResult,
        ok: true,
        message: "ALREADY_SYNCED",
      }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (conflict) {
      return new Response(JSON.stringify({
        ...checkResult,
        ok: false,
        error: "CONFLICT_PHONE_ON_ANOTHER_USER",
      }),
        { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (authPhoneNorm && authPhoneNorm !== normalizedPhone) {
      return new Response(JSON.stringify({
        ...checkResult,
        ok: false,
        error: "AUTH_PHONE_CONFLICT",
      }),
        { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    if (resolveStatus === "PROFILE_DUPLICATE" || resolveStatus === "AUTH_PHONE_DUPLICATE") {
      return new Response(JSON.stringify({
        ...checkResult,
        ok: false,
        error: "PHONE_DUPLICATE",
      }),
        { status: 409, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 11. Update auth user phone via raw fetch to GoTrue Admin API
    //     (SDK updateUserById returns AuthRetryableFetchError with empty body;
    //      raw fetch lets us capture the real HTTP status, headers, and body.)
    const e164Phone = `+${normalizedPhone}`;

    const authBaseUrl =
      Deno.env.get("SUPABASE_INTERNAL_URL") ??
      Deno.env.get("SUPABASE_URL") ??
      "http://kong:8000";

    console.log("PHONE_SYNC_BEFORE_AUTH_UPDATE", {
      targetUserId,
      phoneMasked: profilePhoneMasked,
      authBaseUrl,
    });

    interface RawAttemptResult {
      label: string;
      status: number;
      contentType: string | null;
      bodyPreview: string;
      ok: boolean;
      elapsedMs: number;
    }

    async function rawAuthUpdate(
      label: string,
      payload: Record<string, unknown>,
    ): Promise<RawAttemptResult> {
      const startAt = Date.now();
      let resp: Response;
      try {
        resp = await fetch(
          `${authBaseUrl}/auth/v1/admin/users/${targetUserId}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "apikey": serviceRoleKey,
              "Authorization": `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(ADMIN_UPDATE_TIMEOUT_MS),
          },
        );
      } catch (fetchErr) {
        const elapsed = Date.now() - startAt;
        const errMsg = fetchErr instanceof Error ? fetchErr.message : "unknown";
        console.error("PHONE_SYNC_RAW_FETCH_ERROR", { label, elapsed, message: errMsg });
        return {
          label,
          status: 0,
          contentType: null,
          bodyPreview: `FETCH_ERROR: ${errMsg}`,
          ok: false,
          elapsedMs: elapsed,
        };
      }

      const elapsed = Date.now() - startAt;
      const rawBody = await resp.text();
      const contentType = resp.headers.get("content-type");

      // Sanitize: strip sensitive fields before logging body preview
      let sanitizedPreview = rawBody.slice(0, 1000);
      try {
        const parsed = JSON.parse(rawBody);
        if (parsed && typeof parsed === "object") {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (["email", "phone", "encrypted_password", "raw_app_meta_data", "raw_user_meta_data"].includes(k)) {
              safe[k] = "[REDACTED]";
            } else if (k === "phone_confirmed_at") {
              safe[k] = v;
            } else {
              safe[k] = v;
            }
          }
          sanitizedPreview = JSON.stringify(safe).slice(0, 1000);
        }
      } catch { /* not JSON, keep raw preview */ }

      console.log("PHONE_SYNC_RAW_AUTH_RESPONSE", {
        label,
        status: resp.status,
        contentType,
        bodyPreview: sanitizedPreview,
        elapsedMs: elapsed,
      });

      return {
        label,
        status: resp.status,
        contentType,
        bodyPreview: sanitizedPreview,
        ok: resp.status >= 200 && resp.status < 300,
        elapsedMs: elapsed,
      };
    }

    // --- Attempt 1: phone + phone_confirm: true ---
    const attempt1 = await rawAuthUpdate("with_phone_confirm", {
      phone: e164Phone,
      phone_confirm: true,
    });

    const attempts: RawAttemptResult[] = [attempt1];

    // --- Attempt 2 (only if attempt 1 failed): phone only, no phone_confirm ---
    if (!attempt1.ok) {
      console.log("PHONE_SYNC_RETRY_WITHOUT_PHONE_CONFIRM", {
        targetUserId,
        phoneMasked: profilePhoneMasked,
      });
      const attempt2 = await rawAuthUpdate("without_phone_confirm", {
        phone: e164Phone,
      });
      attempts.push(attempt2);
    }

    const lastAttempt = attempts[attempts.length - 1];

    console.log("PHONE_SYNC_AFTER_AUTH_UPDATE", {
      targetUserId,
      elapsedMs: lastAttempt.elapsedMs,
      success: lastAttempt.ok,
    });

    // Re-fetch auth user to check final state
    const { data: postUpdateUser } = await supabase.auth.admin.getUserById(targetUserId);
    const postPhoneRaw = postUpdateUser?.user?.phone || null;
    const postPhoneNorm = postPhoneRaw ? normalizeIranPhone(postPhoneRaw) : "";
    const postPhoneMasked = postPhoneNorm ? maskPhone(postPhoneNorm) : null;
    const postPhoneConfirmedAt = postUpdateUser?.user?.phone_confirmed_at || null;

    if (!lastAttempt.ok) {
      console.error("PHONE_SYNC_AUTH_UPDATE_FAILED", {
        message: lastAttempt.bodyPreview,
        status: lastAttempt.status,
        attempts: attempts.map((a) => ({ label: a.label, status: a.status, ok: a.ok })),
      });

      return new Response(JSON.stringify({
        ...checkResult,
        ok: false,
        error: "AUTH_UPDATE_FAILED",
        auth_error_message: lastAttempt.bodyPreview || "Unknown auth error",
        auth_error_status: lastAttempt.status || 0,
        auth_error_code: "RAW_FETCH",
        debug_attempts: attempts.map((a) => ({
          label: a.label,
          status: a.status,
          ok: a.ok,
          contentType: a.contentType,
        })),
        post_phone_masked: postPhoneMasked,
        post_phone_confirmed_at: postPhoneConfirmedAt,
      }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
    }

    // 12. Log audit
    try {
      await supabase.from("audit_log").insert({
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
      debug_attempts: attempts.map((a) => ({
        label: a.label,
        status: a.status,
        ok: a.ok,
        contentType: a.contentType,
      })),
      post_phone_masked: postPhoneMasked,
      post_phone_confirmed_at: postPhoneConfirmedAt,
    }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });

  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: "INTERNAL_ERROR" }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } });
  }
});
