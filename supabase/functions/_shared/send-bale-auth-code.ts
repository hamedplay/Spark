import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type BaleAuthCodePurpose = "phone_login" | "phone_password_recovery";

export interface SendBaleAuthCodeOptions {
  supabase: SupabaseClient;
  userId: string;
  otp: string;
  purpose: BaleAuthCodePurpose;
  eventRef: string;
}

export interface BaleAuthCodeResult {
  status: "sent" | "failed" | "skipped";
  reason?: string;
}

const BALE_API_TIMEOUT_MS = 2000;

function eventRefPrefix(ref: string): string {
  return ref.slice(0, 8);
}

function sanitizeErrorCode(status: number, bodyText: string): string {
  const lower = bodyText.toLowerCase();
  if (lower.includes("chat not found")) return "CHAT_NOT_FOUND";
  if (lower.includes("bot was blocked") || lower.includes("blocked")) return "BOT_BLOCKED";
  if (lower.includes("forbidden")) return "FORBIDDEN";
  if (status === 400) return "BALE_HTTP_400";
  if (status === 401) return "BALE_HTTP_401";
  if (status === 403) return "BALE_HTTP_403";
  if (status >= 500) return `BALE_HTTP_${status}`;
  return `BALE_HTTP_${status}`;
}

export async function sendBaleAuthCode(options: SendBaleAuthCodeOptions): Promise<BaleAuthCodeResult> {
  const { supabase, userId, otp, purpose, eventRef } = options;

  try {
    // 1. Reserve dispatch with idempotency
    const { data: insertData, error: insertError } = await supabase
      .from("bale_auth_code_dispatches")
      .insert({
        event_ref: eventRef,
        purpose,
        user_id: userId,
        status: "processing",
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
      // Unique constraint violation = duplicate
      if (insertError.code === "23505") {
        console.log("[send-bale-auth-code] duplicate dispatch skipped", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
          userId,
        });
        return { status: "skipped", reason: "duplicate" };
      }
      console.log("[send-bale-auth-code] dispatch reserve error", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
        error: "DB_INSERT_ERROR",
      });
      return { status: "failed", reason: "db_error" };
    }

    const dispatchId = insertData?.id;
    if (!dispatchId) {
      return { status: "failed", reason: "no_dispatch_id" };
    }

    // 2. Read Bale channel config
    const { data: cfg, error: cfgErr } = await supabase
      .from("social_channel_configs")
      .select("bot_token, is_active")
      .eq("channel", "bale")
      .maybeSingle();

    if (cfgErr || !cfg || !cfg.is_active) {
      await finalizeDispatch(supabase, dispatchId, "skipped", "BALE_INACTIVE");
      console.log("[send-bale-auth-code] bale inactive", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "bale_inactive" };
    }

    const botToken = (cfg.bot_token ?? "").trim();
    if (!botToken) {
      await finalizeDispatch(supabase, dispatchId, "skipped", "NO_BOT_TOKEN");
      console.log("[send-bale-auth-code] no bot token", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "no_bot_token" };
    }

    // 3. Read user mapping
    const { data: mapping, error: mapErr } = await supabase
      .from("user_bale_mapping")
      .select("bale_chat_id, auth_codes_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if (mapErr) {
      await finalizeDispatch(supabase, dispatchId, "failed", "DB_MAPPING_ERROR");
      console.log("[send-bale-auth-code] mapping query error", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "failed", reason: "db_error" };
    }

    if (!mapping?.bale_chat_id) {
      await finalizeDispatch(supabase, dispatchId, "skipped", "NOT_LINKED");
      console.log("[send-bale-auth-code] not linked", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "not_linked" };
    }

    // 4. Check user preference
    if (mapping.auth_codes_enabled === false) {
      await finalizeDispatch(supabase, dispatchId, "skipped", "USER_DISABLED");
      console.log("[send-bale-auth-code] user disabled auth codes", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "user_disabled" };
    }

    // 5. Read template
    const templateEventType =
      purpose === "phone_login" ? "login_otp_bale" : "password_reset_otp_bale";

    const { data: template } = await supabase
      .from("notification_templates")
      .select("body, is_active")
      .eq("category", "auth")
      .eq("event_type", templateEventType)
      .eq("audience", "all")
      .maybeSingle();

    if (!template?.is_active || !template?.body || !/\{\{\s*otp\s*\}\}/.test(template.body)) {
      await finalizeDispatch(supabase, dispatchId, "skipped", "TEMPLATE_INACTIVE");
      console.log("[send-bale-auth-code] template inactive", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "template_inactive" };
    }

    const messageBody = template.body.replace(/\{\{\s*otp\s*\}\}/g, otp);

    // 6. Send to Bale API
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BALE_API_TIMEOUT_MS);

    try {
      const baleResp = await fetch(`https://tapi.bale.ai/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: mapping.bale_chat_id,
          text: messageBody,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!baleResp.ok) {
        const errBody = await baleResp.text().catch(() => "");
        const errorCode = sanitizeErrorCode(baleResp.status, errBody);
        await finalizeDispatch(supabase, dispatchId, "failed", errorCode);
        await updateMappingStatus(supabase, userId, "failed", errorCode);
        console.log("[send-bale-auth-code] bale API error", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
          userId,
          httpStatus: baleResp.status,
          errorCode,
        });
        return { status: "failed", reason: "api_error" };
      }

      await finalizeDispatch(supabase, dispatchId, "sent", undefined);
      await updateMappingStatus(supabase, userId, "sent", undefined);
      console.log("[send-bale-auth-code] sent", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "sent" };

    } catch (fetchErr: any) {
      clearTimeout(timer);
      const isTimeout = fetchErr?.name === "AbortError";
      const errorCode = isTimeout ? "BALE_TIMEOUT" : "BALE_NETWORK_ERROR";
      await finalizeDispatch(supabase, dispatchId, "failed", errorCode);
      await updateMappingStatus(supabase, userId, "failed", errorCode);
      console.log("[send-bale-auth-code] fetch error", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
        errorCode,
      });
      return { status: "failed", reason: "network_error" };
    }

  } catch (err: any) {
    console.log("[send-bale-auth-code] unexpected error", {
      purpose,
      eventRef: eventRefPrefix(eventRef),
      userId,
      errorCode: "INTERNAL_ERROR",
    });
    return { status: "failed", reason: "internal_error" };
  }
}

async function finalizeDispatch(
  supabase: SupabaseClient,
  dispatchId: string,
  status: "sent" | "failed" | "skipped",
  errorCode?: string,
): Promise<void> {
  try {
    await supabase
      .from("bale_auth_code_dispatches")
      .update({
        status,
        completed_at: new Date().toISOString(),
        error_code: errorCode ?? null,
      })
      .eq("id", dispatchId);
  } catch {
    // best-effort
  }
}

async function updateMappingStatus(
  supabase: SupabaseClient,
  userId: string,
  status: "sent" | "failed",
  errorCode?: string,
): Promise<void> {
  try {
    await supabase
      .from("user_bale_mapping")
      .update({
        last_auth_code_delivery_at: new Date().toISOString(),
        last_auth_code_delivery_status: status,
        last_auth_code_delivery_error: errorCode ?? null,
      })
      .eq("user_id", userId);
  } catch {
    // best-effort
  }
}
