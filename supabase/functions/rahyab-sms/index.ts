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

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

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

/**
 * Extract the content of <ActionResult> from a SOAP response.
 * Handles both plain-text and CDATA-wrapped values, and XML-entity-escaped content.
 */
function extractResult(xml: string, action: string): string {
  const tag = `${action}Result`;
  // Match the result element (with optional namespace prefix)
  const m = xml.match(
    new RegExp(`<(?:[^:>]+:)?${tag}[^>]*>([\\s\\S]*?)<\\/(?:[^:>]+:)?${tag}>`)
  );
  if (!m) return "";
  let content = m[1];

  // CDATA wrapper at the result-element level
  const cdata = content.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  if (cdata) return cdata[1].trim();

  // XML-entity unescape (server may escape inner XML when embedding in SOAP)
  return content
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .trim();
}

/** Extract a value from a tag that may wrap content in CDATA or plain text. */
function getTag(tag: string, inner: string): string {
  // e.g. <rowID><![CDATA[23233454]]></rowID>  or  <rowID>23233454</rowID>
  const m = inner.match(
    new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/${tag}>`)
  );
  if (!m) return "";
  return ((m[1] ?? m[2]) || "").trim();
}

async function callSoap(
  url: string,
  action: string,
  params: Record<string, string>,
  timeoutMs = 25000,
): Promise<{ ok: boolean; result: string; rawXml?: string; error?: string }> {
  const body = soapEnvelope(action, params);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        "SOAPAction": `"http://tempuri.org/${action}"`,
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
    const msg = e?.name === "AbortError"
      ? "اتصال به وب‌سرویس رهیاب رایان زمان‌بر شد (timeout)"
      : `خطای اتصال: ${e.message}`;
    return { ok: false, result: "", error: msg };
  }
}

// ── Response parsers ──────────────────────────────────────────────────────────

/**
 * Parse doGetInfo response: "OK;Credit;ExpireDate;"
 * On error starts with "Error!"
 */
function parseGetInfo(result: string): { ok: boolean; credit: string; expireDate: string; error?: string } {
  if (!result.startsWith("OK")) {
    return { ok: false, credit: "", expireDate: "", error: result };
  }
  const parts = result.split(";");
  return { ok: true, credit: parts[1] ?? "", expireDate: parts[2] ?? "" };
}

/**
 * Parse doSendSMS / doSendService response:
 * Success: "Send OK.<ReturnIDs>112342;23543;-1</ReturnIDs>"
 * Error:   "Error! ...<ReturnIDs>-1</ReturnIDs>"
 */
function parseSendResult(result: string): { ok: boolean; returnIds: string[]; error?: string } {
  if (!result.startsWith("Send OK")) {
    return { ok: false, returnIds: [], error: result };
  }
  const m = result.match(/<ReturnIDs>([\s\S]*?)<\/ReturnIDs>/);
  const ids = m ? m[1].split(";").filter(Boolean) : [];
  return { ok: true, returnIds: ids };
}

/**
 * Parse doReceiveSMS / doReceiveSMSByFlag response.
 * The result string is an XML document:
 *   <smsBatch>
 *     <sms>
 *       <rowID><![CDATA[23233454]]></rowID>
 *       <origAddr><![CDATA[9190000001]]></origAddr>
 *       <destAddr><![CDATA[5000123]]></destAddr>
 *       <time><![CDATA[2011/06/13 00:00:14]]></time>
 *       <message><![CDATA[متن پیام]]></message>
 *     </sms>
 *     ...
 *   </smsBatch>
 */
function parseReceiveXml(xmlStr: string): {
  rowId: string; dateTime: string; sender: string; receiver: string; message: string;
}[] {
  const items: { rowId: string; dateTime: string; sender: string; receiver: string; message: string }[] = [];
  const blocks = xmlStr.matchAll(/<sms>([\s\S]*?)<\/sms>/g);
  for (const b of blocks) {
    const inner = b[1];
    items.push({
      rowId:    getTag("rowID",    inner),
      dateTime: getTag("time",     inner),
      sender:   getTag("origAddr", inner),
      receiver: getTag("destAddr", inner),
      message:  getTag("message",  inner),
    });
  }
  return items;
}

/**
 * Parse doGetDelivery response.
 * PDF: output is semicolon-separated STATUS CODES in the SAME ORDER as the input IDs.
 * Format: "0;2;-1"   (NOT id:status)
 * 0 = sent, status unknown
 * 2 = delivered
 * 5 = not delivered
 * 9 = blocked
 * -1 = ID not found
 */
function parseDelivery(result: string, returnIds: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  const statuses = result.split(";");
  for (let i = 0; i < returnIds.length && i < statuses.length; i++) {
    const s = statuses[i].trim();
    if (s !== "") map[returnIds[i]] = parseInt(s, 10);
  }
  return map;
}

/**
 * Parse doGetDeliveryOlder response.
 * PDF: output is "id:status;id:status" — both ID and status together.
 * Format: "1212854515:2;1212854516:0;1212854517:2"
 */
function parseDeliveryOlder(result: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const part of result.split(";")) {
    const colon = part.lastIndexOf(":");
    if (colon < 0) continue;
    const id = part.slice(0, colon).trim();
    const status = parseInt(part.slice(colon + 1).trim(), 10);
    if (id && !isNaN(status)) map[id] = status;
  }
  return map;
}

/**
 * Parse doCheckClientID response.
 * Format: "clientId,serverId;clientId,serverId;clientId,-1"
 */
function parseCheckClientId(result: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const part of result.split(";")) {
    const [cid, sid] = part.split(",");
    if (cid && sid) map[cid.trim()] = sid.trim();
  }
  return map;
}

// ── Supabase admin client ─────────────────────────────────────────────────────

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

// ── Main handler ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ ok: false, error: "Unauthorized" }, 401);

    const supabase = adminClient();
    const body = await req.json();
    const action: string = body.action;

    // ── load_settings ─────────────────────────────────────────────────────────
    if (action === "load_settings") {
      const { data } = await supabase.from("rahyab_settings").select("*").limit(1).maybeSingle();
      return json({ ok: true, settings: data });
    }

    // ── save_settings ─────────────────────────────────────────────────────────
    if (action === "save_settings") {
      const s = body.settings ?? {};
      const { data: existing } = await supabase.from("rahyab_settings").select("id").limit(1).maybeSingle();
      const payload = {
        username:  s.username  ?? "",
        password:  s.password  ?? "",
        short_code: s.short_code ?? "",
        token:     s.token     ?? "",
        soap_url:  s.soap_url  || "http://RahyabBulk.ir/WebService/sms.asmx",
        is_active: s.is_active ?? false,
        updated_at: new Date().toISOString(),
      };
      if (existing?.id) {
        await supabase.from("rahyab_settings").update(payload).eq("id", existing.id);
      } else {
        await supabase.from("rahyab_settings").insert([payload]);
      }
      return json({ ok: true });
    }

    // ── inbox (list stored received messages from DB) ─────────────────────────
    if (action === "inbox") {
      const { data } = await supabase
        .from("rahyab_inbox")
        .select("*")
        .order("received_at", { ascending: false })
        .limit(200);
      return json({ ok: true, messages: data ?? [] });
    }

    // For all SOAP actions, load settings from DB
    const { data: settings } = await supabase
      .from("rahyab_settings")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (!settings) {
      return json({ ok: false, error: "تنظیمات رهیاب رایان پیکربندی نشده است" }, 400);
    }

    const soapUrl: string = settings.soap_url || "http://RahyabBulk.ir/WebService/sms.asmx";
    // Token takes priority over username (more secure)
    const uUsername: string = settings.token || settings.username || "";
    const uPassword: string = settings.password || "12345"; // PDF: any 5+ char string when using token
    const uNumber:   string = settings.short_code || "";

    if (!uUsername) {
      return json({ ok: false, error: "نام کاربری یا توکن پیکربندی نشده است" }, 400);
    }

    // ── get_info / test ───────────────────────────────────────────────────────
    // doGetInfo(uUsername, uPassword) → "OK;Credit;ExpireDate;"
    if (action === "get_info" || action === "test") {
      const soap = await callSoap(soapUrl, "doGetInfo", { uUsername, uPassword });
      if (!soap.ok) return json({ ok: false, error: soap.error ?? "خطای SOAP" });
      const info = parseGetInfo(soap.result);
      if (!info.ok) return json({ ok: false, error: info.error ?? "احراز هویت ناموفق" });
      return json({ ok: true, credit: info.credit, expireDate: info.expireDate });
    }

    // ── send (doSendSMS) ──────────────────────────────────────────────────────
    // doSendSMS(uUsername, uPassword, uNumber, uCellphones, uMessage, uFarsi, uTopic, uFlash, uUDH)
    // uCellphones: max 100 numbers separated by ";"
    if (action === "send") {
      const mobiles: string[] = body.mobiles ?? [];
      const message: string  = body.message ?? "";
      const isFarsi: boolean = body.isFarsi !== false;
      const isFlash: boolean = body.isFlash === true;

      if (!mobiles.length) return json({ ok: false, error: "شماره موبایل وارد نشده" }, 400);
      if (!message.trim())  return json({ ok: false, error: "متن پیام وارد نشده" }, 400);
      if (!uNumber)         return json({ ok: false, error: "شماره اختصاصی پیکربندی نشده است" }, 400);

      const CHUNK = 100; // max per doSendSMS call
      const allIds: string[] = [];
      const errors: string[] = [];

      for (let i = 0; i < mobiles.length; i += CHUNK) {
        const chunk = mobiles.slice(i, i + CHUNK);
        const soap = await callSoap(soapUrl, "doSendSMS", {
          uUsername,
          uPassword,
          uNumber,
          uCellphones: chunk.join(";"),
          uMessage:    message,
          uFarsi:      isFarsi ? "true" : "false",
          uTopic:      "false",
          uFlash:      isFlash ? "true" : "false",
          uUDH:        "",
        });

        if (!soap.ok) {
          errors.push(soap.error ?? "خطای SOAP");
          continue;
        }
        const parsed = parseSendResult(soap.result);
        if (!parsed.ok) {
          errors.push(parsed.error ?? "ارسال ناموفق");
          continue;
        }
        allIds.push(...parsed.returnIds);

        // Min 3-second interval between consecutive batches (PDF requirement)
        if (i + CHUNK < mobiles.length) {
          await new Promise(r => setTimeout(r, 3100));
        }
      }

      return json({ ok: errors.length === 0, sent: allIds.length, returnIds: allIds, errors });
    }

    // ── receive (doReceiveSMS) ────────────────────────────────────────────────
    // doReceiveSMS(uUsername, uPassword, uLastRowID) → XML string
    // Returns max 50 messages. Min 3-second interval between calls.
    if (action === "receive") {
      const lastRowId: number = body.lastRowId ?? 0;

      const soap = await callSoap(soapUrl, "doReceiveSMS", {
        uUsername,
        uPassword,
        uLastRowID: String(lastRowId),
      });
      if (!soap.ok) return json({ ok: false, error: soap.error });

      // The result is an XML string (may be empty / "<smsBatch/>" when no messages)
      const messages = parseReceiveXml(soap.result || "");

      // Persist to rahyab_inbox; UNIQUE constraint on row_id prevents duplicates
      let maxRowId = lastRowId;
      for (const m of messages) {
        if (!m.rowId) continue;
        const rowIdNum = parseInt(m.rowId, 10);
        if (rowIdNum > maxRowId) maxRowId = rowIdNum;

        // Convert date "2011/06/13 00:00:14" → ISO
        let received_at = new Date().toISOString();
        if (m.dateTime) {
          // Replace / with - in date part: "2011/06/13 00:00:14" → "2011-06-13T00:00:14"
          const iso = m.dateTime.replace(/^(\d{4})\/(\d{2})\/(\d{2})\s/, "$1-$2-$3T");
          const d = new Date(iso);
          if (!isNaN(d.getTime())) received_at = d.toISOString();
        }

        await supabase
          .from("rahyab_inbox")
          .upsert(
            { row_id: rowIdNum, sender: m.sender, receiver: m.receiver, message: m.message, received_at },
            { onConflict: "row_id" }
          );
      }

      return json({ ok: true, count: messages.length, messages, nextRowId: maxRowId });
    }

    // ── receive_by_flag (doReceiveSMSByFlag) ──────────────────────────────────
    // Like receive but server auto-marks delivered messages — no lastRowId needed.
    // doReceiveSMSByFlag(uUsername, uPassword) → same XML format
    if (action === "receive_by_flag") {
      const soap = await callSoap(soapUrl, "doReceiveSMSByFlag", { uUsername, uPassword });
      if (!soap.ok) return json({ ok: false, error: soap.error });

      const messages = parseReceiveXml(soap.result || "");
      for (const m of messages) {
        if (!m.rowId) continue;
        const rowIdNum = parseInt(m.rowId, 10);
        let received_at = new Date().toISOString();
        if (m.dateTime) {
          const iso = m.dateTime.replace(/^(\d{4})\/(\d{2})\/(\d{2})\s/, "$1-$2-$3T");
          const d = new Date(iso);
          if (!isNaN(d.getTime())) received_at = d.toISOString();
        }
        await supabase
          .from("rahyab_inbox")
          .upsert(
            { row_id: rowIdNum, sender: m.sender, receiver: m.receiver, message: m.message, received_at },
            { onConflict: "row_id" }
          );
      }
      return json({ ok: true, count: messages.length, messages });
    }

    // ── get_delivery (doGetDelivery) ──────────────────────────────────────────
    // doGetDelivery(uUsername, uReturnIDs) — NO password parameter
    // Output: "0;2;-1" — status codes in the SAME ORDER as input IDs
    // Valid for messages sent in the last 24 hours. Min 1-second interval.
    if (action === "get_delivery") {
      const returnIds: string[] = body.returnIds ?? [];
      if (!returnIds.length) return json({ ok: false, error: "شناسه پیام وارد نشده" }, 400);

      const CHUNK = 100; // max 100 IDs per call
      const deliveryMap: Record<string, number> = {};

      for (let i = 0; i < returnIds.length; i += CHUNK) {
        const chunk = returnIds.slice(i, i + CHUNK);
        // NOTE: doGetDelivery takes only uUsername (no password) per the PDF spec
        const soap = await callSoap(soapUrl, "doGetDelivery", {
          uUsername,
          uReturnIDs: chunk.join(";"),
        });
        if (soap.ok) {
          Object.assign(deliveryMap, parseDelivery(soap.result, chunk));
        }
        // Min 1-second between calls
        if (i + CHUNK < returnIds.length) {
          await new Promise(r => setTimeout(r, 1100));
        }
      }

      return json({ ok: true, delivery: deliveryMap });
    }

    // ── get_delivery_older (doGetDeliveryOlder) ───────────────────────────────
    // For messages older than 24 hours (from backup DB).
    // doGetDeliveryOlder(uUsername, uReturnIDs) — NO password parameter
    // Output: "id:status;id:status" — both ID and status together.
    // Only callable between 04:00–12:00 and 16:00–24:00.
    if (action === "get_delivery_older") {
      const returnIds: string[] = body.returnIds ?? [];
      if (!returnIds.length) return json({ ok: false, error: "شناسه پیام وارد نشده" }, 400);

      const CHUNK = 100;
      const deliveryMap: Record<string, number> = {};

      for (let i = 0; i < returnIds.length; i += CHUNK) {
        const chunk = returnIds.slice(i, i + CHUNK);
        const soap = await callSoap(soapUrl, "doGetDeliveryOlder", {
          uUsername,
          uReturnIDs: chunk.join(";"),
        });
        if (soap.ok) {
          Object.assign(deliveryMap, parseDeliveryOlder(soap.result));
        }
        if (i + CHUNK < returnIds.length) {
          await new Promise(r => setTimeout(r, 3100));
        }
      }

      return json({ ok: true, delivery: deliveryMap });
    }

    // ── check_client_id (doCheckClientID) ─────────────────────────────────────
    // doCheckClientID(uUsername, uClientIDs) — NO password parameter
    // Used to recover ServerID when connection was lost during send.
    if (action === "check_client_id") {
      const clientIds: string[] = body.clientIds ?? [];
      if (!clientIds.length) return json({ ok: false, error: "شناسه کلاینت وارد نشده" }, 400);

      const soap = await callSoap(soapUrl, "doCheckClientID", {
        uUsername,
        uClientIDs: clientIds.join(";"),
      });
      if (!soap.ok) return json({ ok: false, error: soap.error });

      return json({ ok: true, result: parseCheckClientId(soap.result) });
    }

    // ── get_info_xml (getInfoXML) ─────────────────────────────────────────────
    // Returns full account info as XML (credit type, credit, active status,
    // expiry, operator prices, short codes list)
    if (action === "get_info_xml") {
      const soap = await callSoap(soapUrl, "getInfoXML", { uUsername, uPassword });
      if (!soap.ok) return json({ ok: false, error: soap.error });

      // Parse key fields from the XML
      const credit     = getTag("Credit",     soap.result);
      const creditType = getTag("CreditType", soap.result);
      const active     = getTag("Active",     soap.result);
      const expireDate = getTag("ExpireDate", soap.result);

      const shortCodes: string[] = [];
      const scMatches = soap.result.matchAll(/<ShortCode>([\s\S]*?)<\/ShortCode>/g);
      for (const m of scMatches) shortCodes.push(m[1].trim());

      return json({ ok: true, credit, creditType, active, expireDate, shortCodes, rawXml: soap.result });
    }

    return json({ ok: false, error: `عملیات ناشناخته: ${action}` }, 400);

  } catch (err: any) {
    return json({ ok: false, error: err?.message ?? "خطای داخلی سرور" }, 500);
  }
});
