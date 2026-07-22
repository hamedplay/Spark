import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const HOOK_TIMEOUT_MS = 12000;

function maskPhone(phone: string): string {
  if (!phone || phone.length <= 4) return "***";
  return phone.slice(0, 3) + "****" + phone.slice(-4);
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0098")) return digits.slice(2);
  if (digits.startsWith("98") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return "98" + digits.slice(1);
  if (digits.length === 10) return "98" + digits;
  return digits;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HOOK_TIMEOUT_MS);

  try {
    // ── 1. Validate Auth Hook signature ──────────────────────────────────────
    // Supabase Auth Hooks send a Bearer JWT in the Authorization header.
    // For HTTP Send SMS Hook, GoTrue sends the anon key as a Bearer token.
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "Missing or invalid Authorization header" }, 401);
    }
    const token = authHeader.slice(7);

    // Accept either the service role key or the anon key (GoTrue sends anon key)
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const isServiceKey = serviceKey.length > 0 && token === serviceKey;
    const isAnonKey = anonKey.length > 0 && token === anonKey;

    if (!isServiceKey && !isAnonKey) {
      return json({ error: "Invalid auth hook signature" }, 401);
    }

    // ── 2. Parse and validate payload ───────────────────────────────────────
    const body = await req.json();

    // Supabase Auth Send SMS Hook payload structure:
    // {
    //   "event": "Sms",
    //   "user": { "id": "...", "phone": "+98...", ... },
    //   "sms": { "otp": "123456", ... }
    // }
    const event = body?.event;
    const user = body?.user;
    const sms = body?.sms;

    if (!user || !sms) {
      return json({ error: "Invalid hook payload: missing user or sms" }, 400);
    }

    const phone: string | undefined = user.phone;
    const otp: string | undefined = sms.otp;

    if (!phone || !otp) {
      return json({ error: "Invalid hook payload: missing phone or otp" }, 400);
    }

    const maskedPhone = maskPhone(phone);

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
      console.log("[auth-send-sms-hook] phone_login_enabled=false, rejecting OTP for", maskedPhone);
      return json({ error: "Phone login is disabled" }, 403);
    }

    // ── 4. Read selected provider ID ────────────────────────────────────────
    const { data: providerRow } = await supabase
      .from("system_config")
      .select("value")
      .eq("section", "sms")
      .eq("key", "phone_login_sms_provider_id")
      .maybeSingle();

    const providerId = providerRow?.value;
    if (!providerId) {
      console.log("[auth-send-sms-hook] no provider selected for phone login, rejecting OTP for", maskedPhone);
      return json({ error: "No SMS provider configured for phone login" }, 503);
    }

    // ── 5. Check provider is active ──────────────────────────────────────────
    const { data: provider } = await supabase
      .from("sms_providers")
      .select("id, is_active")
      .eq("id", providerId)
      .maybeSingle();

    if (!provider || !provider.is_active) {
      console.log("[auth-send-sms-hook] selected provider inactive, rejecting OTP for", maskedPhone);
      return json({ error: "Selected SMS provider is inactive" }, 503);
    }

    // ── 6. Read auth/login_otp template ──────────────────────────────────────
    const { data: template } = await supabase
      .from("notification_templates")
      .select("body, is_active")
      .eq("category", "auth")
      .eq("event_type", "login_otp")
      .eq("audience", "all")
      .maybeSingle();

    let message: string;
    if (template?.is_active && template?.body) {
      message = template.body.replace(/\{\{\s*otp\s*\}\}/g, otp);
    } else {
      // Secure fallback — never expose OTP in logs
      message = `کد ورود شما به سامانه اسپارک: ${otp}\nاین کد را در اختیار دیگران قرار ندهید.`;
    }

    // ── 7. Dispatch via existing send-sms engine ─────────────────────────────
    const normalizedPhone = normalizePhone(phone);

    const sendResp = await fetch(
      `${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
        },
        body: JSON.stringify({
          mode: "send",
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
      // Log redacted error — never log OTP, credentials, or full message
      await supabase.from("sms_dispatch_logs").insert({
        target_phone: normalizedPhone,
        category: "auth",
        event_type: "login_otp",
        audience: "all",
        message: "[AUTH_OTP_REDACTED]",
        status: "failed",
        error_text: `PROVIDER_ERROR: ${result.error ?? "خطای ناشناخته"}`,
        provider_id: providerId,
      });
      console.log("[auth-send-sms-hook] SMS dispatch failed for", maskedPhone, "- error:", result.error ?? "unknown");
      // Return error so GoTrue does NOT treat OTP as sent
      return json({ error: "SMS dispatch failed" }, 502);
    }

    // Log success with redacted message
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

    console.log("[auth-send-sms-hook] OTP SMS dispatched for", maskedPhone);
    return json({ ok: true });

  } catch (err: any) {
    clearTimeout(timer);
    // Never log OTP or credentials in error
    console.log("[auth-send-sms-hook] error:", err?.name === "AbortError" ? "timeout" : "internal_error");
    return json({ error: "Internal error" }, 500);
  }
});
