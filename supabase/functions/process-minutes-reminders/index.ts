import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { timingSafeCompare } from "../_shared/crypto.ts";


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

  const providedSecret = req.headers.get("X-Cron-Secret");
  if (!providedSecret) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let authorized = false;
  const legacyCronSecret = Deno.env.get("MINUTES_REMINDER_CRON_SECRET") ?? "";
  if (legacyCronSecret) {
    authorized = timingSafeCompare(providedSecret, legacyCronSecret);
  }

  if (!authorized) {
    const { data, error } = await supabase.rpc("verify_cron_secret", { candidate: providedSecret });
    authorized = !error && data === true;
  }

  if (!authorized) {
    return new Response(
      JSON.stringify({ error: "unauthorized" }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
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

    let queuedCount = 0;
    let failedCount = 0;
    let duplicateCount = 0;

    for (const reminder of claimedReminders) {
      try {
        if (!reminder.decision_title) {
          await supabase
            .from("minutes_decision_reminders")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("id", reminder.id);
          continue;
        }

        const idempotencyKey = `reminder:${reminder.id}:decision_followup_due:${reminder.recipient_user_id}`;

        const { data: queueResult, error: queueError } = await supabase
          .rpc("resolve_and_queue_notification", {
            p_event_key: "decision_followup_due",
            p_recipient_user_id: reminder.recipient_user_id,
            p_audience: "decision_owner",
            p_entity_type: "decision",
            p_entity_id: reminder.decision_id,
            p_minute_id: reminder.minute_id,
            p_actor_user_id: null,
            p_context: {
              decision_title: reminder.decision_title,
              decision_link: `#minutes-my-decisions?decision=${reminder.decision_id}`,
              fallback_title: "موعد پیگیری مصوبه",
              fallback_message: `موعد پیگیری مصوبه «${reminder.decision_title}» فرا رسیده است.`,
              audience: "decision_owner",
              reminder_id: reminder.id,
            },
            p_idempotency_key: idempotencyKey,
            p_revision_number: null,
          });

        if (queueError) {
          console.error("[process-reminders] queue failed", reminder.id, queueError);
          await supabase
            .from("minutes_decision_reminders")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", reminder.id);
          failedCount++;
          continue;
        }

        if (queueResult?.ok && queueResult?.queued === false && queueResult?.reason === "DUPLICATE") {
          const { data: existingOutbox } = await supabase
            .from("notification_outbox")
            .select("id")
            .eq("idempotency_key", idempotencyKey)
            .maybeSingle();

          await supabase
            .from("minutes_decision_reminders")
            .update({
              status: "queued",
              notification_sent_at: null,
              sms_sent_at: null,
              outbox_id: existingOutbox?.id || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", reminder.id);

          duplicateCount++;
          continue;
        }

        if (queueResult?.ok) {
          await supabase
            .from("minutes_decision_reminders")
            .update({
              status: "queued",
              notification_sent_at: null,
              sms_sent_at: null,
              outbox_id: queueResult.outbox_id || null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", reminder.id);
          queuedCount++;
        } else {
          console.error("[process-reminders] queue rejected", reminder.id, queueResult);
          await supabase
            .from("minutes_decision_reminders")
            .update({ status: "failed", updated_at: new Date().toISOString() })
            .eq("id", reminder.id);
          failedCount++;
        }
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
        queued: queuedCount,
        duplicates: duplicateCount,
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
