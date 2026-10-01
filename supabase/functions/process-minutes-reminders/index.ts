import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { timingSafeCompare } from "../_shared/crypto.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const providedSecret = req.headers.get("X-Cron-Secret");
  if (!providedSecret) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { autoRefreshToken: false, persistSession: false } });
  let authorized = false;
  const legacyCronSecret = Deno.env.get("MINUTES_REMINDER_CRON_SECRET") ?? "";
  if (legacyCronSecret) authorized = timingSafeCompare(providedSecret, legacyCronSecret);
  if (!authorized) {
    const { data, error } = await supabase.rpc("verify_cron_secret", { candidate: providedSecret });
    authorized = !error && data === true;
  }
  if (!authorized) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const { data: materialized, error: materializeError } = await supabase.rpc("materialize_due_minutes_periodic_reminders", { p_limit: 100 });
    if (materializeError) {
      console.error("[process-reminders] periodic materialization failed", materializeError);
      return new Response(JSON.stringify({ error: "materialize_failed", details: materializeError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: claimedReminders, error: claimError } = await supabase.rpc("claim_due_minutes_decision_reminders", { p_limit: 50 });
    if (claimError) {
      console.error("[process-reminders] claim failed", claimError);
      return new Response(JSON.stringify({ error: "claim_failed", details: claimError.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (!claimedReminders || claimedReminders.length === 0) {
      return new Response(JSON.stringify({ materialized: Number(materialized ?? 0), processed: 0 }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let queuedCount = 0;
    let failedCount = 0;
    let duplicateCount = 0;

    for (const reminder of claimedReminders) {
      try {
        if (!reminder.decision_title) {
          await supabase.from("minutes_decision_reminders").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", reminder.id);
          continue;
        }

        const isPeriodic = Boolean(reminder.recurrence_cycle_at);
        const idempotencyKey = `reminder:${reminder.id}:decision_followup_due:${reminder.recipient_user_id}`;
        const fallbackTitle = isPeriodic ? "یادآوری طرح مجدد مصوبه" : "موعد پیگیری مصوبه";
        const fallbackMessage = isPeriodic
          ? `مصوبه «${reminder.decision_title}» براساس برنامه پیگیری تعیین‌شده باید در دستور جلسه بعدی قرار گیرد.`
          : `موعد پیگیری مصوبه «${reminder.decision_title}» فرا رسیده است.`;

        const { data: queueResult, error: queueError } = await supabase.rpc("resolve_and_queue_notification", {
          p_event_key: "decision_followup_due",
          p_recipient_user_id: reminder.recipient_user_id,
          p_audience: "decision_owner",
          p_entity_type: "decision",
          p_entity_id: reminder.decision_id,
          p_minute_id: reminder.minute_id,
          p_actor_user_id: null,
          p_context: {
            decision_title: reminder.decision_title,
            decision_link: `#minutes-hub?decision=${reminder.decision_id}`,
            fallback_title: fallbackTitle,
            fallback_message: fallbackMessage,
            audience: "decision_owner",
            reminder_id: reminder.id,
            periodic_followup: isPeriodic,
            recurrence_cycle_at: reminder.recurrence_cycle_at ?? null,
            recipient_type: reminder.recipient_type ?? null,
          },
          p_idempotency_key: idempotencyKey,
          p_revision_number: null,
        });

        if (queueError) {
          console.error("[process-reminders] queue failed", reminder.id, queueError);
          await supabase.from("minutes_decision_reminders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", reminder.id);
          failedCount++;
          continue;
        }

        let outboxId: string | null = queueResult?.outbox_id || null;
        await deferPeriodicOutbox(supabase, reminder.id, isPeriodic, reminder.remind_at);

        if (queueResult?.ok && queueResult?.queued === false && queueResult?.reason === "DUPLICATE") {
          const { data: existingOutbox } = await supabase.from("notification_outbox").select("id").like("idempotency_key", `reminder:${reminder.id}:decision_followup_due:%`).limit(1).maybeSingle();
          outboxId = existingOutbox?.id || null;
          await supabase.from("minutes_decision_reminders").update({ status: "queued", notification_sent_at: null, sms_sent_at: null, outbox_id: outboxId, updated_at: new Date().toISOString() }).eq("id", reminder.id);
          duplicateCount++;
          continue;
        }

        if (queueResult?.ok) {
          if (!outboxId) {
            const { data: firstOutbox } = await supabase.from("notification_outbox").select("id").like("idempotency_key", `reminder:${reminder.id}:decision_followup_due:%`).limit(1).maybeSingle();
            outboxId = firstOutbox?.id || null;
          }
          await supabase.from("minutes_decision_reminders").update({ status: "queued", notification_sent_at: null, sms_sent_at: null, outbox_id: outboxId, updated_at: new Date().toISOString() }).eq("id", reminder.id);
          queuedCount++;
        } else {
          console.error("[process-reminders] queue rejected", reminder.id, queueResult);
          await supabase.from("minutes_decision_reminders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", reminder.id);
          failedCount++;
        }
      } catch (err) {
        console.error("[process-reminders] reminder failed", reminder.id, err);
        await supabase.from("minutes_decision_reminders").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", reminder.id);
        failedCount++;
      }
    }

    return new Response(JSON.stringify({ materialized: Number(materialized ?? 0), processed: claimedReminders.length, queued: queuedCount, duplicates: duplicateCount, failed: failedCount }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("[process-reminders] fatal", err);
    return new Response(JSON.stringify({ error: "internal" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function deferPeriodicOutbox(
  supabase: ReturnType<typeof createClient>,
  reminderId: string,
  isPeriodic: boolean,
  remindAt: string | null | undefined,
): Promise<void> {
  if (!isPeriodic || !remindAt) return;
  const deliveryMs = Date.parse(remindAt);
  if (!Number.isFinite(deliveryMs) || deliveryMs <= Date.now()) return;
  await supabase
    .from("notification_outbox")
    .update({ available_at: remindAt, next_attempt_at: remindAt })
    .like("idempotency_key", `reminder:${reminderId}:decision_followup_due:%`)
    .eq("status", "pending")
    .is("processed_at", null);
}
