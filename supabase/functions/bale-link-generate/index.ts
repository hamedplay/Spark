import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return json({ ok: false, error: "احراز هویت لازم است" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  // Verify the calling user
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) {
    return json({ ok: false, error: "دسترسی غیرمجاز" }, 401);
  }

  const admin = createClient(supabaseUrl, supabaseServiceKey);

  // Read bot config from DB (service_role bypasses RLS)
  const { data: channelCfg, error: cfgErr } = await admin
    .from("social_channel_configs")
    .select("bot_username, is_active")
    .eq("channel", "bale")
    .maybeSingle();

  if (cfgErr) {
    return json({ ok: false, error: "خطا در خواندن تنظیمات: " + cfgErr.message }, 500);
  }
  if (!channelCfg || !channelCfg.is_active) {
    return json({ ok: false, error: "اتصال بله در حال حاضر غیرفعال است" }, 403);
  }

  const baleBotUsername = (channelCfg.bot_username ?? "").replace(/^@/, "").trim();
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(baleBotUsername)) {
    return json({ ok: false, error: "bot_username نامعتبر است" }, 500);
  }

  const now = new Date();

  // Return existing valid unused token if present (avoid token proliferation)
  const { data: existing, error: selErr } = await admin
    .from("bale_link_tokens")
    .select("token, expires_at")
    .eq("user_id", user.id)
    .eq("used", false)
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selErr) {
    return json({ ok: false, error: "خطا در بررسی توکن: " + selErr.message }, 500);
  }

  let token: string;
  let expiresAt: string;

  if (existing) {
    token = existing.token;
    expiresAt = existing.expires_at;
  } else {
    // Generate a secure random token (32 hex chars = 16 bytes)
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    token = Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
    expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();

    const { error: insertErr } = await admin.from("bale_link_tokens").insert({
      token,
      user_id: user.id,
      expires_at: expiresAt,
    });
    if (insertErr) {
      return json({ ok: false, error: "خطا در تولید توکن: " + insertErr.message }, 500);
    }
  }

  const url = `https://ble.ir/${baleBotUsername}?start=${token}`;
  return json({ ok: true, url, token, expires_at: expiresAt });
});
