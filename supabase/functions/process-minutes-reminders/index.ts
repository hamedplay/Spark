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
  const cronSecret = Deno.env.get("MINUTES_REMINDER_CRON_SECRET");
  if (!cronSecret) {
    console.error("[process-reminders] MINUTES_REMINDER_CRON_SECRET not configured");
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

  // Constant-time comparison
  const enc = new TextEncoder();
  const a = enc.encode(providedSecret);
  const b = enc.encode(cronSecret);
  if (a.length !== b.length) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
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

    // 1. Atomically claim due reminders using RPC with FOR UPDATE SKIP LOCKED
    const { data: claimedReminders, error: claimError } = await supabase
      .rpc("claim_due_minutes_decision_reminders", { p_limit: 50 });

    if (claimError) {
      console.error("[process-reminders] claim failed", claimError);
      return new Response(
        JSON.stringify({ error: "claim_failed", details: claimError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!claimedReminders || claimedReminders.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let notificationCount = 0;
    let smsQueuedCount = 0;
    let failedCount = 0;

    for (const reminder of claimedReminders) {
      try {
        if (!reminder.decision_title) {
          await supabase
            .from("minutes_decision_reminders")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("id", reminder.id);
          continue;
        }

        // 2. Create in-app notification using direct insert (service role bypasses auth.uid() check)
        const eventKey = `decision:${reminder.decision_id}:${reminder.id}:decision_followup_due:${reminder.recipient_user_id}`;
        const { error: notifError } = await supabase
          .from("notifications")
          .insert({
            user_id: reminder.recipient_user_id,
            title: "موعد پیگیری مصوبه",
            message: `موعد پیگیری مصوبه «${reminder.decision_title}» فرا رسیده است.`,
            type: "meeting",
            read: false,
            entity_type: "decision",
            entity_id: reminder.decision_id,
            minute_id: reminder.minute_id,
            template_event_type: "decision_followup_due",
            template_category: "decision",
            template_audience: "decision_owner",
            action_url: `#minutes-my-decisions?decision=${reminder.decision_id}`,
            event_key: eventKey,
            metadata: { reminder_id: reminder.id, decision_id: reminder.decision_id },
          });

        const notificationOk = !notifError;

        // 3. Check if SMS template is active, then dispatch via send-sms edge function
        let smsDispatched = false;
        let smsQueued = false;

        const { data: smsTemplate } = await supabase
          .from("sms_templates")
          .select("id, body, is_active")
          .eq("category", "decision")
          .eq("event_type", "decision_followup_due")
          .eq("is_active", true)
          .maybeSingle();

        if (smsTemplate) {
          // Dispatch via the existing send-sms edge function (mode: "dispatch")
          // This handles phone lookup, provider resolution, and logging internally.
          const { data: smsResult, error: smsError } = await supabase.functions.invoke(
            "send-sms",
            {
              body: {
                mode: "dispatch",
                targetUserId: reminder.recipient_user_id,
                category: "decision",
                eventType: "decision_followup_due",
                audience: "decision_owner",
                message: smsTemplate.body,
                triggeredByUserId: null,
              },
            },
          );

          if (!smsError && smsResult?.ok) {
            if (smsResult.status === "sent") {
              smsDispatched = true;
            } else if (smsResult.status === "skipped") {
              // Template active but user has no phone or no SMS rule — not a failure
              smsQueued = false;
            }
          }
          // If smsError or result not ok, smsDispatched stays false
        }

        // 4. Update reminder status
        // sms_sent_at only set when actually sent by provider (not just queued)
        const newStatus = notificationOk
          ? (smsDispatched ? "sent" : "partial")
          : "failed";

        await supabase
          .from("minutes_decision_reminders")
          .update({
            status: newStatus,
            notification_sent_at: notificationOk ? new Date().toISOString() : null,
            sms_sent_at: smsDispatched ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", reminder.id);

        if (notificationOk) notificationCount++;
        if (smsDispatched) smsQueuedCount++;
        if (newStatus === "failed") failedCount++;
      } catch (err) {
        console.error("[process-reminders] reminder failed", reminder.id, err);
        await supabase
          .from("minutes_decision_reminders")
          .update({ status: "failed", updated_at: new Date().toISOString() })
          .eq("id", reminder.id);
        failedCount++;
      }
    }

    return new Response(
      JSON.stringify({
        processed: claimedReminders.length,
        notifications: notificationCount,
        sms_sent: smsQueuedCount,
        failed: failedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[process-reminders] fatal", err);
    return new Response(
      JSON.stringify({ error: "internal" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
