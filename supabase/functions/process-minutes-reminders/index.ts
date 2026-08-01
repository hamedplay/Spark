import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Atomically claim pending reminders that are due.
    //    We use a single UPDATE ... RETURNING to lock rows.
    const { data: dueReminders, error: claimError } = await supabase
      .from("minutes_decision_reminders")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("status", "pending")
      .lte("remind_at", new Date().toISOString())
      .order("remind_at", { ascending: true })
      .limit(50)
      .select("id, decision_id, minute_id, recipient_user_id");

    if (claimError) {
      console.error("[process-reminders] claim failed", claimError);
      return new Response(
        JSON.stringify({ error: "claim_failed", details: claimError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!dueReminders || dueReminders.length === 0) {
      return new Response(
        JSON.stringify({ processed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let sentCount = 0;
    let failedCount = 0;

    for (const reminder of dueReminders) {
      try {
        // 2. Fetch decision details for notification content
        const { data: decision } = await supabase
          .from("minutes_decisions")
          .select("id, title, minute_id")
          .eq("id", reminder.decision_id)
          .maybeSingle();

        if (!decision) {
          // Decision was deleted; cancel the reminder
          await supabase
            .from("minutes_decision_reminders")
            .update({ status: "cancelled", updated_at: new Date().toISOString() })
            .eq("id", reminder.id);
          continue;
        }

        // 3. Create in-app notification
        const eventKey = `decision:${reminder.decision_id}:${reminder.id}:decision_followup_due:${reminder.recipient_user_id}`;
        const { error: notifError } = await supabase
          .from("notifications")
          .insert({
            user_id: reminder.recipient_user_id,
            entity_type: "decision",
            entity_id: reminder.decision_id,
            minute_id: reminder.minute_id,
            template_category: "decision",
            template_event_type: "decision_followup_due",
            event_key: eventKey,
            title: "موعد پیگیری مصوبه",
            body: `موعد پیگیری مصوبه «${decision.title}» فرا رسیده است.`,
            action_url: `#minutes-my-decisions?decision=${reminder.decision_id}`,
            read: false,
          });

        const notificationOk = !notifError;

        // 4. Check if SMS template is active for this event
        const { data: smsTemplate } = await supabase
          .from("sms_templates")
          .select("id, body, is_active")
          .eq("category", "decision")
          .eq("event_type", "decision_followup_due")
          .eq("is_active", true)
          .maybeSingle();

        let smsOk = false;
        if (smsTemplate) {
          // Fetch recipient phone
          const { data: profile } = await supabase
            .from("profiles")
            .select("phone")
            .eq("id", reminder.recipient_user_id)
            .maybeSingle();

          if (profile?.phone) {
            // Use the existing SMS dispatch infrastructure
            const { error: smsLogError } = await supabase
              .from("sms_dispatch_logs")
              .insert({
                target_phone: profile.phone,
                target_user_id: reminder.recipient_user_id,
                message: smsTemplate.body,
                category: "decision",
                event_type: "decision_followup_due",
                status: "queued",
              });
            smsOk = !smsLogError;
          }
        }

        // 5. Update reminder status
        const newStatus = notificationOk && (!smsTemplate || smsOk)
          ? "sent"
          : notificationOk
            ? "partial"
            : "failed";

        await supabase
          .from("minutes_decision_reminders")
          .update({
            status: newStatus,
            notification_sent_at: notificationOk ? new Date().toISOString() : null,
            sms_sent_at: smsOk ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", reminder.id);

        if (newStatus === "sent") sentCount++;
        else failedCount++;
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
      JSON.stringify({ processed: dueReminders.length, sent: sentCount, failed: failedCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("[process-reminders] fatal", err);
    return new Response(
      JSON.stringify({ error: "internal", details: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
