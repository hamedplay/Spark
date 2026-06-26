import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── SOAP helpers ──────────────────────────────────────────────────────────────

function soapEnvelope(action: string, params: Record<string, string>): string {
  const inner = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`)
    .join("");
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <${action} xmlns="http://tempuri.org/">${inner}</${action}>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function extractResult(xml: string, action: string): string {
  const tag = `${action}Result`;
  const m = xml.match(new RegExp(`<(?:[^:]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:]+:)?${tag}>`));
  if (!m) return "";
  return m[1]
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

async function callSoap(
  url: string,
  action: string,
  params: Record<string, string>,
  timeoutMs = 20000,
): Promise<{ ok: boolean; result: string; rawXml?: string; error?: string }> {
  const soapAction = `http://tempuri.org/${action}`;
  const body = soapEnvelope(action, params);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `"${soapAction}"`,
      },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);
    const rawXml = await res.text();
    if (!res.ok) {
      return { ok: false, result: "", rawXml, error: `HTTP ${res.status}` };
    }
    const result = extractResult(rawXml, action);
    return { ok: true, result, rawXml };
  } catch (e: any) {
    clearTimeout(timer);
    const msg = e?.name === "AbortError" ? "اتصال به وب‌سرویس زمان‌بر شد (timeout)" : e.message;
    return { ok: false, result: "", error: msg };
  }
}

// ── Parse helpers ─────────────────────────────────────────────────────────────

function parseGetInfo(result: string): { ok: boolean; credit: string; expireDate: string; error?: string } {
  // Response: OK;Credit;ExpireDate; e.g. OK;8546525;2022-02-22;
  if (!result.startsWith("OK")) return { ok: false, credit: "", expireDate: "", error: result };
  const parts = result.split(";");
  return { ok: true, credit: parts[1] ?? "", expireDate: parts[2] ?? "" };
}

function parseSendOk(result: string): { ok: boolean; returnIds: string[]; error?: string } {
  // Response: "Send OK.<ReturnIDs>id1;id2;-1</ReturnIDs>"
  if (!result.startsWith("Send OK")) {
    return { ok: false, returnIds: [], error: result };
  }
  const m = result.match(/<ReturnIDs>(.*?)<\/ReturnIDs>/s);
  const ids = m ? m[1].split(";").filter(id => id && id !== "-1") : [];
  return { ok: true, returnIds: ids };
}

