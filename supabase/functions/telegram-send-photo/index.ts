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

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const commaIdx = dataUrl.indexOf(",");
  if (commaIdx === -1) throw new Error("invalid data URL");
  const base64 = dataUrl.slice(commaIdx + 1);
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return bytes;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Method not allowed" }, 405);

  // ── Auth ──────────────────────────────────────────────────────────────────────
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

  // ── Parse body ────────────────────────────────────────────────────────────────
  let body: { meetingId?: unknown; imageData?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "بدنه درخواست نامعتبر" }, 400);
  }

  const { meetingId, imageData } = body;
  if (!meetingId || typeof meetingId !== "string") {
    return json({ ok: false, error: "meetingId لازم است" }, 400);
  }
  if (!imageData || typeof imageData !== "string") {
    return json({ ok: false, error: "imageData لازم است" }, 400);
  }
  if (!imageData.startsWith("data:image/")) {
    return json({ ok: false, error: "فرمت تصویر نامعتبر است" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceKey);

  // ── Read user's Telegram credentials server-side (never returned to browser) ──
  const { data: profile, error: profileErr } = await admin
    .from("profiles")
    .select("telegram_token, telegram_chat_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileErr || !profile) {
    return json({ ok: false, error: "خطا در دریافت اطلاعات پروفایل" }, 500);
  }
  if (!profile.telegram_token || !profile.telegram_chat_id) {
    return json({
      ok: false,
      error: "لطفا ابتدا توکن و شناسه چت تلگرام را در پروفایل خود تنظیم کنید",
    }, 400);
  }

  // ── Read meeting details ──────────────────────────────────────────────────────
  const { data: meeting, error: meetingErr } = await admin
    .from("meetings")
    .select("subject, priority")
    .eq("id", meetingId)
    .maybeSingle();

  if (meetingErr || !meeting) {
    return json({ ok: false, error: "خطا در دریافت اطلاعات جلسه" }, 500);
  }

  // ── Build Telegram request server-side ────────────────────────────────────────
  const token = profile.telegram_token.trim().replace(/^bot/i, "");

  const caption =
    `درخواست جلسه جدید\n\nموضوع: ${meeting.subject}\nاولویت: ${
      meeting.priority === "high" ? "🔴 بالا" :
      meeting.priority === "medium" ? "🟡 متوسط" :
      "🟢 پایین"
    }\nشناسه جلسه: ${meetingId}`;

  const replyMarkup = JSON.stringify({
    inline_keyboard: [
      [
        { text: "✅ تایید", callback_data: `approve_${meetingId}` },
        { text: "❌ رد", callback_data: `reject_${meetingId}` },
      ],
      [
        { text: "🔴 اولویت بالا", callback_data: `priority_high_${meetingId}` },
        { text: "🟡 اولویت متوسط", callback_data: `priority_medium_${meetingId}` },
        { text: "🟢 اولویت پایین", callback_data: `priority_low_${meetingId}` },
      ],
    ],
  });

  let photoBytes: Uint8Array;
  try {
    photoBytes = dataUrlToBytes(imageData);
  } catch {
    return json({ ok: false, error: "تبدیل تصویر ناموفق بود" }, 400);
  }

  const formData = new FormData();
  formData.append("chat_id", profile.telegram_chat_id);
  formData.append("photo", new Blob([photoBytes], { type: "image/png" }), "meeting.png");
  formData.append("caption", caption);
  formData.append("reply_markup", replyMarkup);

  // ── Call Telegram API from server (token never leaves this function) ──────────
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendPhoto`,
      { method: "POST", body: formData },
    );
    const result = await res.json().catch(() => ({}));
    if (!res.ok || !result.ok) {
      console.error("[telegram-send-photo] Telegram API error:", result.description);
      return json({ ok: false, error: result.description || "خطا در ارسال به تلگرام" }, 502);
    }
    return json({ ok: true, message: "درخواست با موفقیت به تلگرام ارسال شد" });
  } catch (e: any) {
    console.error("[telegram-send-photo] network error:", e?.message);
    return json({ ok: false, error: "خطای شبکه هنگام ارسال به تلگرام" }, 502);
  }
});
