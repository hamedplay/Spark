import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0098")) return digits.slice(2);
  if (digits.startsWith("98") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return "98" + digits.slice(1);
  if (digits.length === 10) return "98" + digits;
  return digits;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const mode: string = body.mode || "send";
    const providerId: string | undefined = body.providerId;

    // ── Fetch provider ────────────────────────────────────────────────
    let q = supabase.from("sms_providers").select("*").eq("is_active", true);
    if (providerId) q = q.eq("id", providerId);
    else q = q.eq("is_default", true);

    const { data: providers, error: provErr } = await q.limit(1);
    if (provErr || !providers?.length) {
      return json({ ok: false, error: "سرویس‌دهنده SMS فعالی یافت نشد" }, 400);
    }

    const p = providers[0];

    // ── Route to Rahyab if provider_type === 'rahyab' ─────────────────
    if (p.provider_type === "rahyab") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const providerOverride = {
        token:      p.token || p.api_key || "",
        username:   p.username || "",
        password:   p.password || "",
        short_code: p.line_number || "",
        soap_url:   p.api_url || "http://RahyabBulk.ir/WebService/sms.asmx",
      };

      const rahyabBody = mode === "test_connection"
        ? { action: "test", _providerOverride: providerOverride }
        : { action: "send", mobiles: body.mobiles, message: body.message, isFarsi: true, _providerOverride: providerOverride };

      const resp = await fetch(`${supabaseUrl}/functions/v1/rahyab-sms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(rahyabBody),
      });
      const data = await resp.json();
      return new Response(JSON.stringify(data), {
        status: resp.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Standard REST provider (sms.ir-style) ─────────────────────────
    const apiKey: string = p.api_key || "";
    const lineNumber: string = p.line_number || "";
    const baseUrl: string = (p.api_url || "https://api.sms.ir").replace(/\/$/, "");

    if (!apiKey) return json({ ok: false, error: "کلید API تنظیم نشده است" }, 400);

    // ── MODE: test_connection ─────────────────────────────────────────
    if (mode === "test_connection") {
      let creditRaw: Response;
      try {
        creditRaw = await fetch(`${baseUrl}/v1/credit`, {
          headers: { "Accept": "application/json", "X-API-KEY": apiKey },
        });
      } catch (e: any) {
        return json({ ok: false, error: `خطای اتصال: ${e.message}` });
      }

      const text = await creditRaw.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { rawText: text }; }

      if (!creditRaw.ok) {
        return json({ ok: false, httpStatus: creditRaw.status, response: data,
          error: data?.message || `HTTP ${creditRaw.status}` });
      }
      if (data?.status !== 1) {
        return json({ ok: false, response: data,
          error: data?.message || "پاسخ غیرمنتظره از سرور" });
      }
      return json({ ok: true, credit: data.data, response: data });
    }

    // ── MODE: send (likeToLike) ───────────────────────────────────────
    const mobiles: string[] = body.mobiles || [];
    const message: string = body.message || "";
    const messageTextsInput: string[] | undefined = body.messageTexts;
    const sendDateTime: number | null = body.sendDateTime ?? null;

    if (!mobiles.length) return json({ ok: false, error: "شماره موبایل وارد نشده" }, 400);
    if (!lineNumber) return json({ ok: false, error: "شماره خط ارسال تنظیم نشده است" }, 400);

    const pairs: { mobile: string; text: string }[] = mobiles
      .map((m, i) => ({ mobile: m, text: messageTextsInput?.[i] ?? message }))
      .filter(({ mobile }) => mobile?.trim().length >= 7)
      .map(({ mobile, text }) => ({ mobile: normalizePhone(mobile), text }));

    if (!pairs.length) return json({ ok: false, error: "شماره موبایل معتبری یافت نشد" }, 400);

    const messageTexts = pairs.map(x => x.text);
    const normalized = pairs.map(x => x.mobile);

    if (messageTexts.some(t => !t.trim())) {
      return json({ ok: false, error: "متن پیام وارد نشده" }, 400);
    }

    const lineNumberValue = Number(lineNumber.replace(/\D/g, ""));

    const payload: Record<string, unknown> = {
      lineNumber: lineNumberValue,
      messageTexts,
      mobiles: normalized,
      sendDateTime,
    };

    let smsRaw: Response;
    try {
      smsRaw = await fetch(`${baseUrl}/v1/send/likeToLike`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-API-KEY": apiKey,
        },
        body: JSON.stringify(payload),
      });
    } catch (e: any) {
      return json({ ok: false, error: `خطای اتصال به سرور: ${e.message}` });
    }

    const text = await smsRaw.text();
    let smsData: any;
    try { smsData = JSON.parse(text); } catch { smsData = { rawText: text }; }

    if (!smsRaw.ok) {
      return json({ ok: false, httpStatus: smsRaw.status, response: smsData,
        error: smsData?.message || `HTTP ${smsRaw.status}` });
    }

    if (smsData?.status !== 1) {
      return json({ ok: false, response: smsData,
        error: smsData?.message || "ارسال ناموفق" });
    }

    return json({
      ok: true,
      sent: normalized.length,
      packId: smsData.data?.packId,
      messageIds: smsData.data?.messageIds,
      cost: smsData.data?.cost,
      response: smsData,
    });

  } catch (err: any) {
    return json({ ok: false, error: err?.message || "خطای داخلی سرور" }, 500);
  }
});