function getCdata(inner: string, tag: string): string {
  // Handles both CDATA and plain text values
  const m = inner.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`));
  if (!m) return "";
  return (m[1] ?? m[2] ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function parseReceiveXml(xml: string): { rowId: string; dateTime: string; sender: string; receiver: string; message: string }[] {
  // Per API docs, doReceiveSMS returns <smsBatch><sms><rowID/><origAddr/><destAddr/><time/><message/>
  const items: { rowId: string; dateTime: string; sender: string; receiver: string; message: string }[] = [];
  const blocks = xml.matchAll(/<sms[^>]*>([\s\S]*?)<\/sms>/g);
  for (const b of blocks) {
    const inner = b[1];
    items.push({
      rowId:    getCdata(inner, "rowID"),
      dateTime: getCdata(inner, "time"),
      sender:   getCdata(inner, "origAddr"),
      receiver: getCdata(inner, "destAddr"),
      message:  getCdata(inner, "message"),
    });
  }
  return items;
}

function parseDelivery(returnIds: string[], result: string): Record<string, number> {
  // doGetDelivery returns plain status codes in order: "0;2;-1"
  // We map each status back to the corresponding returnId by position
  const statuses = result.split(";");
  const map: Record<string, number> = {};
  returnIds.forEach((id, i) => {
    const s = statuses[i];
    if (id && s !== undefined && s.trim() !== "") {
      map[id.trim()] = parseInt(s.trim(), 10);
    }
  });
  return map;
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const body = await req.json();
    const action: string = body.action; // send | get_info | receive | get_delivery | test | save_settings | load_settings | inbox

    // ── load_settings ────────────────────────────────────────────────
    if (action === "load_settings") {
      const { data } = await supabase.from("rahyab_settings").select("*").limit(1).maybeSingle();
      return json({ ok: true, settings: data });
    }

    // ── save_settings ────────────────────────────────────────────────
    if (action === "save_settings") {
      const s = body.settings ?? {};
      const existing = await supabase.from("rahyab_settings").select("id").limit(1).maybeSingle();
      if (existing.data?.id) {
        await supabase.from("rahyab_settings").update({
          username: s.username ?? "",
          password: s.password ?? "",
          short_code: s.short_code ?? "",
          token: s.token ?? "",
          soap_url: s.soap_url || "http://RahyabBulk.ir/WebService/sms.asmx",
          is_active: s.is_active ?? false,
          updated_at: new Date().toISOString(),
        }).eq("id", existing.data.id);
      } else {
        await supabase.from("rahyab_settings").insert([{
          username: s.username ?? "",
          password: s.password ?? "",
          short_code: s.short_code ?? "",
          token: s.token ?? "",
          soap_url: s.soap_url || "http://RahyabBulk.ir/WebService/sms.asmx",
          is_active: s.is_active ?? false,
        }]);
      }
      return json({ ok: true });
    }

    // ── inbox (list received messages from DB) ────────────────────────
    if (action === "inbox") {
      const { data } = await supabase
        .from("rahyab_inbox")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(200);
      return json({ ok: true, messages: data ?? [] });
    }

    // ── Resolve credentials: _providerOverride takes priority over DB ──
    // When called from send-sms with a rahyab-type provider, credentials
    // are passed directly so we don't need the legacy rahyab_settings table.
    const override = body._providerOverride as Record<string, string> | undefined;

    let soapUrl: string;
    let uUsername: string;
    let uPassword: string;
    let uNumber: string;

    if (override) {
      soapUrl   = override.soap_url   || "http://RahyabBulk.ir/WebService/sms.asmx";
      uUsername = override.token      || override.username || "";
      // Per API docs: when using token, password can be any string of ≥5 chars
      uPassword = override.password   || "12345";
      uNumber   = override.short_code || "";
    } else {
      const { data: settings } = await supabase
        .from("rahyab_settings")
        .select("*")
        .limit(1)
        .maybeSingle();

      if (!settings) return json({ ok: false, error: "تنظیمات رهیاب رایان پیکربندی نشده است" }, 400);

      soapUrl   = settings.soap_url || "http://RahyabBulk.ir/WebService/sms.asmx";
      uUsername = settings.token    || settings.username || "";
      uPassword = settings.password || "";
      uNumber   = settings.short_code || "";
    }

    if (!uUsername) return json({ ok: false, error: "نام کاربری یا توکن پیکربندی نشده است" }, 400);

    // ── get_info / test ───────────────────────────────────────────────
    if (action === "get_info" || action === "test") {
      const soap = await callSoap(soapUrl, "doGetInfo", {
        uUsername, uPassword,
      });
      if (!soap.ok) return json({ ok: false, error: soap.error ?? "خطای SOAP" });
      const info = parseGetInfo(soap.result);
      if (!info.ok) return json({ ok: false, error: info.error ?? "احراز هویت ناموفق" });
      return json({ ok: true, credit: info.credit, expireDate: info.expireDate });
    }

    // ── send ──────────────────────────────────────────────────────────
    if (action === "send") {
      const mobiles: string[] = body.mobiles ?? [];
      const message: string = body.message ?? "";
      const isFarsi: boolean = body.isFarsi !== false;
      const isFlash: boolean = body.isFlash === true;

      if (!mobiles.length) return json({ ok: false, error: "شماره موبایل وارد نشده" }, 400);
      if (!message.trim()) return json({ ok: false, error: "متن پیام وارد نشده" }, 400);
      if (!uNumber) return json({ ok: false, error: "شماره اختصاصی پیکربندی نشده است" }, 400);

      const CHUNK = 100;
      const allIds: string[] = [];
      const errors: string[] = [];

      for (let i = 0; i < mobiles.length; i += CHUNK) {
        const chunk = mobiles.slice(i, i + CHUNK);
        const soap = await callSoap(soapUrl, "doSendSMS", {
          uUsername,
          uPassword,
          uNumber,
          uCellphones: chunk.join(";"),
          uMessage: message,
          uFarsi: isFarsi ? "true" : "false",
          uTopic: "false",
          uFlash: isFlash ? "true" : "false",
          uUDH: "",
        });

        if (!soap.ok) { errors.push(soap.error ?? "خطای SOAP"); continue; }
        const parsed = parseSendOk(soap.result);
        if (!parsed.ok) { errors.push(parsed.error ?? "ارسال ناموفق"); continue; }
        allIds.push(...parsed.returnIds);

        // API requires ≥3s between requests
        if (i + CHUNK < mobiles.length) {
          await new Promise(r => setTimeout(r, 3100));
        }
      }

      return json({ ok: errors.length === 0, sent: allIds.length, returnIds: allIds, errors });
    }

    // ── receive ───────────────────────────────────────────────────────
    if (action === "receive") {
      const lastRowId: number = body.lastRowId ?? 0;

      const soap = await callSoap(soapUrl, "doReceiveSMS", {
        uUsername, uPassword, uLastRowID: String(lastRowId),
      });
      if (!soap.ok) return json({ ok: false, error: soap.error });

      const messages = parseReceiveXml(soap.result || soap.rawXml || "");

      for (const m of messages) {
        if (!m.rowId) continue;
        // time format from API: "2011/06/13 00:00:14"
        const received_at = m.dateTime
          ? new Date(m.dateTime.replace(/(\d{4})\/(\d{2})\/(\d{2})/, "$1-$2-$3")).toISOString()
          : new Date().toISOString();
        await supabase.from("rahyab_inbox").upsert(
          { row_id: parseInt(m.rowId, 10), sender: m.sender, receiver: m.receiver, message: m.message, received_at },
          { onConflict: "row_id" }
        ).select();
      }

      const maxRowId = messages.reduce((max, m) => Math.max(max, parseInt(m.rowId || "0", 10)), lastRowId);
      return json({ ok: true, count: messages.length, messages, nextRowId: maxRowId });
    }

    // ── hello_world ───────────────────────────────────────────────────
    if (action === "hello_world") {
      const soap = await callSoap(soapUrl, "HelloWorld", {});
      if (!soap.ok) return json({ ok: false, error: soap.error ?? "خطای SOAP" });
      return json({ ok: true, result: soap.result });
    }

    // ── receive_by_flag ───────────────────────────────────────────────
    if (action === "receive_by_flag") {
      const soap = await callSoap(soapUrl, "doReceiveSMSByFlag", {
        uUsername, uPassword,
      });
      if (!soap.ok) return json({ ok: false, error: soap.error });
      const messages = parseReceiveXml(soap.result || soap.rawXml || "");
      return json({ ok: true, count: messages.length, messages });
    }

    // ── get_info_xml ──────────────────────────────────────────────────
    if (action === "get_info_xml") {
      const soap = await callSoap(soapUrl, "getInfoXML", {
        uUsername, uPassword,
      });
      if (!soap.ok) return json({ ok: false, error: soap.error ?? "خطای SOAP" });
      return json({ ok: true, rawXml: soap.rawXml, result: soap.result });
    }

    // ── get_delivery ──────────────────────────────────────────────────
    if (action === "get_delivery") {
      const returnIds: string[] = body.returnIds ?? [];
      if (!returnIds.length) return json({ ok: false, error: "شناسه پیام وارد نشده" }, 400);

      // doGetDelivery returns plain ordered status codes: "0;2;-1"
      // API requires ≥1s between requests, username only (no password)
      const CHUNK = 100;
      const deliveryMap: Record<string, number> = {};

      for (let i = 0; i < returnIds.length; i += CHUNK) {
        const chunk = returnIds.slice(i, i + CHUNK);
        const soap = await callSoap(soapUrl, "doGetDelivery", {
          uUsername,
          uReturnIDs: chunk.join(";"),
        });
        if (soap.ok) Object.assign(deliveryMap, parseDelivery(chunk, soap.result));
        if (i + CHUNK < returnIds.length) await new Promise(r => setTimeout(r, 1100));
      }

      return json({ ok: true, delivery: deliveryMap });
    }

    return json({ ok: false, error: `عملیات ناشناخته: ${action}` }, 400);

  } catch (err: any) {
    return json({ ok: false, error: err?.message ?? "خطای داخلی سرور" }, 500);
  }
});
