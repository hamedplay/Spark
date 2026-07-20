import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const INVALID_CREDENTIALS = { error: "INVALID_CREDENTIALS" };
const LOGIN_UNAVAILABLE = { error: "LOGIN_UNAVAILABLE" };

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (data: unknown, status: number) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method !== "POST") {
    return json({ error: "Method Not Allowed" }, 405);
  }

  let body: { username?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(INVALID_CREDENTIALS, 401);
  }

  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string" || password.length === 0) {
    return json(INVALID_CREDENTIALS, 401);
  }

  const trimmedUsername = username.trim();
  if (trimmedUsername.length === 0 || trimmedUsername.length > 100) {
    return json(INVALID_CREDENTIALS, 401);
  }

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: email, error: lookupErr } = await admin.rpc("get_email_by_username", { p_username: trimmedUsername });
    if (lookupErr || !email || typeof email !== "string" || email.length === 0) {
      return json(INVALID_CREDENTIALS, 401);
    }

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
    if (signInErr || !signInData.session) {
      return json(INVALID_CREDENTIALS, 401);
    }

    return json({
      access_token: signInData.session.access_token,
      refresh_token: signInData.session.refresh_token,
    }, 200);
  } catch {
    return json(LOGIN_UNAVAILABLE, 503);
  }
});
