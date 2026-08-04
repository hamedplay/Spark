import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return deniedResponse();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  let body: {
    minute_id: string;
    agenda_result_id?: string | null;
    decision_id?: string | null;
    original_filename: string;
    mime_type: string;
    size_bytes: number;
    description?: string | null;
    attachment_kind?: string;
    revision_number?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!body.minute_id || !body.original_filename || !body.mime_type || !body.size_bytes) {
    return json({ error: "Missing required fields" }, 400);
  }

  // Admin client creates signed upload URL with service role (bypasses RLS)
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Run begin RPC as the user (via authResult.userClient) so auth.uid() resolves correctly
  const { data: beginData, error: beginErr } = await authResult.userClient!.rpc(
    "begin_minutes_attachment_upload",
    {
      p_minute_id: body.minute_id,
      p_agenda_result_id: body.agenda_result_id ?? null,
      p_decision_id: body.decision_id ?? null,
      p_original_filename: body.original_filename,
      p_mime_type: body.mime_type,
      p_size_bytes: body.size_bytes,
      p_description: body.description ?? null,
      p_attachment_kind: body.attachment_kind ?? "general",
      p_revision_number: body.revision_number ?? null,
    },
  );
  if (beginErr || !beginData) {
    return json({ error: beginErr?.message ?? "begin_failed" }, 400);
  }
  const { attachment_id, storage_path } = beginData as {
    attachment_id: string;
    storage_path: string;
  };

  // Create signed upload URL server-side with service role (bypasses RLS)
  const { data: sUp, error: upErr } = await adminClient.storage
    .from("minutes-attachments")
    .createSignedUploadUrl(storage_path);
  if (upErr || !sUp?.signedUrl) {
    // Best-effort: delete the pending record so it doesn't linger
    try {
      await adminClient.from("minutes_attachments").delete().eq("id", attachment_id);
    } catch { /* ignore */ }
    return json({ error: "signed_url_failed" }, 500);
  }

  return json({
    attachment_id,
    storage_path,
    signed_url: sUp.signedUrl,
  }, 200);
});
