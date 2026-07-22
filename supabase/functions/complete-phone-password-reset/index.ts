import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

async function hmacHash(value: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function getClientIP(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  if (!first) return "unknown";
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(first)) return first;
  if (/^[0-9a-fA-F:]+$/.test(first) && first.includes(":")) return first;
  return "unknown";
}

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin || "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

const TARGET_MIN_MS = 1500;
const TARGET_MAX_MS = 1700;

const GENERIC_ERROR = JSON.stringify({ ok: false, error: "INVALID_OR_EXPIRED_CODE" });

async function finishResponse(
  startedAt: number,
  response: Response,
  cors: Record<string, string>,
): Promise<Response> {
  const elapsed = Date.now() - startedAt;
  const jitter = Math.floor(Math.random() * (TARGET_MAX_MS - TARGET_MIN_MS + 1));
  const target = TARGET_MIN_MS + jitter;
  if (elapsed < target) {
    await new Promise(resolve => setTimeout(resolve, target - elapsed));
  }
  return new Response(response.body, {
    status: response.status,
    headers: { ...response.headers, ...cors },
  });
}

function genericErrorResponse(cors: Record<string, string>): Response {
  return new Response(GENERIC_ERROR,
    { status: 400, headers: { "Content-Type": "application/json", ...cors } });
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let allowedOrigin: string | null = null;
  try {
    const allowedStr = Deno.env.get("PHONE_LOGIN_ALLOWED_ORIGINS") || "";
    const allowed = allowedStr.split(",").map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get("Origin") || "";
    if (origin && allowed.includes(origin)) allowedOrigin = origin;
  } catch { /* fail-closed */ }

  const cors = corsHeaders(allowedOrigin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }

  if (req.method !== "POST") {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }

  const contentType = req.headers.get("Content-Type") || "";
  if (!contentType.includes("application/json")) {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }

  let bodyText: string;
  try {
    bodyText = await req.text();
  } catch {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }
  if (bodyText.length > 4096) {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }

  try {
    if (!allowedOrigin) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    let body: { challenge_id?: string; reset_token?: string; new_password?: string };
    try {
      body = JSON.parse(bodyText);
    } catch {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    const challengeId: string | undefined = body.challenge_id;
    const resetToken: string | undefined = body.reset_token;
    const newPassword: string | undefined = body.new_password;

    if (!challengeId || !resetToken || !newPassword) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Password validation
    if (newPassword.length < 8 || newPassword.length > 128) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    if (!/(?=.*[a-zA-Z])(?=.*\d)/.test(newPassword)) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Resolve secret
    const secret = Deno.env.get("PHONE_PASSWORD_RESET_SECRET") || "";
    if (!secret || secret.length < 32) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Atomic IP rate limit
    const clientIP = getClientIP(req);
    const ipHash = await hmacHash(clientIP, secret);
    const { data: rlData, error: rlErr } = await supabase.rpc(
      "consume_phone_password_recovery_complete_limit",
      {
        p_ip_hash: ipHash,
        p_purpose: "phone_password_recovery_complete",
        p_ip_limit: 10,
        p_window_seconds: 900,
      },
    );
    if (rlErr || !rlData) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    const rlRow = Array.isArray(rlData) ? rlData[0] : rlData;
    if (!rlRow?.allowed) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Compute reset token hash
    const providedResetTokenHash = await hmacHash(resetToken, secret);

    // Generate claim_id
    const claimId = crypto.randomUUID();

    // Atomic claim: verified → processing
    const { data: claimData, error: claimErr } = await supabase.rpc(
      "claim_phone_password_reset_completion",
      {
        p_challenge_id: challengeId,
        p_provided_reset_token_hash: providedResetTokenHash,
        p_claim_id: claimId,
      },
    );
    if (claimErr || !claimData) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    const claimRow = Array.isArray(claimData) ? claimData[0] : claimData;
    if (!claimRow?.success || !claimRow?.user_id) {
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    const targetUserId = claimRow.user_id;

    // Revalidate auth/profile before changing password
    const { data: revData, error: revErr } = await supabase.rpc(
      "revalidate_phone_password_reset_target",
      {
        p_user_id: targetUserId,
        p_expected_phone_hash: "",
      },
    );
    if (revErr || !revData) {
      // Release claim on failure
      await supabase.rpc("finalize_phone_password_reset_completion", {
        p_challenge_id: challengeId,
        p_claim_id: claimId,
        p_success: false,
      });
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }
    const revRow = Array.isArray(revData) ? revData[0] : revData;
    if (!revRow?.valid) {
      await supabase.rpc("finalize_phone_password_reset_completion", {
        p_challenge_id: challengeId,
        p_claim_id: claimId,
        p_success: false,
      });
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Change password server-side using admin API
    const { error: updatePasswordErr } = await supabase.auth.admin.updateUserById(
      targetUserId,
      { password: newPassword },
    );

    if (updatePasswordErr) {
      // Release claim: back to verified, increment attempt
      await supabase.rpc("finalize_phone_password_reset_completion", {
        p_challenge_id: challengeId,
        p_claim_id: claimId,
        p_success: false,
      });
      return await finishResponse(startedAt, genericErrorResponse(cors), cors);
    }

    // Finalize as consumed
    const { data: finData, error: finErr } = await supabase.rpc(
      "finalize_phone_password_reset_completion",
      {
        p_challenge_id: challengeId,
        p_claim_id: claimId,
        p_success: true,
      },
    );

    if (finErr || !finData) {
      // Password was changed but finalize failed
      // Challenge stays in processing — no rollback to verified
      // Return success to user since password was likely changed
      // Log operational error
      try {
        await supabase.from("audit_logs").insert({
          module: "auth",
          action: "phone_password_recovery_finalize_failed",
          entity_name: "user",
          entity_id: targetUserId,
          details: "Finalize failed after password change — challenge stuck in processing",
          severity: "error",
        });
      } catch { /* audit failure should not block */ }

      // Return success — password was changed
      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: true }),
          { status: 200, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    const finRow = Array.isArray(finData) ? finData[0] : finData;
    if (!finRow?.success) {
      // Finalize failed (claim mismatch etc.) — but password was changed
      try {
        await supabase.from("audit_logs").insert({
          module: "auth",
          action: "phone_password_recovery_finalize_failed",
          entity_name: "user",
          entity_id: targetUserId,
          details: "Finalize returned failure after password change",
          severity: "error",
        });
      } catch { /* audit failure should not block */ }

      return await finishResponse(startedAt,
        new Response(JSON.stringify({ ok: true }),
          { status: 200, headers: { "Content-Type": "application/json", ...cors } }), cors);
    }

    // Audit log (no password, no phone, no token)
    try {
      await supabase.from("audit_logs").insert({
        module: "auth",
        action: "phone_password_recovery",
        entity_name: "user",
        entity_id: targetUserId,
        details: "بازیابی رمز با شماره موبایل",
        severity: "info",
      });
    } catch { /* audit failure should not block */ }

    // Success — no session, no token returned
    return await finishResponse(startedAt,
      new Response(JSON.stringify({ ok: true }),
        { status: 200, headers: { "Content-Type": "application/json", ...cors } }), cors);

  } catch {
    return await finishResponse(startedAt, genericErrorResponse(cors), cors);
  }
});
