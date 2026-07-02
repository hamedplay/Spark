import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// Accepts 09xxxxxxxxx, 9xxxxxxxxx, +98xxxxxxxxx, 0098xxxxxxxxx
const PHONE_RE = /^(\+?98|0098|0)?9[0-9]{9}$/;

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0098")) return digits.slice(2);
  if (digits.startsWith("98") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return "98" + digits.slice(1);
  if (digits.length === 10) return "98" + digits;
  return digits;
}

function isValidPhone(raw: string): boolean {
  return PHONE_RE.test(raw.replace(/\s/g, ""));
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Validates the Bearer JWT and returns the caller's profile, or null on failure. */
async function authenticate(
  authHeader: string | null,
): Promise<{ userId: string; isAdmin: boolean } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const supabase = adminClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_active) return null;
  return { userId: user.id, isAdmin: profile?.is_admin === true };
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

  // ── Authentication ──────────────────────────────────────────────────────────
  const caller = await authenticate(req.headers.get("Authorization"));
  if (!caller) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const supabase = adminClient();

    const body = await req.json();
    const mode: string = body.mode || "send";
    const providerId: string | undefined = body.providerId;

    // test_connection and provider management require admin
    if (mode === "test_connection" && !caller.isAdmin) {
      return json({ ok: false, error: "Forbidden: admin access required" }, 403);
    }

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

      let rahyabBody: Record<string, unknown>;
      if (mode === "test_connection") {
        rahyabBody = { action: "test", _providerOverride: providerOverride };
      } else if (mode === "rahyab_test") {
        rahyabBody = { ...body.rahyabPayload, _providerOverride: providerOverride };
      } else {
        rahyabBody = { action: "send", mobiles: body.mobiles, message: body.message, isFarsi: true, _providerOverride: providerOverride };
      }

      // Internal service-to-service call; service key is the correct credential here.
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
    const rawMobiles: string[] = body.mobiles || [];
    const message: string = body.message || "";
    const messageTextsInput: string[] | undefined = body.messageTexts;
    const sendDateTime: number | null = body.sendDateTime ?? null;

    if (!rawMobiles.length) return json({ ok: false, error: "شماره موبایل وارد نشده" }, 400);
    if (!lineNumber) return json({ ok: false, error: "شماره خط ارسال تنظیم نشده است" }, 400);

    // Validate each destination number before any external call
    const invalidNumbers = rawMobiles.filter(m => !isValidPhone(m.replace(/\s/g, "")));
    if (invalidNumbers.length > 0) {
      return json({ ok: false, error: `شماره موبایل نامعتبر: ${invalidNumbers.slice(0, 3).join(", ")}` }, 400);
    }

    const pairs: { mobile: string; text: string }[] = rawMobiles
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
