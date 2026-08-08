import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";

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

interface RepairResult {
  user_id: string;
  masked_phone: string;
  success: boolean;
  status: number;
  error: string | null;
}

interface IdentityState {
  identity_count: number;
  exactly_one_phone_identity: boolean;
  identity_same_user: boolean;
  identity_sub_matches_user: boolean;
  identity_phone_matches: boolean;
  identity_phone_verified: boolean;
}

async function getIdentityState(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  normalizedPhone: string,
): Promise<IdentityState | null> {
  const { data, error } = await supabase.rpc("get_phone_auth_identity_state_v1", {
    p_user_id: userId,
    p_expected_normalized_phone: normalizedPhone,
  });
  if (error || !data) return null;
  return data as unknown as IdentityState;
}

function isCanonicalIdentity(state: IdentityState | null): boolean {
  if (!state) return false;
  return (
    state.identity_count === 1 &&
    state.exactly_one_phone_identity &&
    state.identity_same_user &&
    state.identity_sub_matches_user &&
    state.identity_phone_matches &&
    state.identity_phone_verified
  );
}

async function repairOneIdentity(
  supabase: ReturnType<typeof createClient>,
  authBaseUrl: string,
  serviceRoleKey: string,
  callerUserId: string,
  row: { user_id: string; masked_phone: string },
  auditAction: string,
): Promise<RepairResult> {
  const { data: profile } = await supabase
    .from("profiles").select("phone, is_active").eq("user_id", row.user_id).maybeSingle();

  if (!profile?.is_active || !profile.phone) {
    return { user_id: row.user_id, masked_phone: row.masked_phone, success: false, status: 0, error: "PROFILE_PHONE_NULL" };
  }

  const normalized = normalizeIranPhone(profile.phone);
  if (!normalized) {
    return { user_id: row.user_id, masked_phone: row.masked_phone, success: false, status: 0, error: "INVALID_PHONE" };
  }

  const e164 = `+${normalized}`;

  try {
    const { data: currentAuth } = await supabase.auth.admin.getUserById(row.user_id);
    const currentUser = currentAuth?.user;
    if (!currentUser || currentUser.deleted_at || (currentUser.banned_until && new Date(currentUser.banned_until) > new Date())) {
      return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_USER_NOT_ELIGIBLE" };
    }

    const currentAuthPhone = normalizeIranPhone(currentUser.phone);
    if (currentAuthPhone && currentAuthPhone !== normalized) {
      await supabase.from("phone_auth_sync_repairs").insert({ user_id: row.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "AUTH_PHONE_CONFLICT" });
      return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_PHONE_CONFLICT" };
    }

    if (!currentUser.phone_confirmed_at) {
      await supabase.from("phone_auth_sync_repairs").insert({ user_id: row.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "AUTH_PHONE_UNCONFIRMED" });
      return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_PHONE_UNCONFIRMED" };
    }

    // Idempotency: check if identity already exists via RPC
    const preState = await getIdentityState(supabase, row.user_id, normalized);
    if (preState && preState.identity_count > 0) {
      if (isCanonicalIdentity(preState)) {
        return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: true, status: 200, error: null };
      }
    }

    const syncResp = await fetch(
      `${authBaseUrl}/auth/v1/admin/users/${row.user_id}`,
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

    if (!syncResp.ok) {
      await syncResp.text();
      await supabase.from("phone_auth_sync_repairs").insert({ user_id: row.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "IDENTITY_REPAIR_FAILED" });
      return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: false, status: syncResp.status, error: "IDENTITY_REPAIR_FAILED" };
    }

    // Post-verify via secure RPC
    const postState = await getIdentityState(supabase, row.user_id, normalized);
    if (!postState) {
      await supabase.from("phone_auth_sync_repairs").insert({ user_id: row.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "IDENTITY_VERIFY_UNAVAILABLE" });
      return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: false, status: syncResp.status, error: "IDENTITY_VERIFY_UNAVAILABLE" };
    }

    // Also verify auth.users phone via Admin API
    const { data: verifiedAuth } = await supabase.auth.admin.getUserById(row.user_id);
    const verifiedPhone = normalizeIranPhone(verifiedAuth?.user?.phone);
    const authPhoneOk = verifiedPhone === normalized;
    const phoneConfirmed = Boolean(verifiedAuth?.user?.phone_confirmed_at);

    if (authPhoneOk && phoneConfirmed && isCanonicalIdentity(postState)) {
      try {
        await supabase.from("audit_log").insert({
          user_id: callerUserId,
          module: "security",
          action: auditAction,
          entity_name: "user",
          entity_id: row.user_id,
          details: `Identity repair ${maskPhone(normalized)} — phone identity created`,
          severity: "info",
        });
      } catch { /* best-effort */ }
      return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: true, status: syncResp.status, error: null };
    }

    // GoTrue accepted but identity not created
    if (authPhoneOk && phoneConfirmed && postState.identity_count === 0) {
      await supabase.from("phone_auth_sync_repairs").insert({ user_id: row.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "GOTRUE_IDENTITY_REPAIR_UNSUPPORTED" });
      return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: false, status: syncResp.status, error: "GOTRUE_IDENTITY_REPAIR_UNSUPPORTED" };
    }

    await supabase.from("phone_auth_sync_repairs").insert({ user_id: row.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "IDENTITY_VERIFY_FAILED" });
    return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: false, status: syncResp.status, error: "IDENTITY_VERIFY_FAILED" };
  } catch {
    try {
      await supabase.from("phone_auth_sync_repairs").insert({ user_id: row.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "IDENTITY_REPAIR_FAILED" });
    } catch { /* best-effort */ }
    return { user_id: row.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "IDENTITY_REPAIR_FAILED" };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return deniedResponse();
  const callerUserId = authResult.userId!;

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: callerProfile } = await supabase
      .from("profiles").select("is_admin, is_active").eq("user_id", callerUserId).maybeSingle();
    if (!callerProfile?.is_admin || !callerProfile?.is_active) {
      return json({ ok: false, error: "NOT_ADMIN" }, 403);
    }

    const body = await req.json();
    const mode: string = body.mode || "dry_run";

    const authBaseUrl = Deno.env.get("SUPABASE_INTERNAL_URL") ?? Deno.env.get("SUPABASE_URL") ?? "http://kong:8000";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Dry Run: classify all profiles ──────────────────────────────────────
    if (mode === "dry_run") {
      const { data: classifications, error } = await supabase.rpc("bulk_classify_phone_sync", { p_dry_run: true });
      if (error) return json({ ok: false, error: "CLASSIFY_FAILED" }, 500);

      const rows = classifications || [];
      const summary: Record<string, number> = {};
      for (const row of rows) {
        const st = (row as { status: string }).status;
        summary[st] = (summary[st] || 0) + 1;
      }

      return json({ ok: true, mode: "dry_run", summary, classifications: rows });
    }

    // ── Execute: sync only SAFE_TO_SYNC users ──────────────────────────────
    if (mode === "execute") {
      const { data: classifications, error } = await supabase.rpc("bulk_classify_phone_sync", { p_dry_run: false });
      if (error) return json({ ok: false, error: "CLASSIFY_FAILED" }, 500);

      const rows = classifications || [];
      const safeToSync = rows.filter((r: { status: string }) => r.status === "SAFE_TO_SYNC");

      const results: RepairResult[] = [];

      for (const row of safeToSync) {
        const r = row as { user_id: string; masked_phone: string };
        const { data: profile } = await supabase
          .from("profiles").select("phone, is_active").eq("user_id", r.user_id).maybeSingle();

        if (!profile?.is_active || !profile.phone) {
          results.push({ user_id: r.user_id, masked_phone: r.masked_phone, success: false, status: 0, error: "PROFILE_PHONE_NULL" });
          continue;
        }

        const normalized = normalizeIranPhone(profile.phone);
        if (!normalized) {
          results.push({ user_id: r.user_id, masked_phone: r.masked_phone, success: false, status: 0, error: "INVALID_PHONE" });
          continue;
        }

        const e164 = `+${normalized}`;

        try {
          const { data: currentAuth } = await supabase.auth.admin.getUserById(r.user_id);
          const currentUser = currentAuth?.user;
          if (!currentUser || currentUser.deleted_at || (currentUser.banned_until && new Date(currentUser.banned_until) > new Date())) {
            results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_USER_NOT_ELIGIBLE" });
            continue;
          }
          const currentAuthPhone = normalizeIranPhone(currentUser.phone);
          if (currentAuthPhone && currentAuthPhone !== normalized) {
            results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_PHONE_CONFLICT" });
            await supabase.from("phone_auth_sync_repairs").insert({ user_id: r.user_id, operation_type: "sync_profile_phone", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "AUTH_PHONE_CONFLICT" });
            continue;
          }

          const syncResp = await fetch(
            `${authBaseUrl}/auth/v1/admin/users/${r.user_id}`,
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

          if (syncResp.ok) {
            const { data: verifiedAuth } = await supabase.auth.admin.getUserById(r.user_id);
            const verifiedPhone = normalizeIranPhone(verifiedAuth?.user?.phone);
            const verified = verifiedPhone === normalized && Boolean(verifiedAuth?.user?.phone_confirmed_at);
            if (verified) {
              results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: true, status: syncResp.status, error: null });
              try {
                await supabase.from("audit_log").insert({
                  user_id: callerUserId,
                  module: "security",
                  action: "bulk_sync_profile_phone_to_auth",
                  entity_name: "user",
                  entity_id: r.user_id,
                  details: `Bulk sync phone ${maskPhone(normalized)} to auth`,
                  severity: "info",
                });
              } catch { /* best-effort */ }
            } else {
              results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: syncResp.status, error: "VERIFY_MISMATCH" });
              await supabase.from("phone_auth_sync_repairs").insert({ user_id: r.user_id, operation_type: "sync_profile_phone", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "VERIFY_MISMATCH" });
            }
          } else {
            await syncResp.text();
            results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: syncResp.status, error: "AUTH_UPDATE_FAILED" });
            await supabase.from("phone_auth_sync_repairs").insert({
              user_id: r.user_id,
              operation_type: "sync_profile_phone",
              masked_phone: maskPhone(normalized),
              status: "NEEDS_ADMIN_REVIEW",
              last_error_code: "AUTH_UPDATE_FAILED",
            });
          }
        } catch {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_UPDATE_FAILED" });
          try {
            await supabase.from("phone_auth_sync_repairs").insert({
              user_id: r.user_id,
              operation_type: "sync_profile_phone",
              masked_phone: maskPhone(normalized),
              status: "NEEDS_ADMIN_REVIEW",
              last_error_code: "AUTH_UPDATE_FAILED",
            });
          } catch { /* best-effort */ }
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return json({ ok: true, mode: "execute", total: safeToSync.length, succeeded, failed, results });
    }

    // ── Identity Canary: repair ONE IDENTITY_REPAIR_REQUIRED user ───────────
    if (mode === "identity_canary") {
      const { data: classifications, error } = await supabase.rpc("bulk_classify_phone_sync", { p_dry_run: false });
      if (error) return json({ ok: false, error: "CLASSIFY_FAILED" }, 500);

      const rows = classifications || [];
      const repairNeeded = rows.filter((r: { status: string }) => r.status === "IDENTITY_REPAIR_REQUIRED");

      if (repairNeeded.length === 0) {
        return json({ ok: true, mode: "identity_canary", result: "NO_CANDIDATES", message: "No IDENTITY_REPAIR_REQUIRED users found" });
      }

      const canary = repairNeeded[0] as { user_id: string; masked_phone: string };
      const result = await repairOneIdentity(supabase, authBaseUrl, serviceRoleKey, callerUserId, canary, "repair_phone_auth_identity_canary");

      return json({ ok: true, mode: "identity_canary", canary_result: result, canary_passed: result.success });
    }

    // ── Identity Repair: canary-first, then bulk ───────────────────────────
    if (mode === "identity_repair") {
      // Phase 1: Canary — always run first, non-bypassable
      const { data: canaryClassifications, error: canaryErr } = await supabase.rpc("bulk_classify_phone_sync", { p_dry_run: false });
      if (canaryErr) return json({ ok: false, error: "CLASSIFY_FAILED" }, 500);

      const canaryRows = canaryClassifications || [];
      const canaryCandidates = canaryRows.filter((r: { status: string }) => r.status === "IDENTITY_REPAIR_REQUIRED");

      if (canaryCandidates.length === 0) {
        return json({ ok: true, mode: "identity_repair", canary_passed: true, total: 0, succeeded: 0, failed: 0, results: [], message: "No IDENTITY_REPAIR_REQUIRED users found" });
      }

      const canaryRow = canaryCandidates[0] as { user_id: string; masked_phone: string };
      const canaryResult = await repairOneIdentity(supabase, authBaseUrl, serviceRoleKey, callerUserId, canaryRow, "repair_phone_auth_identity_canary");

      if (!canaryResult.success) {
        return json({
          ok: false,
          mode: "identity_repair",
          canary_passed: false,
          canary_result: canaryResult,
          error: "CANARY_FAILED",
          message: "Canary repair failed. Bulk repair aborted.",
        });
      }

      // Phase 2: Re-classify and repair remaining
      const { data: bulkClassifications, error: bulkErr } = await supabase.rpc("bulk_classify_phone_sync", { p_dry_run: false });
      if (bulkErr) return json({ ok: false, error: "CLASSIFY_FAILED" }, 500);

      const bulkRows = bulkClassifications || [];
      const repairNeeded = bulkRows.filter((r: { status: string }) => r.status === "IDENTITY_REPAIR_REQUIRED");

      const results: RepairResult[] = [canaryResult];

      for (const row of repairNeeded) {
        const r = row as { user_id: string; masked_phone: string };

        // Runtime revalidation
        const { data: profile } = await supabase
          .from("profiles").select("phone, is_active").eq("user_id", r.user_id).maybeSingle();

        if (!profile?.is_active || !profile.phone) {
          results.push({ user_id: r.user_id, masked_phone: r.masked_phone, success: false, status: 0, error: "RUNTIME_STATE_CHANGED" });
          await supabase.from("phone_auth_sync_repairs").insert({ user_id: r.user_id, operation_type: "identity_repair", masked_phone: r.masked_phone, status: "NEEDS_ADMIN_REVIEW", last_error_code: "RUNTIME_STATE_CHANGED" });
          continue;
        }

        const normalized = normalizeIranPhone(profile.phone);
        if (!normalized) {
          results.push({ user_id: r.user_id, masked_phone: r.masked_phone, success: false, status: 0, error: "RUNTIME_STATE_CHANGED" });
          await supabase.from("phone_auth_sync_repairs").insert({ user_id: r.user_id, operation_type: "identity_repair", masked_phone: r.masked_phone, status: "NEEDS_ADMIN_REVIEW", last_error_code: "RUNTIME_STATE_CHANGED" });
          continue;
        }

        const { data: currentAuth } = await supabase.auth.admin.getUserById(r.user_id);
        const currentUser = currentAuth?.user;
        if (!currentUser || currentUser.deleted_at || (currentUser.banned_until && new Date(currentUser.banned_until) > new Date())) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_USER_NOT_ELIGIBLE" });
          await supabase.from("phone_auth_sync_repairs").insert({ user_id: r.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "AUTH_USER_NOT_ELIGIBLE" });
          continue;
        }

        const currentAuthPhone = normalizeIranPhone(currentUser.phone);
        if (currentAuthPhone !== normalized) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "RUNTIME_STATE_CHANGED" });
          await supabase.from("phone_auth_sync_repairs").insert({ user_id: r.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "RUNTIME_STATE_CHANGED" });
          continue;
        }

        if (!currentUser.phone_confirmed_at) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_PHONE_UNCONFIRMED" });
          await supabase.from("phone_auth_sync_repairs").insert({ user_id: r.user_id, operation_type: "identity_repair", masked_phone: maskPhone(normalized), status: "NEEDS_ADMIN_REVIEW", last_error_code: "AUTH_PHONE_UNCONFIRMED" });
          continue;
        }

        // Idempotency via RPC
        const preState = await getIdentityState(supabase, r.user_id, normalized);
        if (preState && preState.identity_count > 0 && isCanonicalIdentity(preState)) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: true, status: 200, error: null });
          continue;
        }

        const result = await repairOneIdentity(supabase, authBaseUrl, serviceRoleKey, callerUserId, r, "repair_phone_auth_identity_after_direct_backfill");
        results.push(result);
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return json({ ok: true, mode: "identity_repair", canary_passed: true, total: results.length, succeeded, failed, results });
    }

    return json({ ok: false, error: "INVALID_MODE" }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return json({ ok: false, error: "INTERNAL_ERROR", detail: message }, 500);
  }
});
