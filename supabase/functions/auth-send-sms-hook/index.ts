import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const HOOK_TIMEOUT_MS = 4000;

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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOOK_TIMEOUT_MS);

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
    let verified: unknown;
    try {
      verified = webhook.verify(rawBody, Object.fromEntries(req.headers));
    } catch {
      console.log("[auth-send-sms-hook] invalid webhook signature");
      return errorResponse(401, "Invalid signature");
    }

    // ── 2. Parse and validate payload ────────────────────────────────────────
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

    // ── 2b. Idempotency: check webhook-id ────────────────────────────────────
    const webhookId = req.headers.get("webhook-id") || "";
    if (webhookId) {
      const { data: existing } = await supabase
        .from("auth_hook_events")
        .select("webhook_id")
        .eq("webhook_id", webhookId)
        .maybeSingle();
      if (existing) {
        console.log("[auth-send-sms-hook] duplicate webhook-id, skipping", webhookId);
        return successResponse();
      }
      await supabase.from("auth_hook_events").insert({
        webhook_id: webhookId,
        event_type: "send_sms",
      });
    }

    // ── 3. Check phone_login_enabled ─────────────────────────────────────────
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: enabledRow } = await supabase
      .from("system_config")
      .select("value")
      .eq("section", "security")
      .eq("key", "phone_login_enabled")
      .maybeSingle();

    const phoneLoginEnabled = enabledRow?.value === "true";
    if (!phoneLoginEnabled) {
      console.log("[auth-send-sms-hook] phone_login disabled, rejecting", maskedPhone);
      return errorResponse(403, "Phone login is disabled");
    }

    // ── 4. Read selected provider ID ─────────────────────────────────────────
    const { data: providerRow } = await supabase
      .from("system_config")
      .select("value")
      .eq("section", "sms")
      .eq("key", "phone_login_sms_provider_id")
      .maybeSingle();

    const providerId = providerRow?.value;
    if (!providerId) {
      console.log("[auth-send-sms-hook] no provider selected, rejecting", maskedPhone);
      return errorResponse(503, "SMS provider unavailable");
    }

    // ── 5. Check provider is active ──────────────────────────────────────────
    const { data: provider } = await supabase
      .from("sms_providers")
      .select("id, is_active")
      .eq("id", providerId)
      .maybeSingle();

    if (!provider || !provider.is_active) {
      console.log("[auth-send-sms-hook] provider inactive, rejecting", maskedPhone);
      return errorResponse(503, "SMS provider unavailable");
    }

    // ── 6. Read auth/login_otp template from sms_templates ────────────────────
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

    // ── 7. Dispatch via send-sms engine (auth_otp mode) ───────────────────────
    const normalizedPhone = normalizeIranPhone(phone);
    if (!normalizedPhone) {
      console.log("[auth-send-sms-hook] invalid phone format, rejecting", maskedPhone);
      return errorResponse(400, "Invalid phone format");
    }

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
        signal: controller.signal,
      },
    );

    clearTimeout(timer);
    const result = await sendResp.json();

    if (!result.ok) {
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

  } catch (err: any) {
    clearTimeout(timer);
    const isTimeout = err?.name === "AbortError";
    console.log("[auth-send-sms-hook] error:", isTimeout ? "timeout" : "internal_error");
    return errorResponse(isTimeout ? 504 : 500, isTimeout ? "Hook timeout" : "Internal error");
  }
});
