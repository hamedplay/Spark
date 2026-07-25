import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    const body = await req.json();
    const action: string = body.action || "diagnose";

    // ── Diagnose: list all phone-only orphans ──────────────────────────────
    if (action === "diagnose") {
      const { data: orphans, error } = await supabase.rpc("diagnose_phone_only_orphans");
      if (error) return json({ ok: false, error: "DIAGNOSE_FAILED" }, 500);

      return json({ ok: true, orphans: orphans || [] });
    }

    // ── Repair: delete a phone-only orphan and sync phone to primary user ───
    if (action === "repair") {
      const orphanUserId: string | undefined = body.orphan_user_id;
      if (!orphanUserId) return json({ ok: false, error: "ORPHAN_USER_ID_REQUIRED" }, 400);

      // 1. Fetch the orphan auth user
      const { data: orphanUser, error: orphanErr } = await supabase.auth.admin.getUserById(orphanUserId);
      if (orphanErr || !orphanUser?.user) {
        return json({ ok: false, error: "ORPHAN_NOT_FOUND" }, 404);
      }

      const orphanPhone = orphanUser.user.phone || "";

      // 2. Verify it's truly an orphan: no email, has phone, no profile
      if (orphanUser.user.email) {
        return json({ ok: false, error: "ORPHAN_HAS_EMAIL", detail: "This auth user has an email and is not a phone-only orphan" }, 400);
      }
      if (!orphanPhone) {
        return json({ ok: false, error: "ORPHAN_NO_PHONE" }, 400);
      }

      const { data: orphanProfile } = await supabase
        .from("profiles").select("user_id").eq("user_id", orphanUserId).maybeSingle();
      if (orphanProfile) {
        return json({ ok: false, error: "ORPHAN_HAS_PROFILE", detail: "This auth user has a profile and is not an orphan" }, 400);
      }

      // 3. Check for dependent records
      const { data: depCheck } = await supabase.rpc("diagnose_phone_only_orphans");
      const orphanRow = (depCheck || []).find((r: { auth_user_id: string }) => r.auth_user_id === orphanUserId);
      if (orphanRow?.has_dependent_records) {
        return json({ ok: false, error: "ORPHAN_HAS_DEPENDENT_RECORDS", detail: "Cannot delete: user has meetings, minutes, tasks, or messages" }, 400);
      }

      // 4. Find primary profile with same phone
      const normalizedOrphanPhone = orphanPhone.replace(/^\+/, "");
      const { data: primaryProfile } = await supabase
        .from("profiles")
        .select("user_id, phone, is_active, full_name")
        .eq("is_active", true)
        .filter("phone", "ilike", `%${normalizedOrphanPhone.slice(-10)}%`)
        .maybeSingle();

      if (!primaryProfile) {
        return json({ ok: false, error: "NO_PRIMARY_PROFILE", detail: "No active profile found with matching phone" }, 404);
      }

      // 5. Confirm primary auth user exists
      const { data: primaryAuth, error: primaryAuthErr } = await supabase.auth.admin.getUserById(primaryProfile.user_id);
      if (primaryAuthErr || !primaryAuth?.user) {
        return json({ ok: false, error: "PRIMARY_AUTH_NOT_FOUND" }, 404);
      }

      // 6. Delete the orphan auth user via Admin API
      const { error: deleteErr } = await supabase.auth.admin.deleteUser(orphanUserId);
      if (deleteErr) {
        return json({ ok: false, error: "DELETE_FAILED", detail: deleteErr.message }, 500);
      }

      // 7. Sync phone to primary auth user via raw fetch
      const authBaseUrl = Deno.env.get("SUPABASE_INTERNAL_URL") ?? Deno.env.get("SUPABASE_URL") ?? "http://kong:8000";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      let syncSuccess = false;
      let syncStatus = 0;
      let syncBody = "";

      try {
        const syncResp = await fetch(
          `${authBaseUrl}/auth/v1/admin/users/${primaryProfile.user_id}`,
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "apikey": serviceRoleKey,
              "Authorization": `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({
              phone: `+${normalizedOrphanPhone}`,
              phone_confirm: true,
            }),
            signal: AbortSignal.timeout(10000),
          },
        );
        syncStatus = syncResp.status;
        syncBody = await syncResp.text();
        syncSuccess = syncResp.ok;
      } catch (fetchErr) {
        syncBody = fetchErr instanceof Error ? fetchErr.message : "fetch error";
      }

      // 8. Audit
      try {
        await supabase.from("audit_log").insert({
          user_id: user.id,
          module: "security",
          action: "repair_phone_orphan",
          entity_name: "user",
          entity_id: primaryProfile.user_id,
          details: `Deleted phone-only orphan ${orphanUserId}, synced phone ${maskPhone(normalizedOrphanPhone)} to primary. Sync status: ${syncStatus}`,
          severity: "warning",
        });
      } catch { /* best-effort */ }

      // 9. Record in repair queue
      try {
        await supabase.from("phone_auth_sync_repairs").insert({
          user_id: primaryProfile.user_id,
          related_auth_user_id: orphanUserId,
          operation_type: "repair_phone_orphan",
          masked_phone: maskPhone(normalizedOrphanPhone),
          status: syncSuccess ? "RESOLVED" : "NEEDS_ADMIN_REVIEW",
          last_error_code: syncSuccess ? null : `SYNC_${syncStatus}`,
        });
      } catch { /* best-effort */ }

      return json({
        ok: true,
        orphan_deleted: true,
        primary_user_id: primaryProfile.user_id,
        phone_synced: syncSuccess,
        sync_status: syncStatus,
        sync_body_preview: syncBody.slice(0, 500),
      });
    }

    return json({ ok: false, error: "INVALID_ACTION" }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return json({ ok: false, error: "INTERNAL_ERROR", detail: message }, 500);
  }
});
