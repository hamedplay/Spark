import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const HOOK_DEADLINE_MS = 4500;

function maskPhone(phone: string): string {
  if (!phone || phone.length <= 4) return "***";
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}

function normalizeIranPhone(value?: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;
  return '';
}

function remainingMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

function errorResponse(httpCode: number, message: string) {
  return new Response(
    JSON.stringify({ error: { http_code: httpCode, message } }),
    { status: httpCode, headers: { "Content-Type": "application/json" } },
  );
}

function successResponse() {
  return new Response(
    JSON.stringify({}),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req: Request) => {
  const deadlineAt = Date.now() + HOOK_DEADLINE_MS;

  // ── 0. Build supabase client FIRST ───────────────────────────────────────
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    // ── 1. Standard Webhook signature verification ───────────────────────────
    const secret = Deno.env.get("SEND_SMS_HOOK_SECRET");
    if (!secret) {
      console.log("[auth-send-sms-hook] SEND_SMS_HOOK_SECRET not configured");
      return errorResponse(500, "Hook secret not configured");
    }

    const base64Secret = secret.replace(/^v1,whsec_/, "");
    const rawBody = await req.text();

    const webhook = new Webhook(base64Secret);
    try {
      webhook.verify(rawBody, Object.fromEntries(req.headers));
    } catch {
      console.log("[auth-send-sms-hook] invalid webhook signature");
      return errorResponse(401, "Invalid signature");
    }

    // ── 2. Require webhook-id header ─────────────────────────────────────────
    const webhookId = req.headers.get("webhook-id") || "";
    if (!webhookId) {
      console.log("[auth-send-sms-hook] missing webhook-id header, rejecting");
      return errorResponse(400, "Missing webhook-id header");
    }

    // ── 3. Parse and validate payload ────────────────────────────────────────
    const body = JSON.parse(rawBody);
    const user = body?.user;
    const sms = body?.sms;

    if (!user || !sms) {
      return errorResponse(400, "Invalid hook payload");
    }

    const phone: string | undefined = user.phone;
    const otp: string | undefined = sms.otp;

    if (!phone || !otp) {
      return errorResponse(400, "Invalid hook payload");
    }

    const maskedPhone = maskPhone(phone);

    // ── 4. Atomic idempotency reservation via RPC ───────────────────────────
    let reservation: string;
    try {
      const { data: rpcResult, error: rpcError } = await supabase.rpc(
        "reserve_auth_hook_event",
        { p_webhook_id: webhookId },
      );
      if (rpcError) {
        console.log("[auth-send-sms-hook] idempotency RPC error, fail-closed:", rpcError.message);
        return errorResponse(500, "Idempotency check failed");
      }
      reservation = rpcResult as string;
    } catch (err: any) {
      console.log("[auth-send-sms-hook] idempotency RPC exception, fail-closed:", err?.message);
      return errorResponse(500, "Idempotency check failed");
    }

    if (reservation === "already_sent") {
      console.log("[auth-send-sms-hook] duplicate webhook-id already sent:", webhookId);
      return successResponse();
    }

    if (reservation === "locked") {
      console.log("[auth-send-sms-hook] webhook-id locked (processing):", webhookId);
      return errorResponse(503, "Request already processing");
    }

    // reservation === 'reserved' or 'retry_allowed' → proceed

    // ── 5. Check phone_login_enabled ─────────────────────────────────────────
    const { data: enabledRow, error: enabledErr } = await supabase
      .from("system_config")
      .select("value")
      .eq("section", "security")
      .eq("key", "phone_login_enabled")
      .maybeSingle();

    if (enabledErr) {
      console.log("[auth-send-sms-hook] config query error, fail-closed:", enabledErr.message);
      await supabase.rpc("fail_auth_hook_event", { p_webhook_id: webhookId, p_error_code: "CONFIG_ERROR" });
      return errorResponse(500, "Configuration check failed");
    }

    const phoneLoginEnabled = enabledRow?.value === "true";
    if (!phoneLoginEnabled) {
      console.log("[auth-send-sms-hook] phone_login disabled, rejecting", maskedPhone);
      await supabase.rpc("fail_auth_hook_event", { p_webhook_id: webhookId, p_error_code: "LOGIN_DISABLED" });
      return errorResponse(403, "Phone login is disabled");
    }

    // ── 6. Read selected provider ID ─────────────────────────────────────────
    const { data: providerRow, error: providerErr } = await supabase
      .from("system_config")
      .select("value")
      .eq("section", "sms")
      .eq("key", "phone_login_sms_provider_id")
      .maybeSingle();

    if (providerErr) {
      console.log("[auth-send-sms-hook] provider config error, fail-closed:", providerErr.message);
      await supabase.rpc("fail_auth_hook_event", { p_webhook_id: webhookId, p_error_code: "PROVIDER_CONFIG_ERROR" });
      return errorResponse(503, "SMS provider unavailable");
    }

    const providerId = providerRow?.value;
    if (!providerId) {
      console.log("[auth-send-sms-hook] no provider selected, rejecting", maskedPhone);
      await supabase.rpc("fail_auth_hook_event", { p_webhook_id: webhookId, p_error_code: "NO_PROVIDER" });
      return errorResponse(503, "SMS provider unavailable");
    }

    // ── 7. Check provider is active ──────────────────────────────────────────
    const { data: provider, error: provErr } = await supabase
      .from("sms_providers")
      .select("id, is_active")
      .eq("id", providerId)
      .maybeSingle();

    if (provErr || !provider || !provider.is_active) {
      console.log("[auth-send-sms-hook] provider inactive, rejecting", maskedPhone);
      await supabase.rpc("fail_auth_hook_event", { p_webhook_id: webhookId, p_error_code: "PROVIDER_INACTIVE" });
      return errorResponse(503, "SMS provider unavailable");
    }

    // ── 8. Read auth/login_otp template ──────────────────────────────────────
    const { data: template } = await supabase
      .from("sms_templates")
      .select("body, is_active")
      .eq("category", "auth")
      .eq("event_type", "login_otp")
      .eq("audience", "all")
      .maybeSingle();

    let message: string;
    if (template?.is_active && template?.body && /\{\{\s*otp\s*\}\}/.test(template.body)) {
      message = template.body.replace(/\{\{\s*otp\s*\}\}/g, otp);
    } else {
      message = `کد ورود شما به سامانه اسپارک: ${otp}\nاین کد را در اختیار دیگران قرار ندهید.`;
    }

    // ── 9. Normalize phone ───────────────────────────────────────────────────
    const normalizedPhone = normalizeIranPhone(phone);
    if (!normalizedPhone) {
      console.log("[auth-send-sms-hook] invalid phone format, rejecting", maskedPhone);
      await supabase.rpc("fail_auth_hook_event", { p_webhook_id: webhookId, p_error_code: "INVALID_PHONE" });
      return errorResponse(400, "Invalid phone format");
    }

    // ── 10. Check deadline before dispatching to provider ────────────────────
    const timeoutMs = Math.min(2500, remainingMs(deadlineAt) - 300);
    if (timeoutMs <= 0) {
      console.log("[auth-send-sms-hook] hook deadline exceeded before provider dispatch");
      await supabase.rpc("fail_auth_hook_event", { p_webhook_id: webhookId, p_error_code: "DEADLINE_EXCEEDED" });
      return errorResponse(504, "Hook deadline exceeded");
    }

    // ── 11. Dispatch via send-sms engine (auth_otp mode, single hop) ──────────
    const providerController = new AbortController();
    const providerTimer = setTimeout(() => providerController.abort(), timeoutMs);

    try {
      const sendResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
          },
          body: JSON.stringify({
            mode: "auth_otp",
            providerId,
            mobiles: [normalizedPhone],
            message,
          }),
          signal: providerController.signal,
        },
      );

      clearTimeout(providerTimer);
      const result = await sendResp.json();

      if (!result.ok) {
        await supabase.rpc("fail_auth_hook_event", { p_webhook_id: webhookId, p_error_code: "PROVIDER_ERROR" });
        await supabase.from("sms_dispatch_logs").insert({
          target_phone: normalizedPhone,
          category: "auth",
          event_type: "login_otp",
          audience: "all",
          message: "[AUTH_OTP_REDACTED]",
          status: "failed",
          error_text: "PROVIDER_ERROR",
          provider_id: providerId,
        });
        console.log("[auth-send-sms-hook] dispatch failed for", maskedPhone);
        return errorResponse(502, "SMS dispatch failed");
      }

      // Mark as sent — if complete RPC fails, try sent_unconfirmed.
      // If both RPCs fail, return success anyway so GoTrue does NOT retry
      // (preventing duplicate SMS). The event stays in 'processing' with
      // its 5-minute lock, so a retry before lock expiry returns 'locked'.
      // Exactly-once for an external provider is not absolute, but
      // immediate duplicate delivery is controlled.
      const { error: completeErr } = await supabase.rpc(
        "complete_auth_hook_event",
        { p_webhook_id: webhookId },
      );
      if (completeErr) {
        console.log("[auth-send-sms-hook] complete_auth_hook_event failed, attempting sent_unconfirmed");
        const { error: markErr } = await supabase.rpc(
          "mark_sent_unconfirmed_auth_hook_event",
          { p_webhook_id: webhookId },
        );
        if (markErr) {
          // Both RPCs failed — log operational error (no OTP, no full phone)
          // and return success so GoTrue does not retry.
          console.log("[auth-send-sms-hook] both complete and mark RPCs failed; event remains processing with lock");
          await supabase.from("sms_dispatch_logs").insert({
            target_phone: "[REDACTED]",
            category: "auth",
            event_type: "login_otp",
            audience: "all",
            message: "[AUTH_OTP_REDACTED]",
            status: "sent_unconfirmed",
            error_text: "COMPLETE_AND_MARK_RPC_FAILED",
            provider_id: providerId,
          });
        }
      }

      await supabase.from("sms_dispatch_logs").insert({
        target_phone: normalizedPhone,
        category: "auth",
        event_type: "login_otp",
        audience: "all",
        message: "[AUTH_OTP_REDACTED]",
        status: "sent",
        provider_id: providerId,
        pack_id: result.packId ?? null,
        message_ids: result.messageIds ?? null,
      });

      console.log("[auth-send-sms-hook] OTP dispatched for", maskedPhone);
      return successResponse();

    } catch (providerErr: any) {
      clearTimeout(providerTimer);
      const isTimeout = providerErr?.name === "AbortError";
      console.log("[auth-send-sms-hook] provider error:", isTimeout ? "timeout" : "error");
      await supabase.rpc("fail_auth_hook_event", { p_webhook_id: webhookId, p_error_code: isTimeout ? "PROVIDER_TIMEOUT" : "PROVIDER_EXCEPTION" });
      return errorResponse(isTimeout ? 504 : 502, isTimeout ? "Provider timeout" : "SMS dispatch failed");
    }

  } catch (err: any) {
    const isTimeout = err?.name === "AbortError";
    console.log("[auth-send-sms-hook] error:", isTimeout ? "timeout" : "internal_error");
    return errorResponse(isTimeout ? 504 : 500, isTimeout ? "Hook timeout" : "Internal error");
  }
});
