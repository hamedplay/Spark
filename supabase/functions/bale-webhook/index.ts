import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Always return 200 — any non-200 causes Bale to re-deliver and pending_update_count grows
const ok = () => new Response("OK", { status: 200 });

Deno.serve(async (req: Request) => {
  // Global try/catch: log unexpected errors but always reply 200
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 200 });
    if (req.method !== "POST") return ok();

    // ── Parse body ─────────────────────────────────────────────────────────
    let update: Record<string, any>;
    try {
      update = await req.json();
    } catch {
      console.error("[bale-webhook] invalid JSON body");
      return ok();
    }

    // Bale delivers messages as update.message; edits as update.edited_message
    const msg = update.message ?? update.edited_message;
    const chatId: number | undefined = msg?.chat?.id;
    const text: string = (msg?.text ?? "").trim();

    // Skip anything that isn't a /start command
    if (!chatId || !text.startsWith("/start")) {
      return ok();
    }

    // ── Extract deep-link token ─────────────────────────────────────────────
    // Handles: /start TOKEN  |  /start=TOKEN  |  /start@botname TOKEN
    const startMatch = text.match(/^\/start(?:@\w+)?(?:[\s=]+(\S+))?/i);
    const linkToken: string | null = startMatch?.[1] ?? null;

    // ── Supabase client (service_role — bypasses RLS) ───────────────────────
    // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by Supabase.
    // All other config (bot_token, is_active) is read from the DB below.
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Load bot config from social_channel_configs ─────────────────────────
    const { data: cfg, error: cfgErr } = await supabase
      .from("social_channel_configs")
      .select("bot_token, is_active")
      .eq("channel", "bale")
      .single();

    if (cfgErr) {
      console.error("[bale-webhook] config read error:", cfgErr.message);
      return ok();
    }

    if (!cfg.is_active) {
      console.warn("[bale-webhook] bot is inactive (is_active=false) — skipping");
      return ok();
    }

    const botToken: string = (cfg.bot_token ?? "").trim();
    if (!botToken) {
      console.error("[bale-webhook] bot_token is empty in social_channel_configs");
      return ok();
    }

    // ── /start without deep-link token → welcome message ───────────────────
    if (!linkToken) {
      await sendMessage(botToken, chatId, "سلام! برای دریافت اعلان‌های سامانه، از بخش پروفایل روی «اتصال به بله» کلیک کنید.");
      return ok();
    }

    // ── Atomic token consumption ────────────────────────────────────────────
    // Single UPDATE with WHERE used=false AND expires_at>now() — race-condition safe.
    // If the returned array is empty the token was already used, expired, or invalid.
    // Note: bale_link_tokens.token is PRIMARY KEY, so uniqueness is already guaranteed.
    const { data: consumed, error: markErr } = await supabase
      .from("bale_link_tokens")
      .update({ used: true })
      .eq("token", linkToken)
      .eq("used", false)
      .gt("expires_at", new Date().toISOString())
      .select("user_id");

    if (markErr) {
      console.error("[bale-webhook] token mark-used error:", markErr.message);
      await sendMessage(botToken, chatId, "خطای داخلی. لطفاً دوباره تلاش کنید.");
      return ok();
    }

    if (!consumed || consumed.length === 0) {
      console.log("[bale-webhook] token invalid/used/expired — chat_id=%s", chatId);
      await sendMessage(botToken, chatId, "❌ لینک اتصال نامعتبر یا منقضی شده است. لطفاً از سامانه دوباره روی «اتصال به بله» کلیک کنید.");
      return ok();
    }

    const userId: string = consumed[0].user_id;
    const now = new Date().toISOString();

    // ── Upsert user ↔ Bale chat mapping ────────────────────────────────────
    const { error: upsertErr } = await supabase
      .from("user_bale_mapping")
      .upsert(
        { user_id: userId, bale_chat_id: String(chatId), connected_at: now, last_connected_at: now },
        { onConflict: "user_id" },
      );

    if (upsertErr) {
      console.error("[bale-webhook] upsert mapping error:", upsertErr.message);
      await sendMessage(botToken, chatId, "خطا در ذخیره‌سازی. لطفاً دوباره تلاش کنید.");
      return ok();
    }

    console.log("[bale-webhook] SUCCESS user_id=%s linked bale_chat_id=%s", userId, chatId);
    await sendMessage(botToken, chatId, "✅ اتصال شما با موفقیت انجام شد. از این پس اعلان‌های جلسه را اینجا دریافت می‌کنید.");
    return ok();

  } catch (err) {
    console.error("[bale-webhook] unexpected error:", err);
    return ok();
  }
});

async function sendMessage(token: string, chatId: number | string, text: string): Promise<void> {
  try {
    const res = await fetch(`https://tapi.bale.ai/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn("[bale-webhook] sendMessage HTTP %s: %s", res.status, body.slice(0, 200));
    }
  } catch (e) {
    console.warn("[bale-webhook] sendMessage network error:", e);
  }
}
