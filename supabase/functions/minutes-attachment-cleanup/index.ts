import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice("Bearer ".length).trim();

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  // Verify user is admin
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !userData?.user) {
    return json({ error: "Unauthorized" }, 401);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  // Check admin via RPC
  const { data: isAdmin, error: adminErr } = await userClient.rpc("is_current_user_admin");
  if (adminErr || !isAdmin) {
    return json({ error: "Admin required" }, 403);
  }

  let body: { max_age_hours?: number };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const maxAgeHours = body.max_age_hours ?? 24;

  // 1. Fetch pending attachments older than threshold
  const { data: orphans, error: fetchErr } = await adminClient
    .from("minutes_attachments")
    .select("id,storage_path")
    .eq("upload_status", "pending_upload")
    .lt("created_at", new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString());

  if (fetchErr) {
    return json({ error: "fetch_failed" }, 500);
  }
  if (!orphans || orphans.length === 0) {
    return json({ deleted_records: 0, deleted_objects: 0 });
  }

  // 2. Remove storage objects (service role bypasses RLS)
  const paths = orphans.map((o: { storage_path: string }) => o.storage_path);
  let deletedObjects = 0;
  if (paths.length > 0) {
    const { error: rmErr } = await adminClient.storage.from("minutes-attachments").remove(paths);
    if (!rmErr) deletedObjects = paths.length;
  }

  // 3. Delete DB records
  const ids = orphans.map((o: { id: string }) => o.id);
  const { error: delErr } = await adminClient
    .from("minutes_attachments")
    .delete()
    .in("id", ids);

  if (delErr) {
    return json({ error: "delete_records_failed", deleted_objects: deletedObjects }, 500);
  }

  return json({ deleted_records: ids.length, deleted_objects: deletedObjects });
});
