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

/** Validates the Bearer JWT (or service role key) and returns the caller's profile, or null on failure. */
async function authenticate(
  authHeader: string | null,
): Promise<{ userId: string; isAdmin: boolean } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  // Accept internal service-to-service calls using the service role key
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey.length > 0) {
    const enc = new TextEncoder();
    const a = enc.encode(token);
    const b = enc.encode(serviceKey);
    if (a.length === b.length) {
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
      if (diff === 0) return { userId: "service", isAdmin: true };
    }
  }

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

    // ── Route to Rahyab REST if provider_type === 'rahyab_rest' ─────────
    if (p.provider_type === "rahyab_rest") {
      const apiBase = (p.api_url || "https://rahyabbulk.ir:8443").replace(/\/$/, "");
      const token = p.token?.trim() || "";
      // Per Rahyab docs: when using token, username=token, password=any 5+ char string
      const effUsername = token || p.username?.trim() || "";
      const effPassword = token ? "aBcD1" : (p.password?.trim() || "");
      const fromNumber = p.line_number?.trim() || "";

      if (!effUsername) return json({ ok: false, error: "نام کاربری یا توکن پیکربندی نشده است" }, 400);

      const maskVal = (v: string) => (!v || v.length <= 4) ? "***" : "***" + v.slice(-4);
      const maskPhone = (v: string) => (!v || v.length <= 4) ? "***" : v.slice(0, 3) + "****" + v.slice(-4);

      type DebugEntry = {
        soapAction: string; url: string;
        requestHeaders: Record<string, string>; requestBody: string;
        requestTimestamp: string; durationMs: number;
        responseStatus?: number; responseBody?: string;
        parsedResult?: string; error?: string;
      };

      const callRest = async (
        url: string,
        params: Record<string, string>,
        method: "GET" | "POST" = "GET",
      ): Promise<{ ok: boolean; status: number; body: string; durationMs: number; t0: number; error?: string }> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 13000);
        const t0 = Date.now();
        try {
          let fetchUrl = url;
          const fetchOpts: RequestInit = {
            method, signal: controller.signal,
            headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
          };
          if (method === "GET" && Object.keys(params).length) {
            fetchUrl += "?" + new URLSearchParams(params).toString();
          } else if (method === "POST") {
            fetchOpts.body = new URLSearchParams(params).toString();
          }
          const res = await fetch(fetchUrl, fetchOpts);
          clearTimeout(timer);
          const text = await res.text();
          return { ok: res.ok, status: res.status, body: text, durationMs: Date.now() - t0, t0 };
        } catch (e: any) {
          clearTimeout(timer);
          const msg = e?.name === "AbortError" ? "اتصال timeout شد (13s)" : e.message;
          return { ok: false, status: 0, body: "", durationMs: Date.now() - t0, t0, error: msg };
        }
      };

      const buildEntry = (
        label: string, url: string, method: string,
        maskedParams: Record<string, string>,
        r: { ok: boolean; status: number; body: string; durationMs: number; t0: number; error?: string },
      ): DebugEntry => ({
        soapAction: `${method} ${label}`,
        url,
        requestHeaders: method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" } : {},
        requestBody: new URLSearchParams(maskedParams).toString(),
        requestTimestamp: new Date(r.t0).toISOString(),
        durationMs: r.durationMs,
        responseStatus: r.status || undefined,
        responseBody: r.body || undefined,
        parsedResult: r.body?.trim().slice(0, 500) || undefined,
        error: r.error,
      });

      const maskedCreds = (extra: Record<string, string> = {}): Record<string, string> => ({
        username: token ? "***token***" : effUsername,
        password: maskVal(effPassword),
        ...extra,
      });

      // ── test_connection → GET /ip.ashx ────────────────────────────────
      if (mode === "test_connection") {
        const url = `${apiBase}/ip.ashx`;
        const r = await callRest(url, {}, "GET");
        const dbg = [buildEntry("/ip.ashx", url, "GET", {}, r)];
        if (!r.ok || r.error) return json({ ok: false, error: r.error || `HTTP ${r.status}`, debug: dbg });
        return json({ ok: true, ip: r.body?.trim(), debug: dbg });
      }

      // ── send ──────────────────────────────────────────────────────────
      if (mode === "send") {
        const rawMobiles: string[] = body.mobiles || [];
        const message: string = body.message || "";
        if (!rawMobiles.length) return json({ ok: false, error: "شماره موبایل وارد نشده" }, 400);
        if (!message.trim()) return json({ ok: false, error: "متن پیام وارد نشده" }, 400);
        if (!fromNumber) return json({ ok: false, error: "شماره فرستنده پیکربندی نشده است" }, 400);

        const url = `${apiBase}/url/send.ashx`;
        const allIds: string[] = [];
        const errors: string[] = [];

        for (const to of rawMobiles) {
          const params: Record<string, string> = {
            username: effUsername, password: effPassword,
            from: fromNumber, to: to.trim(), farsi: "true", message,
          };
          const r = await callRest(url, params, "POST");
          const responseBody = (r.body || "").trim();
          const isOk = r.ok && /^\d+/.test(responseBody);
          if (isOk) allIds.push(responseBody);
          else errors.push(`${maskPhone(to)}: ${responseBody || r.error || "ارسال ناموفق"}`);
        }

        return json({
          ok: errors.length === 0,
          sent: allIds.length,
          returnIds: allIds,
          errors,
        });
      }

      // ── rahyab_rest_test — individual test actions ─────────────────────
      if (mode === "rahyab_rest_test") {
        const action: string = body.action || "";

        if (action === "ip") {
          const url = `${apiBase}/ip.ashx`;
          const r = await callRest(url, {}, "GET");
          return json({ ok: !r.error && r.ok, ip: r.body?.trim(), debug: [buildEntry("/ip.ashx", url, "GET", {}, r)] });
        }

        if (action === "get_info") {
          const url = `${apiBase}/url/GetInfoXML.ashx`;
          const params = { username: effUsername, password: effPassword };
          const r = await callRest(url, params, "POST");
          const dbg = [buildEntry("/url/GetInfoXML.ashx", url, "POST", maskedCreds(), r)];
          return json({ ok: !r.error && r.ok, rawResult: r.body, debug: dbg });
        }

        if (action === "send") {
          const to: string = body.to || "";
          const message: string = body.message || "";
          if (!to) return json({ ok: false, error: "شماره گیرنده وارد نشده" });
          if (!message) return json({ ok: false, error: "متن پیام وارد نشده" });
          if (!fromNumber) return json({ ok: false, error: "شماره فرستنده پیکربندی نشده است" });

          const url = `${apiBase}/url/send.ashx`;
          const params: Record<string, string> = {
            username: effUsername, password: effPassword,
            from: fromNumber, to: to.trim(), farsi: "true", message,
          };
          const r = await callRest(url, params, "POST");
          const maskedP = maskedCreds({ from: fromNumber, to: maskPhone(to), farsi: "true", message: message.slice(0, 20) + (message.length > 20 ? "…" : "") });
          const responseBody = (r.body || "").trim();
          const isOk = !r.error && r.ok && /^\d+/.test(responseBody);
          return json({ ok: isOk, returnId: isOk ? responseBody : undefined, rawResult: responseBody, debug: [buildEntry("/url/send.ashx", url, "POST", maskedP, r)] });
        }

        if (action === "delivery") {
          const returnIds: string = body.returnIds || "";
          if (!returnIds.trim()) return json({ ok: false, error: "شناسه بازگشتی وارد نشده" });
          const url = `${apiBase}/url/delivery.ashx`;
          const params = { ReturnIDs: returnIds };
          const r = await callRest(url, params, "GET");
          return json({ ok: !r.error && r.ok, rawResult: r.body, debug: [buildEntry("/url/delivery.ashx", url, "GET", params, r)] });
        }

        if (action === "receive") {
          const lastRowId = String(body.lastRowId ?? "0");
          const url = `${apiBase}/url/receive.ashx`;
          const params = { LastRowID: lastRowId };
          const r = await callRest(url, params, "GET");
          return json({ ok: !r.error && r.ok, rawResult: r.body, debug: [buildEntry("/url/receive.ashx", url, "GET", params, r)] });
        }

        return json({ ok: false, error: `عملیات ناشناخته: ${action}` }, 400);
      }

      return json({ ok: false, error: "mode نامعتبر برای rahyab_rest" }, 400);
    }

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
        rahyabBody = { action: "test", _providerOverride: providerOverride, debug: true };
      } else if (mode === "rahyab_test") {
        rahyabBody = { ...body.rahyabPayload, _providerOverride: providerOverride, debug: true };
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
      const reqUrl = `${baseUrl}/v1/credit`;
      const reqHeaders = { "Accept": "application/json", "X-API-KEY": `***${apiKey.slice(-4)}` };
      const reqTimestamp = new Date().toISOString();
      const t0 = Date.now();

      let creditRaw: Response;
      try {
        creditRaw = await fetch(reqUrl, {
          headers: { "Accept": "application/json", "X-API-KEY": apiKey },
        });
      } catch (e: any) {
        const durationMs = Date.now() - t0;
        const debugEntry = {
          soapAction: "GET /v1/credit",
          url: reqUrl,
          requestHeaders: reqHeaders,
          requestBody: "",
          requestTimestamp: reqTimestamp,
          durationMs,
          error: e.message,
        };
        return json({ ok: false, error: `خطای اتصال: ${e.message}`, debug: [debugEntry] });
      }

      const durationMs = Date.now() - t0;
      const text = await creditRaw.text();
      const responseHeaders: Record<string, string> = {};
      creditRaw.headers.forEach((v, k) => { responseHeaders[k] = v; });

      let data: any;
      try { data = JSON.parse(text); } catch { data = { rawText: text }; }

      const debugEntry = {
        soapAction: "GET /v1/credit",
        url: reqUrl,
        requestHeaders: reqHeaders,
        requestBody: "",
        requestTimestamp: reqTimestamp,
        durationMs,
        responseStatus: creditRaw.status,
        responseHeaders,
        responseBody: text,
        parsedResult: JSON.stringify(data),
        error: !creditRaw.ok ? (data?.message || `HTTP ${creditRaw.status}`) : (data?.status !== 1 ? (data?.message || "پاسخ غیرمنتظره") : undefined),
      };

      if (!creditRaw.ok) {
        return json({ ok: false, httpStatus: creditRaw.status, response: data,
          error: data?.message || `HTTP ${creditRaw.status}`, debug: [debugEntry] });
      }
      if (data?.status !== 1) {
        return json({ ok: false, response: data,
          error: data?.message || "پاسخ غیرمنتظره از سرور", debug: [debugEntry] });
      }
      return json({ ok: true, credit: data.data, response: data, debug: [debugEntry] });
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

    const sendReqUrl = `${baseUrl}/v1/send/likeToLike`;
    const sendReqHeaders = {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "X-API-KEY": `***${apiKey.slice(-4)}`,
    };
    const sendReqBody = JSON.stringify(payload);
    const sendReqTimestamp = new Date().toISOString();
    const sendT0 = Date.now();

    let smsRaw: Response;
    try {
      smsRaw = await fetch(sendReqUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "X-API-KEY": apiKey,
        },
        body: sendReqBody,
      });
    } catch (e: any) {
      const durationMs = Date.now() - sendT0;
      const debugEntry = {
        soapAction: "POST /v1/send/likeToLike",
        url: sendReqUrl,
        requestHeaders: sendReqHeaders,
        requestBody: sendReqBody,
        requestTimestamp: sendReqTimestamp,
        durationMs,
        error: e.message,
      };
      return json({ ok: false, error: `خطای اتصال به سرور: ${e.message}`, debug: [debugEntry] });
    }

    const sendDurationMs = Date.now() - sendT0;
    const text = await smsRaw.text();
    const sendResponseHeaders: Record<string, string> = {};
    smsRaw.headers.forEach((v, k) => { sendResponseHeaders[k] = v; });

    let smsData: any;
    try { smsData = JSON.parse(text); } catch { smsData = { rawText: text }; }

    const sendDebugEntry = {
      soapAction: "POST /v1/send/likeToLike",
      url: sendReqUrl,
      requestHeaders: sendReqHeaders,
      requestBody: sendReqBody,
      requestTimestamp: sendReqTimestamp,
      durationMs: sendDurationMs,
      responseStatus: smsRaw.status,
      responseHeaders: sendResponseHeaders,
      responseBody: text,
      parsedResult: JSON.stringify(smsData),
      error: !smsRaw.ok ? (smsData?.message || `HTTP ${smsRaw.status}`) : (smsData?.status !== 1 ? (smsData?.message || "ارسال ناموفق") : undefined),
    };

    if (!smsRaw.ok) {
      return json({ ok: false, httpStatus: smsRaw.status, response: smsData,
        error: smsData?.message || `HTTP ${smsRaw.status}`, debug: [sendDebugEntry] });
    }

    if (smsData?.status !== 1) {
      return json({ ok: false, response: smsData,
        error: smsData?.message || "ارسال ناموفق", debug: [sendDebugEntry] });
    }

    return json({
      ok: true,
      sent: normalized.length,
      packId: smsData.data?.packId,
      messageIds: smsData.data?.messageIds,
      cost: smsData.data?.cost,
      response: smsData,
      debug: [sendDebugEntry],
    });

  } catch (err: any) {
    return json({ ok: false, error: err?.message || "خطای داخلی سرور" }, 500);
  }
});
