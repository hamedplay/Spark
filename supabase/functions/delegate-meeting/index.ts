import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
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
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── FULL auth access gate ──────────────────────────────────────────────────────
  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return deniedResponse();
  const user = { id: authResult.userId! };

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

  const { inbox_entry_id, delegate_to_id } = payload;
  if (!inbox_entry_id || !delegate_to_id) {
    return json(
      { error: "inbox_entry_id and delegate_to_id are required" },
      400,
    );
  }

  if (delegate_to_id === user.id) {
    return json({ error: "Cannot delegate to yourself" }, 400);
  }

  // Use the user client from the auth gate (user JWT + anon key)
  const userClient = authResult.userClient!;

  // Fetch the inbox entry to get updated_at for optimistic concurrency
  const { data: inboxRow, error: inboxErr } = await userClient
    .from("meeting_inbox")
    .select("id, updated_at, created_at")
    .eq("id", inbox_entry_id)
    .maybeSingle();

  if (inboxErr || !inboxRow) {
    return json({ error: "Inbox entry not found" }, 404);
  }

  const expectedUpdatedAt = inboxRow.updated_at || inboxRow.created_at;

  // Call the atomic RPC as the user
  const { data: rpcResult, error: rpcError } = await userClient.rpc(
    "assign_meeting_invitation_delegate",
    {
      p_meeting_inbox_id: inbox_entry_id,
      p_delegate_user_id: delegate_to_id,
      p_expected_updated_at: expectedUpdatedAt,
    },
  );

  if (rpcError) {
    console.error("RPC error:", rpcError);
    return json({ error: "Delegation failed", detail: rpcError.message }, 500);
  }

  if (rpcResult?.success === false) {
    return json({ error: rpcResult.error_code || "Delegation failed", detail: rpcResult.message || "" }, 400);
  }

  return json({ success: true, ...rpcResult });
});
