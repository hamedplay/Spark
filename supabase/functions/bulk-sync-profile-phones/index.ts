import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";
import { normalizeIranPhone } from "../_shared/phone.ts";
import { postJsonCorsBaseHeaders as baseCorsHeaders, getPhoneAuthAllowedOrigins as getAllowedOrigins, createJsonResponseHeaders } from "../_shared/runtimeHttp.ts";

const responseHeaders = createJsonResponseHeaders(baseCorsHeaders);

function tokenClaims(token: string): { session_id?: string; aal?: string } | null {
  try {
    const encoded = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!encoded) return null;
    return JSON.parse(atob(encoded.padEnd(encoded.length + ((4 - encoded.length % 4) % 4), "=")));
  } catch { return null; }
}

function maskPhone(phone: string): string {
  if (!phone || phone.length <= 4) return "***";
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}

interface InternalRepairResult {
  user_id: string;
  masked_phone: string;
  success: boolean;
  status: number;
  error: string | null;
}

interface PublicRepairResult {
  masked_phone: string;
  success: boolean;
  status: number;
  error: string | null;
}

function toPublic(r: InternalRepairResult): PublicRepairResult {
  return { masked_phone: r.masked_phone, success: r.success, status: r.status, error: r.error };
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

async function logRepair(supabase: ReturnType<typeof createClient>, userId: string, masked: string, code: string) {
  try {
    await supabase.from("phone_auth_sync_repairs").insert({
      user_id: userId,
      operation_type: "identity_repair",
      masked_phone: masked,
      status: "NEEDS_ADMIN_REVIEW",
      last_error_code: code,
    });
  } catch { /* best-effort */ }
}

async function repairOneIdentity(
  supabase: ReturnType<typeof createClient>,
  authBaseUrl: string,
  serviceRoleKey: string,
  callerUserId: string,
  row: { user_id: string; masked_phone: string },
  auditAction: string,
): Promise<InternalRepairResult> {
  const { data: profile } = await supabase
    .from("profiles").select("phone, account_status").eq("user_id", row.user_id).maybeSingle();

  if (profile?.account_status !== "ACTIVE" || !profile.phone) {
    return { user_id: row.user_id, masked_phone: row.masked_phone, success: false, status: 0, error: "PROFILE_PHONE_NULL" };
  }

  const normalized = normalizeIranPhone(profile.phone);
  if (!normalized) {
    return { user_id: row.user_id, masked_phone: row.masked_phone, success: false, status: 0, error: "INVALID_PHONE" };
  }

  const masked = maskPhone(normalized);
  const e164 = `+${normalized}`;

  try {
    const { data: currentAuth } = await supabase.auth.admin.getUserById(row.user_id);
    const currentUser = currentAuth?.user;
    if (!currentUser || currentUser.deleted_at || (currentUser.banned_until && new Date(currentUser.banned_until) > new Date())) {
      return { user_id: row.user_id, masked_phone: masked, success: false, status: 0, error: "AUTH_USER_NOT_ELIGIBLE" };
    }

    const currentAuthPhone = normalizeIranPhone(currentUser.phone);
    if (currentAuthPhone && currentAuthPhone !== normalized) {
      await logRepair(supabase, row.user_id, masked, "AUTH_PHONE_CONFLICT");
      return { user_id: row.user_id, masked_phone: masked, success: false, status: 0, error: "AUTH_PHONE_CONFLICT" };
    }

    if (!currentUser.phone_confirmed_at) {
      await logRepair(supabase, row.user_id, masked, "AUTH_PHONE_UNCONFIRMED");
      return { user_id: row.user_id, masked_phone: masked, success: false, status: 0, error: "AUTH_PHONE_UNCONFIRMED" };
    }

    // ── Pre-verification: MUST succeed before any GoTrue write ──────────────
    const preState = await getIdentityState(supabase, row.user_id, normalized);

    // Fail-closed: RPC unavailable → NO WRITE
    if (!preState) {
      await logRepair(supabase, row.user_id, masked, "IDENTITY_VERIFY_UNAVAILABLE");
      return { user_id: row.user_id, masked_phone: masked, success: false, status: 0, error: "IDENTITY_VERIFY_UNAVAILABLE" };
    }

    // Already canonical → idempotent success, NO WRITE
    if (isCanonicalIdentity(preState)) {
      return { user_id: row.user_id, masked_phone: masked, success: true, status: 200, error: null };
    }

    // Identity exists but non-canonical → CONFLICT, NO WRITE
    if (preState.identity_count > 0) {
      await logRepair(supabase, row.user_id, masked, "IDENTITY_STATE_CONFLICT");
      return { user_id: row.user_id, masked_phone: masked, success: false, status: 0, error: "IDENTITY_STATE_CONFLICT" };
    }

    // Only identity_count === 0 reaches GoTrue PUT
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
      await logRepair(supabase, row.user_id, masked, "IDENTITY_REPAIR_FAILED");
      return { user_id: row.user_id, masked_phone: masked, success: false, status: syncResp.status, error: "IDENTITY_REPAIR_FAILED" };
    }

    // ── Post-verify via secure RPC ─────────────────────────────────────────
    const postState = await getIdentityState(supabase, row.user_id, normalized);
    if (!postState) {
      await logRepair(supabase, row.user_id, masked, "IDENTITY_VERIFY_UNAVAILABLE");
      return { user_id: row.user_id, masked_phone: masked, success: false, status: syncResp.status, error: "IDENTITY_VERIFY_UNAVAILABLE" };
    }

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
          details: `Identity repair ${masked} — phone identity created`,
          severity: "info",
        });
      } catch { /* best-effort */ }
      return { user_id: row.user_id, masked_phone: masked, success: true, status: syncResp.status, error: null };
    }

    // GoTrue accepted but identity not created
    if (authPhoneOk && phoneConfirmed && postState.identity_count === 0) {
      await logRepair(supabase, row.user_id, masked, "GOTRUE_IDENTITY_REPAIR_UNSUPPORTED");
      return { user_id: row.user_id, masked_phone: masked, success: false, status: syncResp.status, error: "GOTRUE_IDENTITY_REPAIR_UNSUPPORTED" };
    }

    await logRepair(supabase, row.user_id, masked, "IDENTITY_VERIFY_FAILED");
    return { user_id: row.user_id, masked_phone: masked, success: false, status: syncResp.status, error: "IDENTITY_VERIFY_FAILED" };
  } catch {
    await logRepair(supabase, row.user_id, masked, "IDENTITY_REPAIR_FAILED");
    return { user_id: row.user_id, masked_phone: masked, success: false, status: 0, error: "IDENTITY_REPAIR_FAILED" };
  }
}

