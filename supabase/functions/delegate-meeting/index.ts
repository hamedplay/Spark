import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*", // در production به origin واقعی محدود کن
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // فقط POST مجاز است
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // باید Authorization داشته باشیم
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ error: "Missing authorization header" }, 401);
  }

  // parse امن body
  let payload: {
    meeting_id?: string;
    delegate_to_id?: string;
    inbox_entry_id?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { meeting_id, delegate_to_id, inbox_entry_id } = payload;
  if (!meeting_id || !delegate_to_id || !inbox_entry_id) {
    return json(
      { error: "meeting_id, delegate_to_id and inbox_entry_id are required" },
      400,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  // client با هویت کاربر برای احراز هویت
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  // client سرویس برای دور زدن RLS در عملیات نوشتن
  const serviceClient = createClient(supabaseUrl, serviceKey);

  // احراز هویت کاربر فعلی
  const {
    data: { user },
    error: authErr,
  } = await userClient.auth.getUser();

  if (authErr || !user) {
    return json({ error: "Unauthorized" }, 401);
  }

  // واگذاری به خود بی‌معناست
  if (delegate_to_id === user.id) {
    return json({ error: "Cannot delegate to yourself" }, 400);
  }

  try {
    // 1) کاربر مقصد باید واقعاً وجود داشته باشد
    const { data: targetProfile, error: profileErr } = await serviceClient
      .from("profiles")
      .select("user_id")
      .eq("user_id", delegate_to_id)
      .maybeSingle();

    if (profileErr) {
      console.error("profile lookup error:", profileErr);
      return json({ error: "Internal error" }, 500);
    }
    if (!targetProfile) {
      return json({ error: "Delegate target user does not exist" }, 400);
    }

    // 2) جلسه را بخوان
    const { data: meeting, error: meetingErr } = await serviceClient
      .from("meetings")
      .select("id, user_id, participant_user_ids")
      .eq("id", meeting_id)
      .maybeSingle();

    if (meetingErr) {
      console.error("meeting lookup error:", meetingErr);
      return json({ error: "Internal error" }, 500);
    }
    if (!meeting) {
      return json({ error: "Meeting not found" }, 404);
    }

    const currentParticipants: string[] = meeting.participant_user_ids ?? [];
    const isCreator = meeting.user_id === user.id;
    const isParticipant = currentParticipants.includes(user.id);

    // 3) فقط سازنده یا شرکت‌کننده می‌تواند واگذار کند
    if (!isCreator && !isParticipant) {
      return json({ error: "You are not part of this meeting" }, 403);
    }

    // 4) ردیف inbox را بخوان و تطابق امنیتی را بررسی کن
    const { data: inboxEntry, error: inboxErr } = await serviceClient
      .from("meeting_inbox")
      .select("id, meeting_id, user_id, status")
      .eq("id", inbox_entry_id)
      .maybeSingle();

    if (inboxErr) {
      console.error("inbox lookup error:", inboxErr);
      return json({ error: "Internal error" }, 500);
    }
    if (!inboxEntry) {
      return json({ error: "Inbox entry not found" }, 404);
    }

    // ردیف inbox باید به همین جلسه و همین کاربر تعلق داشته باشد
    if (
      inboxEntry.meeting_id !== meeting_id ||
      inboxEntry.user_id !== user.id
    ) {
      return json({ error: "Inbox entry does not belong to you" }, 403);
    }

    // 5) ساخت لیست جدید شرکت‌کننده‌ها: حذف کاربر فعلی، افزودن مقصد، حذف تکراری‌ها
    const nextParticipants = Array.from(
      new Set(
        currentParticipants
          .filter((id) => id !== user.id)
          .concat(delegate_to_id),
      ),
    );

    // 6) Update inbox entry: mark original entry as delegated
    const { error: inboxUpdateErr } = await serviceClient
      .from("meeting_inbox")
      .update({ status: "delegated", delegate_to: delegate_to_id })
      .eq("id", inbox_entry_id);

    if (inboxUpdateErr) {
      console.error("inbox update error:", inboxUpdateErr);
      return json({ error: "Failed to update inbox" }, 500);
    }

    // 7) Update meeting participants: remove delegator, add substitute
    const { error: meetingUpdateErr } = await serviceClient
      .from("meetings")
      .update({ participant_user_ids: nextParticipants })
      .eq("id", meeting_id);

    if (meetingUpdateErr) {
      console.error("meeting update error:", meetingUpdateErr);

      // rollback inbox
      const { error: rollbackErr } = await serviceClient
        .from("meeting_inbox")
        .update({ status: inboxEntry.status, delegate_to: null })
        .eq("id", inbox_entry_id);

      if (rollbackErr) {
        console.error("inbox rollback failed:", rollbackErr);
        return json(
          { error: "Update failed and rollback failed", inconsistent: true },
          500,
        );
      }

      return json({ error: "Failed to update meeting" }, 500);
    }

    // 8) Create an accepted inbox entry for the substitute so the meeting appears
    //    immediately in their calendar. Use DELETE + INSERT to avoid issues with the
    //    partial unique index (meeting_id IS NOT NULL), which upsert can't target reliably.
    const { error: deleteOldErr } = await serviceClient
      .from("meeting_inbox")
      .delete()
      .eq("meeting_id", meeting_id)
      .eq("user_id", delegate_to_id);

    if (deleteOldErr) {
      console.error("substitute inbox delete error:", deleteOldErr);
      // Non-fatal: log but continue — INSERT will fail if there's a conflict anyway
    }

    const { error: substituteInboxErr } = await serviceClient
      .from("meeting_inbox")
      .insert({ meeting_id, user_id: delegate_to_id, status: "accepted" });

    if (substituteInboxErr) {
      console.error("substitute inbox insert error:", substituteInboxErr);
      // Fatal: meeting update already succeeded, but delegate can't see the meeting
      // without an inbox entry when the calendar filter checks for non-pending status.
      return json({ error: "Failed to create substitute inbox entry", detail: substituteInboxErr.message }, 500);
    }

    return json({ success: true });
  } catch (err) {
    console.error("delegate_meeting unexpected error:", err);
    return json({ error: "Internal error" }, 500);
  }
});
