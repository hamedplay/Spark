import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

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

  // ── Authentication: require X-Cron-Secret ──────────────────────────────
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

    // 1. Claim pending outbox rows atomically
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
    let smsSkippedCount = 0;
    let failedCount = 0;

    for (const row of claimedRows) {
      try {
        const payload = row.payload || {};
        const title = payload.title || row.event_type;
        const message = payload.message || row.event_type;
        const context = payload.context || {};
        const smsSupported = payload.sms_supported || false;
        const templateId = payload.template_id || null;
        const revisionNumber = payload.revision_number || null;

        // 2. Create in-app notification
        const { error: notifError } = await supabase
          .from("notifications")
          .insert({
            user_id: row.recipient_id,
            title,
            message,
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
            action_url: context.action_url || null,
            event_key: row.idempotency_key,
            metadata: {
              ...context,
              outbox_id: row.id,
              event_key: row.event_key,
            },
          });

        if (notifError) {
          // Check if duplicate (unique violation on event_key)
          if (notifError.code === "23505") {
            // Already processed — mark as done
            await supabase
              .from("notification_outbox")
              .update({ status: "processed", processed_at: new Date().toISOString() })
              .eq("id", row.id);
            continue;
          }
          // Real error — mark as failed
          await supabase
            .from("notification_outbox")
            .update({
              status: "failed",
              attempt_count: (row.attempt_count || 0) + 1,
              last_error: notifError.message,
              next_attempt_at: new Date(Date.now() + 60000).toISOString(),
            })
            .eq("id", row.id);
          failedCount++;
          continue;
        }

        notificationCount++;

        // 3. SMS dispatch if supported
        let smsStatus = "not_requested";
        let smsSentAt = null;

        if (smsSupported) {
          // Check if SMS template is active
          const { data: smsTemplate } = await supabase
            .from("sms_templates")
            .select("body, is_active")
            .eq("category", row.category)
            .eq("event_type", row.event_key)
            .eq("audience", row.audience)
            .eq("is_active", true)
            .maybeSingle();

          if (!smsTemplate) {
            // Try fallback audience='all'
            const { data: smsTemplateAll } = await supabase
              .from("sms_templates")
              .select("body, is_active")
              .eq("category", row.category)
              .eq("event_type", row.event_key)
              .eq("audience", "all")
              .eq("is_active", true)
              .maybeSingle();

            if (smsTemplateAll) {
              // Dispatch via send-sms edge function
              const smsResult = await dispatchSms(supabase, row, smsTemplateAll.body);
              smsStatus = smsResult.status;
              if (smsResult.sent) smsSentAt = new Date().toISOString();
            } else {
              smsStatus = "skipped_template_disabled";
            }
          } else {
            // Dispatch via send-sms edge function
            const smsResult = await dispatchSms(supabase, row, smsTemplate.body);
            smsStatus = smsResult.status;
            if (smsResult.sent) smsSentAt = new Date().toISOString();
          }
        }

        if (smsStatus === "skipped_template_disabled" || smsStatus === "skipped_no_phone" || smsStatus === "skipped_no_provider_rule") {
          smsSkippedCount++;
        }
        if (smsStatus === "sent") smsSentCount++;

        // 4. Mark outbox row as processed
        await supabase
          .from("notification_outbox")
          .update({
            status: "processed",
            processed_at: new Date().toISOString(),
            sms_status: smsStatus,
            sms_sent_at: smsSentAt,
          })
          .eq("id", row.id);
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
        sms_skipped: smsSkippedCount,
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

// ── SMS dispatch helper ─────────────────────────────────────────────────────
async function dispatchSms(
  supabase: ReturnType<typeof createClient>,
  row: { recipient_id: string; category: string; event_key: string; audience: string; payload: Record<string, unknown> },
  templateBody: string,
): Promise<{ status: string; sent: boolean }> {
  try {
    const { data: result, error } = await supabase.functions.invoke("send-sms", {
      body: {
        mode: "dispatch",
        targetUserId: row.recipient_id,
        category: row.category,
        eventType: row.event_key,
        audience: row.audience,
        message: templateBody,
        triggeredByUserId: null,
      },
    });

    if (error) {
      return { status: "failed", sent: false };
    }

    if (result?.ok && result?.status === "sent") {
      return { status: "sent", sent: true };
    }
    if (result?.status === "skipped") {
      // Map skip reasons
      const reason = result?.reason || "";
      if (reason.includes("PHONE") || reason.includes("phone")) {
        return { status: "skipped_no_phone", sent: false };
      }
      if (reason.includes("RULE") || reason.includes("rule")) {
        return { status: "skipped_no_provider_rule", sent: false };
      }
      return { status: "skipped_template_disabled", sent: false };
    }
    return { status: "failed", sent: false };
  } catch {
    return { status: "failed", sent: false };
  }
}
