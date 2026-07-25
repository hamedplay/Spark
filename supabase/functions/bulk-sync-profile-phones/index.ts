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

    const body = await req.json();
    const mode: string = body.mode || "dry_run";

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

      const authBaseUrl = Deno.env.get("SUPABASE_INTERNAL_URL") ?? Deno.env.get("SUPABASE_URL") ?? "http://kong:8000";
      const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const results: Array<{
        user_id: string;
        masked_phone: string;
        success: boolean;
        status: number;
        error: string | null;
      }> = [];

      for (const row of safeToSync) {
        const r = row as { user_id: string; masked_phone: string };
        // Fetch profile phone
        const { data: profile } = await supabase
          .from("profiles").select("phone").eq("user_id", r.user_id).maybeSingle();

        if (!profile?.phone) {
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
            results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: true, status: syncResp.status, error: null });

            // Audit
            try {
              await supabase.from("audit_log").insert({
                user_id: user.id,
                module: "security",
                action: "bulk_sync_profile_phone",
                entity_name: "user",
                entity_id: r.user_id,
                details: `Bulk sync phone ${maskPhone(normalized)} to auth`,
                severity: "info",
              });
            } catch { /* best-effort */ }
          } else {
            const errBody = await syncResp.text();
            results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: syncResp.status, error: errBody.slice(0, 200) });

            // Record in repair queue
            try {
              await supabase.from("phone_auth_sync_repairs").insert({
                user_id: r.user_id,
                operation_type: "sync_profile_phone",
                masked_phone: maskPhone(normalized),
                status: "NEEDS_ADMIN_REVIEW",
                last_error_code: `HTTP_${syncResp.status}`,
              });
            } catch { /* best-effort */ }
          }
        } catch (fetchErr) {
          const errMsg = fetchErr instanceof Error ? fetchErr.message : "fetch error";
          results.push({ user_id: r.user_id, masked_phone: maskPhone(normalized), success: false, status: 0, error: errMsg });

          try {
            await supabase.from("phone_auth_sync_repairs").insert({
              user_id: r.user_id,
              operation_type: "sync_profile_phone",
              masked_phone: maskPhone(normalized),
              status: "NEEDS_ADMIN_REVIEW",
              last_error_code: "FETCH_ERROR",
            });
          } catch { /* best-effort */ }
        }
      }

      const succeeded = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;

      return json({ ok: true, mode: "execute", total: safeToSync.length, succeeded, failed, results });
    }

    return json({ ok: false, error: "INVALID_MODE" }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal error";
    return json({ ok: false, error: "INTERNAL_ERROR", detail: message }, 500);
  }
});