Deno.serve(async (req: Request) => {
  const allowedOrigins = await getAllowedOrigins();
  const requestOrigin = req.headers.get("Origin");
  const origin = requestOrigin && allowedOrigins.includes(requestOrigin) ? requestOrigin : null;
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: responseHeaders(origin) });

  if (allowedOrigins.length === 0) return json({ ok: false, error: "RUNTIME_CONFIG_UNAVAILABLE" }, 503);
  if (requestOrigin && !origin) return json({ ok: false, error: "ORIGIN_NOT_ALLOWED" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (req.method !== "POST") return json({ ok: false, error: "METHOD_NOT_ALLOWED" }, 405);

  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return json({ ok: false, error: "AUTH_ACCESS_RESTRICTED" }, 403);
  const callerUserId = authResult.userId!;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const claims = tokenClaims(token);
    if (!claims?.session_id) {
      return json({ ok: false, error: "AUTH_ACCESS_RESTRICTED" }, 403);
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("is_security_admin, account_status")
      .eq("user_id", callerUserId)
      .maybeSingle();
    if (callerProfile?.is_security_admin !== true || callerProfile?.account_status !== "ACTIVE") {
      return json({ ok: false, error: "NOT_SECURITY_ADMIN" }, 403);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({ ok: false, error: "INVALID_REQUEST" }, 400);
    }
    const mode: string = body.mode || "dry_run";
    if (!["dry_run", "execute", "identity_canary", "identity_repair"].includes(mode)) {
      return json({ ok: false, error: "INVALID_MODE" }, 400);
    }

    // Status inspection is read-only. Mutating repair modes remain protected
    // by aal2 plus a recent TOTP step-up grant.
    if (mode !== "dry_run") {
      if (claims.aal !== "aal2") {
        return json({ ok: false, error: "MFA_STEP_UP_REQUIRED" }, 403);
      }
      const { data: hasStepUp, error: stepUpError } = await supabase.rpc("has_recent_totp_stepup_grant", {
        p_user_id: callerUserId,
        p_session_id: claims.session_id,
      });
      if (stepUpError || hasStepUp !== true) {
        return json({ ok: false, error: "MFA_STEP_UP_REQUIRED" }, 403);
      }
    }

    const { error: auditError } = await supabase.from("security_audit_events").insert({
      user_id: callerUserId,
      actor_user_id: callerUserId,
      event_type: `phone_identity_${mode}_requested`,
      event_category: "access",
      severity: mode === "dry_run" ? "info" : "warning",
      result: "success",
      session_id: claims.session_id,
      metadata: { mode },
    });
    if (auditError) {
      console.error("bulk-sync-profile-phones audit write failed", {
        code: auditError.code,
        message: auditError.message,
        details: auditError.details,
      });
      return json({ ok: false, error: "AUDIT_WRITE_FAILED" }, 500);
    }

    const authBaseUrl = Deno.env.get("SUPABASE_INTERNAL_URL") ?? Deno.env.get("SUPABASE_URL") ?? "http://kong:8000";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ── Dry Run: classify all profiles (summary only, no user data) ─────────
    if (mode === "dry_run") {
      const { data: classifications, error } = await supabase.rpc("bulk_classify_phone_sync", { p_dry_run: true });
      if (error) return json({ ok: false, error: "CLASSIFY_FAILED" }, 500);

      const rows = classifications || [];
      const summary: Record<string, number> = {};
      for (const row of rows) {
        const st = (row as { status: string }).status;
        summary[st] = (summary[st] || 0) + 1;
      }

      return json({ ok: true, mode: "dry_run", summary });
    }

    // ── Execute: sync only SAFE_TO_SYNC users ──────────────────────────────
    if (mode === "execute") {
      const { data: classifications, error } = await supabase.rpc("bulk_classify_phone_sync", { p_dry_run: false });
      if (error) return json({ ok: false, error: "CLASSIFY_FAILED" }, 500);

      const rows = classifications || [];
      const safeToSync = rows.filter((r: { status: string }) => r.status === "SAFE_TO_SYNC");

      const results: InternalRepairResult[] = [];

      for (const row of safeToSync) {
        const r = row as { user_id: string; masked_phone: string };
        const { data: profile } = await supabase
          .from("profiles").select("phone, account_status").eq("user_id", r.user_id).maybeSingle();

        if (profile?.account_status !== "ACTIVE" || !profile.phone) {
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
            await logRepair(supabase, r.user_id, maskPhone(normalized), "AUTH_PHONE_CONFLICT");
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
              await logRepair(supabase, r.user_id, maskPhone(normalized), "VERIFY_MISMATCH");
            }
          } else {
            await syncResp.text();
            results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: syncResp.status, error: "AUTH_UPDATE_FAILED" });
            await logRepair(supabase, r.user_id, maskPhone(normalized), "AUTH_UPDATE_FAILED");
          }
        } catch {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_UPDATE_FAILED" });
          await logRepair(supabase, r.user_id, maskPhone(normalized), "AUTH_UPDATE_FAILED");
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return json({ ok: true, mode: "execute", total: safeToSync.length, succeeded, failed, results: results.map(toPublic) });
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

      return json({ ok: true, mode: "identity_canary", canary_result: toPublic(result), canary_passed: result.success });
    }

    // ── Identity Repair: canary-first, then bulk ───────────────────────────
    if (mode === "identity_repair") {
      // Phase 1: Canary — always run first, non-bypassable
      const { data: canaryClassifications, error: canaryErr } = await supabase.rpc("bulk_classify_phone_sync", { p_dry_run: false });
      if (canaryErr) return json({ ok: false, error: "CLASSIFY_FAILED" }, 500);

      const canaryRows = canaryClassifications || [];
      const canaryCandidates = canaryRows.filter((r: { status: string }) => r.status === "IDENTITY_REPAIR_REQUIRED");

      if (canaryCandidates.length === 0) {
        return json({ ok: true, mode: "identity_repair", canary_passed: true, total: 0, succeeded: 0, failed: 0, skipped: 0, results: [], message: "No IDENTITY_REPAIR_REQUIRED users found" });
      }

      const canaryRow = canaryCandidates[0] as { user_id: string; masked_phone: string };
      const canaryResult = await repairOneIdentity(supabase, authBaseUrl, serviceRoleKey, callerUserId, canaryRow, "repair_phone_auth_identity_canary");

      if (!canaryResult.success) {
        return json({
          ok: false,
          mode: "identity_repair",
          canary_passed: false,
          canary_result: toPublic(canaryResult),
          error: "CANARY_FAILED",
          message: "Canary repair failed. Bulk repair aborted.",
        });
      }

      // Phase 2: Re-classify and repair remaining
      const { data: bulkClassifications, error: bulkErr } = await supabase.rpc("bulk_classify_phone_sync", { p_dry_run: false });
      if (bulkErr) return json({ ok: false, error: "CLASSIFY_FAILED" }, 500);

      const bulkRows = bulkClassifications || [];
      const repairNeeded = bulkRows.filter((r: { status: string }) => r.status === "IDENTITY_REPAIR_REQUIRED");

      const results: InternalRepairResult[] = [canaryResult];
      let skipped = 0;

      for (const row of repairNeeded) {
        const r = row as { user_id: string; masked_phone: string };

        // Runtime revalidation
        const { data: profile } = await supabase
          .from("profiles").select("phone, account_status").eq("user_id", r.user_id).maybeSingle();

        if (profile?.account_status !== "ACTIVE" || !profile.phone) {
          results.push({ user_id: r.user_id, masked_phone: r.masked_phone, success: false, status: 0, error: "RUNTIME_STATE_CHANGED" });
          await logRepair(supabase, r.user_id, r.masked_phone, "RUNTIME_STATE_CHANGED");
          skipped++;
          continue;
        }

        const normalized = normalizeIranPhone(profile.phone);
        if (!normalized) {
          results.push({ user_id: r.user_id, masked_phone: r.masked_phone, success: false, status: 0, error: "RUNTIME_STATE_CHANGED" });
          await logRepair(supabase, r.user_id, r.masked_phone, "RUNTIME_STATE_CHANGED");
          skipped++;
          continue;
        }

        const { data: currentAuth } = await supabase.auth.admin.getUserById(r.user_id);
        const currentUser = currentAuth?.user;
        if (!currentUser || currentUser.deleted_at || (currentUser.banned_until && new Date(currentUser.banned_until) > new Date())) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_USER_NOT_ELIGIBLE" });
          await logRepair(supabase, r.user_id, maskPhone(normalized), "AUTH_USER_NOT_ELIGIBLE");
          skipped++;
          continue;
        }

        const currentAuthPhone = normalizeIranPhone(currentUser.phone);
        if (currentAuthPhone !== normalized) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "RUNTIME_STATE_CHANGED" });
          await logRepair(supabase, r.user_id, maskPhone(normalized), "RUNTIME_STATE_CHANGED");
          skipped++;
          continue;
        }

        if (!currentUser.phone_confirmed_at) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "AUTH_PHONE_UNCONFIRMED" });
          await logRepair(supabase, r.user_id, maskPhone(normalized), "AUTH_PHONE_UNCONFIRMED");
          skipped++;
          continue;
        }

        // Pre-verification fail-closed
        const preState = await getIdentityState(supabase, r.user_id, normalized);
        if (!preState) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "IDENTITY_VERIFY_UNAVAILABLE" });
          await logRepair(supabase, r.user_id, maskPhone(normalized), "IDENTITY_VERIFY_UNAVAILABLE");
          skipped++;
          continue;
        }

        if (isCanonicalIdentity(preState)) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: true, status: 200, error: null });
          continue;
        }

        if (preState.identity_count > 0) {
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: "IDENTITY_STATE_CONFLICT" });
          await logRepair(supabase, r.user_id, maskPhone(normalized), "IDENTITY_STATE_CONFLICT");
          skipped++;
          continue;
        }

        const result = await repairOneIdentity(supabase, authBaseUrl, serviceRoleKey, callerUserId, r, "repair_phone_auth_identity_after_direct_backfill");
        results.push(result);
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return json({ ok: true, mode: "identity_repair", canary_passed: true, total: results.length, succeeded, failed, skipped, results: results.map(toPublic) });
    }

    return json({ ok: false, error: "INVALID_MODE" }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return json({ ok: false, error: "INTERNAL_ERROR", detail: message }, 500);
  }
});
