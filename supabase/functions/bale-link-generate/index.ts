import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.111.0";
import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Pragma": "no-cache",
    },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authResult = await requireFullAuthAccess(req);
    if (!authResult.ok) return deniedResponse();
    const userId = authResult.userId!;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[bale-link-generate] Supabase service environment is incomplete");
      return json({ ok: false, error: "سرویس اتصال بله آماده نیست" }, 500);
    }

    const admin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: channelCfg, error: cfgErr } = await admin
      .from("social_channel_configs")
      .select("bot_username, is_active")
      .eq("channel", "bale")
      .maybeSingle();

    if (cfgErr) {
      console.error("[bale-link-generate] config error:", cfgErr.message);
      return json({ ok: false, error: "خطا در خواندن تنظیمات" }, 500);
    }
    if (!channelCfg || !channelCfg.is_active) {
      return json({ ok: false, error: "اتصال بله در حال حاضر غیرفعال است" }, 403);
    }

    const baleBotUsername = (channelCfg.bot_username ?? "").replace(/^@/, "").trim();
    if (!/^[a-zA-Z0-9_]{3,32}$/.test(baleBotUsername)) {
      return json({ ok: false, error: "bot_username نامعتبر است" }, 500);
    }

    // The database generates, HMACs and stores the one-time nonce using
    // Bale-specific cryptographic material kept in Supabase Vault.
    const { data: nonceData, error: nonceErr } = await admin.rpc(
      "create_bale_link_nonce_service",
      { p_user_id: userId },
    );

    if (nonceErr || !nonceData || nonceData.ok !== true || typeof nonceData.nonce !== "string") {
      console.error("[bale-link-generate] nonce RPC error:", nonceErr?.message ?? "invalid response");
      return json({ ok: false, error: "خطا در تولید لینک اتصال" }, 500);
    }

    const nonce = nonceData.nonce as string;
    const expiresAt = nonceData.expires_at as string;
    const url = `https://ble.ir/${baleBotUsername}?start=${encodeURIComponent(nonce)}`;

    return json({ ok: true, url, nonce, expires_at: expiresAt });
  } catch (err) {
    console.error("[bale-link-generate] unexpected error:", err instanceof Error ? err.message : String(err));
    return json({ ok: false, error: "خطای داخلی در تولید لینک اتصال" }, 500);
  }
});
