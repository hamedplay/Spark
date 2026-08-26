import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.111.0";

const ok = () => new Response("OK", { status: 200 });

Deno.serve(async (req: Request) => {
  try {
    if (req.method === "OPTIONS") return new Response(null, { status: 200 });
    if (req.method !== "POST") return ok();

    let update: Record<string, any>;
    try {
      update = await req.json();
    } catch {
      return ok();
    }

    const msg = update.message ?? update.edited_message;
    const chatId: number | undefined = msg?.chat?.id;
    const text: string = (msg?.text ?? "").trim();
    if (!chatId || !text.startsWith("/start")) return ok();

    const startMatch = text.match(/^\/start(?:@\w+)?(?:[\s=]+(\S+))?/i);
    const linkToken: string | null = startMatch?.[1] ?? null;

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const botToken = Deno.env.get("BALE_BOT_TOKEN") ?? "";

    if (!supabaseUrl || !serviceKey) {
      console.error("[bale-webhook] Supabase service environment is incomplete");
      return ok();
    }
    if (!botToken) {
      console.error("[bale-webhook] BALE_BOT_TOKEN not configured");
      return ok();
    }

    if (!linkToken) {
      await sendMessage(botToken, chatId, "سلام! برای دریافت اعلان‌های سامانه، از بخش پروفایل روی «اتصال به بله» کلیک کنید.");
      return ok();
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Token lookup, expiry check, single-use consume, chat-id encryption,
    // mapping update and audit all happen in one database transaction.
    const { data: consumeResult, error: consumeErr } = await supabase.rpc(
      "consume_bale_link_nonce_service",
      {
        p_nonce: linkToken,
        p_bale_chat_id: String(chatId),
      },
    );

    if (consumeErr) {
      console.error("[bale-webhook] consume RPC error:", consumeErr.message);
      await sendMessage(botToken, chatId, "خطای داخلی. لطفاً دوباره تلاش کنید.");
      return ok();
    }

    if (!consumeResult || consumeResult.ok !== true) {
      await sendMessage(
        botToken,
        chatId,
        "❌ لینک اتصال نامعتبر، منقضی یا قبلاً استفاده شده است. لطفاً از سامانه دوباره روی «اتصال به بله» کلیک کنید.",
      );
      return ok();
    }

    console.log("[bale-webhook] Bale account linked successfully");
    await sendMessage(botToken, chatId, "✅ اتصال شما با موفقیت انجام شد. از این پس اعلان‌های جلسه را اینجا دریافت می‌کنید.");
    return ok();
  } catch (err) {
    console.error("[bale-webhook] unexpected error:", err instanceof Error ? err.message : String(err));
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
