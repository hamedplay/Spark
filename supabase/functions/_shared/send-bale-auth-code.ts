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
  persistFailed?: boolean;
}

const BALE_API_TIMEOUT_MS = 2000;
const PROCESSING_TTL_MINUTES = 5;

function eventRefPrefix(ref: string): string {
  return ref.slice(0, 8);
}

function purposeConfigKey(purpose: BaleAuthCodePurpose): string {
  return purpose === "phone_login"
    ? "phone_login_bale_otp_enabled"
    : "phone_password_recovery_bale_otp_enabled";
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
    // 1. Check global config for this purpose FIRST (before any dispatch reservation)
    const configKey = purposeConfigKey(purpose);
    const { data: cfgRow, error: cfgErr } = await supabase
      .from("system_config")
      .select("value")
      .eq("section", "security")
      .eq("key", configKey)
      .maybeSingle();

    if (cfgErr || !cfgRow || cfgRow.value !== "true") {
      console.log("[send-bale-auth-code] global config disabled or query failed", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "global_disabled" };
    }

    // 2. Reserve dispatch with idempotency + processing TTL
    const processingExpiresAt = new Date(Date.now() + PROCESSING_TTL_MINUTES * 60 * 1000).toISOString();

    const { data: insertData, error: insertError } = await supabase
      .from("bale_auth_code_dispatches")
      .insert({
        event_ref: eventRef,
        purpose,
        user_id: userId,
        status: "processing",
        processing_expires_at: processingExpiresAt,
      })
      .select("id")
      .maybeSingle();

    if (insertError) {
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

    // 3. Read Bale channel config
    const { data: baleCfg, error: baleCfgErr } = await supabase
      .from("social_channel_configs")
      .select("bot_token, is_active")
      .eq("channel", "bale")
      .maybeSingle();

    if (baleCfgErr || !baleCfg || !baleCfg.is_active) {
      const persisted = await finalizeDispatch(supabase, dispatchId, "skipped", "BALE_INACTIVE");
      if (!persisted) {
        console.log("[send-bale-auth-code] STATUS_PERSIST_FAILED", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
        });
      }
      console.log("[send-bale-auth-code] bale inactive", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "bale_inactive" };
    }

    const botToken = (baleCfg.bot_token ?? "").trim();
    if (!botToken) {
      const persisted = await finalizeDispatch(supabase, dispatchId, "skipped", "NO_BOT_TOKEN");
      if (!persisted) {
        console.log("[send-bale-auth-code] STATUS_PERSIST_FAILED", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
        });
      }
      console.log("[send-bale-auth-code] no bot token", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "no_bot_token" };
    }

    // 4. Read user mapping
    const { data: mapping, error: mapErr } = await supabase
      .from("user_bale_mapping")
      .select("bale_chat_id, auth_codes_enabled")
      .eq("user_id", userId)
      .maybeSingle();

    if (mapErr) {
      const persisted = await finalizeDispatch(supabase, dispatchId, "failed", "DB_MAPPING_ERROR");
      if (!persisted) {
        console.log("[send-bale-auth-code] STATUS_PERSIST_FAILED", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
        });
      }
      console.log("[send-bale-auth-code] mapping query error", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "failed", reason: "db_error" };
    }

    if (!mapping?.bale_chat_id) {
      const persisted = await finalizeDispatch(supabase, dispatchId, "skipped", "NOT_LINKED");
      if (!persisted) {
        console.log("[send-bale-auth-code] STATUS_PERSIST_FAILED", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
        });
      }
      console.log("[send-bale-auth-code] not linked", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "not_linked" };
    }

    // 5. Check user preference
    if (mapping.auth_codes_enabled === false) {
      const persisted = await finalizeDispatch(supabase, dispatchId, "skipped", "USER_DISABLED");
      if (!persisted) {
        console.log("[send-bale-auth-code] STATUS_PERSIST_FAILED", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
        });
      }
      console.log("[send-bale-auth-code] user disabled auth codes", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "user_disabled" };
    }

    // 6. Read template
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
      const persisted = await finalizeDispatch(supabase, dispatchId, "skipped", "TEMPLATE_INACTIVE");
      if (!persisted) {
        console.log("[send-bale-auth-code] STATUS_PERSIST_FAILED", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
        });
      }
      console.log("[send-bale-auth-code] template inactive", {
        purpose,
        eventRef: eventRefPrefix(eventRef),
        userId,
      });
      return { status: "skipped", reason: "template_inactive" };
    }

    const messageBody = template.body.replace(/\{\{\s*otp\s*\}\}/g, otp);

    // 7. Send to Bale API
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

      // 8. Validate response thoroughly
      const responseText = await baleResp.text();

      let responseBody: unknown = null;
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = null;
      }

      const ok =
        baleResp.ok === true &&
        typeof responseBody === "object" &&
        responseBody !== null &&
        (responseBody as any).ok === true;

      if (!ok) {
        const errorCode = !baleResp.ok
          ? sanitizeErrorCode(baleResp.status, responseText)
          : "BALE_INVALID_RESPONSE";
        const dispatchPersisted = await finalizeDispatch(supabase, dispatchId, "failed", errorCode);
        const mappingPersisted = await updateMappingStatus(supabase, userId, "failed", errorCode);
        if (!dispatchPersisted || !mappingPersisted) {
          console.log("[send-bale-auth-code] STATUS_PERSIST_FAILED", {
            purpose,
            eventRef: eventRefPrefix(eventRef),
          });
        }
        console.log("[send-bale-auth-code] bale API invalid response", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
          userId,
          httpStatus: baleResp.status,
          errorCode,
        });
        return { status: "failed", reason: "api_error" };
      }

      const dispatchPersisted = await finalizeDispatch(supabase, dispatchId, "sent", undefined);
      const mappingPersisted = await updateMappingStatus(supabase, userId, "sent", undefined);

      if (!dispatchPersisted || !mappingPersisted) {
        console.log("[send-bale-auth-code] STATUS_PERSIST_FAILED", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
        });
        console.log("[send-bale-auth-code] sent (persist failed)", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
          userId,
        });
        return { status: "sent", reason: "status_persist_failed", persistFailed: true };
      }

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
      const dispatchPersisted = await finalizeDispatch(supabase, dispatchId, "failed", errorCode);
      const mappingPersisted = await updateMappingStatus(supabase, userId, "failed", errorCode);
      if (!dispatchPersisted || !mappingPersisted) {
        console.log("[send-bale-auth-code] STATUS_PERSIST_FAILED", {
          purpose,
          eventRef: eventRefPrefix(eventRef),
        });
      }
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
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("bale_auth_code_dispatches")
      .update({
        status,
        completed_at: new Date().toISOString(),
        processing_expires_at: null,
        error_code: errorCode ?? null,
      })
      .eq("id", dispatchId)
      .eq("status", "processing")
      .select("id");

    if (error || !data || data.length !== 1) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function updateMappingStatus(
  supabase: SupabaseClient,
  userId: string,
  status: "sent" | "failed",
  errorCode?: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("user_bale_mapping")
      .update({
        last_auth_code_delivery_at: new Date().toISOString(),
        last_auth_code_delivery_status: status,
        last_auth_code_delivery_error: errorCode ?? null,
      })
      .eq("user_id", userId)
      .select("user_id");

    if (error || !data || data.length !== 1) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}
