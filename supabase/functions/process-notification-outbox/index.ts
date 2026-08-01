import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

const MAX_SMS_ATTEMPTS = 5;
const MAX_NOTIFICATION_ATTEMPTS = 5;

const SMS_BACKOFF_MS = [2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000, 60 * 60 * 1000];
const NOTIF_BACKOFF_MS = [1 * 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000, 15 * 60 * 1000, 30 * 60 * 1000];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "method_not_allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const cronSecret = Deno.env.get("NOTIFICATION_OUTBOX_CRON_SECRET");
  if (!cronSecret) {
    console.error("[outbox-worker] NOTIFICATION_OUTBOX_CRON_SECRET not configured");
    return new Response(
      JSON.stringify({ error: "server_misconfigured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const providedSecret = req.headers.get("X-Cron-Secret");
  if (!providedSecret) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const enc = new TextEncoder();
  const a = enc.encode(providedSecret);
  const b = enc.encode(cronSecret);
  if (a.length !== b.length) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  if (diff !== 0) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: claimedRows, error: claimError } = await supabase
      .rpc("claim_notification_outbox_rows", { p_limit: 50 });

    if (claimError) {
      console.error("[outbox-worker] claim failed", claimError);
      return new Response(
        JSON.stringify({ error: "claim_failed", details: claimError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!claimedRows || claimedRows.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let notificationCount = 0;
    let smsSentCount = 0;
    let failedCount = 0;

    for (const row of claimedRows) {
      try {
        const payload = row.payload || {};
        const context = payload.context || {};
        const smsSupported = payload.sms_supported || false;
        const templateId = payload.template_id || null;
        const revisionNumber = payload.revision_number || null;
        const reminderId = context.reminder_id || null;
        const actionUrl = payload.action_url || context.action_url || context.minute_link || context.decision_link || null;

        // ── Notification: only insert if not already sent ─────────────────
        let notificationSent = (row as Record<string, unknown>).notification_status === 'sent';

        if (!notificationSent) {
          const { error: notifError } = await supabase
            .from("notifications")
            .insert({
              user_id: row.recipient_id,
              title: payload.title || row.event_type,
              message: payload.message || row.event_type,
              type: row.category === 'decision' ? 'decision' : 'minutes',
              read: false,
              entity_type: row.entity_type,
              entity_id: row.entity_id,
              minute_id: row.minute_id,
              revision_number: revisionNumber,
              actor_user_id: row.actor_user_id,
              template_id: templateId,
              template_category: row.category,
              template_event_type: row.event_key,
              template_audience: row.audience,
              action_url: actionUrl,
              event_key: row.idempotency_key,
              metadata: {
                ...context,
                outbox_id: row.id,
                event_key: row.event_key,
              },
            });

          if (notifError) {
            if (notifError.code === "23505") {
              // Duplicate notification — treat as sent
              notificationSent = true;
            } else {
              // Notification failed — retry with backoff
              const notifAttempt = (row.attempt_count || 0) + 1;
              if (notifAttempt >= MAX_NOTIFICATION_ATTEMPTS) {
                await supabase
                  .from("notification_outbox")
                  .update({
                    status: "failed",
                    notification_status: "failed",
                    attempt_count: notifAttempt,
                    last_error: notifError.message,
                    next_attempt_at: null,
                    processed_at: null,
                  })
                  .eq("id", row.id);
              } else {
                const backoffIdx = Math.min(notifAttempt - 1, NOTIF_BACKOFF_MS.length - 1);
                await supabase
                  .from("notification_outbox")
                  .update({
                    status: "partial",
                    notification_status: "failed",
                    attempt_count: notifAttempt,
                    last_error: notifError.message,
                    next_attempt_at: new Date(Date.now() + NOTIF_BACKOFF_MS[backoffIdx]).toISOString(),
                    processed_at: null,
                  })
                  .eq("id", row.id);
              }
              failedCount++;
              continue;
            }
          } else {
            notificationSent = true;
            notificationCount++;
          }
        }

        // ── SMS dispatch ──────────────────────────────────────────────────
        let smsStatus = (row as Record<string, unknown>).sms_status || "not_requested";
        let smsSentAt = (row as Record<string, unknown>).sms_sent_at || null;
        let smsLastError: string | null = null;

        if (smsSupported && smsStatus !== "sent" && smsStatus !== "skipped_template_disabled" && smsStatus !== "skipped_no_phone" && smsStatus !== "skipped_no_provider_rule") {
          let smsTemplateBody: string | null = null;
          const { data: smsTemplate } = await supabase
            .from("sms_templates")
            .select("body, is_active")
            .eq("category", row.category)
            .eq("event_type", row.event_key)
            .eq("audience", row.audience)
            .eq("is_active", true)
            .maybeSingle();

          if (smsTemplate) {
            smsTemplateBody = smsTemplate.body;
          } else {
            const { data: smsTemplateAll } = await supabase
              .from("sms_templates")
              .select("body, is_active")
              .eq("category", row.category)
              .eq("event_type", row.event_key)
              .eq("audience", "all")
              .eq("is_active", true)
              .maybeSingle();

            if (smsTemplateAll) {
              smsTemplateBody = smsTemplateAll.body;
            }
          }

          if (!smsTemplateBody) {
            smsStatus = "skipped_template_disabled";
          } else {
            const renderedBody = renderPlaceholders(smsTemplateBody, context);

            if (renderedBody.unresolved.length > 0) {
              smsStatus = "failed";
              smsLastError = `SMS_PLACEHOLDER_MISSING: ${renderedBody.unresolved.join(", ")}`;
            } else {
              const smsResult = await dispatchSms(supabase, row, renderedBody.text);

              if (smsResult.sent) {
                smsStatus = "sent";
                smsSentAt = new Date().toISOString();
                smsSentCount++;
              } else {
                smsStatus = smsResult.status;
                smsLastError = smsResult.error || "SMS_DISPATCH_FAILED";
              }
            }
          }
        }

        // ── Determine final outbox status ───────────────────────────────────
        let finalStatus = "processed";
        let nextAttemptAt: string | null = null;
        let attemptCount = row.attempt_count || 0;
        let lastError: string | null = null;

        if (smsStatus === "failed") {
          attemptCount += 1;

          if (attemptCount >= MAX_SMS_ATTEMPTS) {
            finalStatus = "failed";
            nextAttemptAt = null;
            lastError = smsLastError || "SMS_MAX_ATTEMPTS_REACHED";
          } else {
            finalStatus = "partial";
            const backoffIdx = Math.min(attemptCount - 1, SMS_BACKOFF_MS.length - 1);
            nextAttemptAt = new Date(Date.now() + SMS_BACKOFF_MS[backoffIdx]).toISOString();
            lastError = smsLastError;
          }
        } else if (smsStatus === "skipped_no_phone" || smsStatus === "skipped_no_provider_rule") {
          // Terminal warning — outbox processing complete, but SMS was not sent
          finalStatus = "processed";
          lastError = `SMS_SKIPPED: ${smsStatus}`;
        }
        // skipped_template_disabled, not_requested, sent → processed

        await supabase
          .from("notification_outbox")
          .update({
            status: finalStatus,
            notification_status: notificationSent ? "sent" : "failed",
            sms_status: smsStatus,
            sms_sent_at: smsSentAt,
            processed_at: finalStatus === "processed" ? new Date().toISOString() : null,
            attempt_count: attemptCount,
            next_attempt_at: nextAttemptAt,
            last_error: lastError,
          })
          .eq("id", row.id);

        // ── Update reminder lifecycle ─────────────────────────────────────
        if (reminderId) {
          // Decision table per spec:
          // not_requested → sent
          // skipped_template_disabled → sent
          // skipped_no_phone → partial
          // skipped_no_provider_rule → partial
          // failed (below cap) → partial
          // failed (at cap) → failed
          // sent → sent
          let reminderStatus = "sent";
          if (!notificationSent) {
            reminderStatus = "failed";
          } else if (smsStatus === "skipped_no_phone" || smsStatus === "skipped_no_provider_rule") {
            reminderStatus = "partial";
          } else if (smsStatus === "failed") {
            if (attemptCount >= MAX_SMS_ATTEMPTS) {
              reminderStatus = "failed";
            } else {
              reminderStatus = "partial";
            }
          }

          await updateReminderStatus(
            supabase,
            reminderId,
            reminderStatus,
            notificationSent ? new Date().toISOString() : null,
            smsSentAt,
          );
        }
      } catch (err) {
        console.error("[outbox-worker] row failed", row.id, err);
        await supabase
          .from("notification_outbox")
          .update({
            status: "failed",
            attempt_count: (row.attempt_count || 0) + 1,
            last_error: err instanceof Error ? err.message : String(err),
            next_attempt_at: new Date(Date.now() + 60000).toISOString(),
          })
          .eq("id", row.id);
        failedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        processed: claimedRows.length,
        notifications: notificationCount,
        sms_sent: smsSentCount,
        failed: failedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[outbox-worker] fatal", err);
    return new Response(
      JSON.stringify({ error: "internal" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

// ── Placeholder renderer ────────────────────────────────────────────────────
function renderPlaceholders(template: string, context: Record<string, unknown>): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  let result = template;

  if (context && typeof context === "object") {
    for (const [key, value] of Object.entries(context)) {
      const strVal = value === null || value === undefined ? "" : String(value);
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), strVal);
    }
  }

  const matches = result.match(/\{\{[^}]+\}\}/g);
  if (matches) {
    for (const m of matches) {
      unresolved.push(m.replace(/\{\{|}}/g, ""));
    }
    result = result.replace(/\{\{[^}]+\}\}/g, "");
  }

  return { text: result, unresolved };
}

// ── SMS dispatch helper ─────────────────────────────────────────────────────
async function dispatchSms(
  supabase: ReturnType<typeof createClient>,
  row: { recipient_id: string; category: string; event_key: string; audience: string; payload: Record<string, unknown> },
  renderedBody: string,
): Promise<{ status: string; sent: boolean; error?: string }> {
  try {
    const { data: result, error } = await supabase.functions.invoke("send-sms", {
      body: {
        mode: "dispatch",
        targetUserId: row.recipient_id,
        category: row.category,
        eventType: row.event_key,
        audience: row.audience,
        message: renderedBody,
        triggeredByUserId: null,
      },
    });

    if (error) return { status: "failed", sent: false, error: error.message };

    if (result?.ok && result?.status === "sent") return { status: "sent", sent: true };
    if (result?.status === "skipped") {
      const reason = result?.reason || "";
      if (reason.includes("PHONE") || reason.includes("phone")) return { status: "skipped_no_phone", sent: false };
      if (reason.includes("RULE") || reason.includes("rule")) return { status: "skipped_no_provider_rule", sent: false };
      return { status: "skipped_template_disabled", sent: false };
    }
    return { status: "failed", sent: false, error: "UNKNOWN_SMS_RESULT" };
  } catch (err) {
    return { status: "failed", sent: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Reminder status updater ────────────────────────────────────────────────
async function updateReminderStatus(
  supabase: ReturnType<typeof createClient>,
  reminderId: string,
  status: string,
  notificationSentAt: string | null,
  smsSentAt: string | null,
): Promise<void> {
  await supabase
    .from("minutes_decision_reminders")
    .update({
      status,
      notification_sent_at: notificationSentAt,
      sms_sent_at: smsSentAt,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reminderId);
}
