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
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  // ── Authentication ──────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ ok: false, error: "احراز هویت لازم است" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ ok: false, error: "دسترسی غیرمجاز" }, 401);

  // ── Parse body ──────────────────────────────────────────────────────────────
  let body: { userId?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "بدنه درخواست نامعتبر" }, 400);
  }

  const { userId, text } = body;
  if (!userId || typeof userId !== "string") return json({ ok: false, error: "userId لازم است" }, 400);
  if (!text || typeof text !== "string") return json({ ok: false, error: "text لازم است" }, 400);

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Authorization: caller must be admin OR in the same organization ─────────
  // Fetch caller's profile
  const { data: callerProfile, error: callerErr } = await admin
    .from("profiles")
    .select("is_admin, is_active, organization")
    .eq("user_id", user.id)
    .maybeSingle();

  if (callerErr || !callerProfile) {
    return json({ ok: false, error: "دسترسی غیرمجاز" }, 401);
  }
  if (!callerProfile.is_active) {
    return json({ ok: false, error: "حساب کاربری غیرفعال است" }, 403);
  }

  if (!callerProfile.is_admin) {
    // Non-admin: target must be in the same organization and be active
    const { data: targetProfile, error: targetErr } = await admin
      .from("profiles")
      .select("is_active, organization")
      .eq("user_id", userId)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      return json({ ok: false, error: "کاربر مورد نظر یافت نشد" }, 403);
    }
    if (!targetProfile.is_active) {
      return json({ ok: false, error: "کاربر مورد نظر غیرفعال است" }, 403);
    }

    const callerOrg = (callerProfile.organization ?? "").trim();
    const targetOrg = (targetProfile.organization ?? "").trim();

    // Reject cross-organization messaging
    if (!callerOrg || !targetOrg || callerOrg !== targetOrg) {
      return json({ ok: false, error: "دسترسی غیرمجاز: کاربران باید در یک سازمان باشند" }, 403);
    }
  }

  // ── Check bot config ────────────────────────────────────────────────────────
  const { data: cfg, error: cfgErr } = await admin
    .from("social_channel_configs")
    .select("bot_token, is_active")
    .eq("channel", "bale")
    .maybeSingle();

  if (cfgErr) {
    console.error("[send-bale-message] config error:", cfgErr.message);
    return json({ ok: false, error: "خطا در خواندن تنظیمات بله" }, 500);
  }

  if (!cfg?.is_active) {
    return json({ ok: true, skipped: true, reason: "بله غیرفعال است" });
  }

  const botToken = (cfg?.bot_token ?? "").trim();
  if (!botToken) {
    return json({ ok: true, skipped: true, reason: "توکن بات تنظیم نشده" });
  }

  // ── Look up target user's Bale chat ID ──────────────────────────────────────
  const { data: mapping, error: mapErr } = await admin
    .from("user_bale_mapping")
    .select("bale_chat_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (mapErr) {
    console.error("[send-bale-message] mapping lookup error:", mapErr.message);
    return json({ ok: false, error: "خطا در خواندن مپینگ بله" }, 500);
  }

  if (!mapping?.bale_chat_id) {
    return json({ ok: true, skipped: true, reason: "کاربر به بله متصل نیست" });
  }

  // ── Send message via Bale API ───────────────────────────────────────────────
  try {
    const res = await fetch(`https://tapi.bale.ai/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: mapping.bale_chat_id, text }),
    });

    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn("[send-bale-message] Bale API HTTP %s: %s", res.status, errBody.slice(0, 200));
      return json({ ok: false, error: `Bale API HTTP ${res.status}` });
    }

    return json({ ok: true });
  } catch (e: any) {
    console.error("[send-bale-message] network error:", e?.message);
    return json({ ok: false, error: "خطای شبکه هنگام ارسال به بله" }, 502);
  }
});
