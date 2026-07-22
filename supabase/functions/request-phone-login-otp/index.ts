import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

function normalizeIranPhone(value?: string | null): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;
  return '';
}

// ── HMAC-SHA256 with server-side pepper ────────────────────────────────────
async function hmacHash(value: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ── Trusted gateway IP extraction (IPv4 + IPv6) ────────────────────────────
function getClientIP(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  if (!first) return "unknown";
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(first)) return first;
  if (/^[0-9a-fA-F:]+$/.test(first) && first.includes(":")) return first;
  return "unknown";
}

// ── CORS helpers ───────────────────────────────────────────────────────────
function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": allowedOrigin || "null",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ── Consistent timing: 5200–5400ms total ────────────────────────────────────
const TARGET_MIN_MS = 5200;
const TARGET_MAX_MS = 5400;

async function finishPublicResponse(
  startedAt: number,
  response: Response,
  cors: Record<string, string>,
): Promise<Response> {
  const elapsed = Date.now() - startedAt;
  const jitter = Math.floor(Math.random() * (TARGET_MAX_MS - TARGET_MIN_MS + 1));
  const target = TARGET_MIN_MS + jitter;
  if (elapsed < target) {
    await new Promise(resolve => setTimeout(resolve, target - elapsed));
  }
  return new Response(response.body, {
    status: response.status,
    headers: { ...response.headers, ...cors },
  });
}

function publicResponse(cors: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { "Content-Type": "application/json", ...cors } },
  );
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  // ── Resolve allowed origins (env var first, then system_config) ──────────
  let allowedOrigin: string | null = null;
  try {
    let allowedStr = Deno.env.get("PHONE_LOGIN_ALLOWED_ORIGINS") || "";
    if (!allowedStr) {
      const { data } = await supabase
        .from("system_config")
        .select("value")
        .eq("section", "security")
        .eq("key", "phone_login_allowed_origins")
        .maybeSingle();
      allowedStr = data?.value || "";
    }
    const allowed = allowedStr.split(",").map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get("Origin") || "";
    if (origin && allowed.includes(origin)) allowedOrigin = origin;
  } catch { /* fail-closed below */ }

  const cors = corsHeaders(allowedOrigin);

  // ── OPTIONS preflight ─────────────────────────────────────────────────────
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: cors });
  }

  if (req.method !== "POST") {
    return await finishPublicResponse(startedAt, publicResponse(cors), cors);
  }

  try {
    if (!allowedOrigin) {
      return await finishPublicResponse(startedAt, publicResponse(cors), cors);
    }

    const body = await req.json();
    const rawPhone: string | undefined = body.phone;

    const normalized = normalizeIranPhone(rawPhone);
    if (!normalized) {
      return await finishPublicResponse(startedAt, publicResponse(cors), cors);
    }

    // ── Check phone_login_enabled + ready ────────────────────────────────────
    const { data: cfgRow, error: cfgErr } = await supabase.rpc("get_public_auth_config");
    if (cfgErr) {
      return await finishPublicResponse(startedAt, publicResponse(cors), cors);
    }
    const cfg = Array.isArray(cfgRow) ? cfgRow[0] : cfgRow;
    const ready = cfg?.phone_login_ready === true;
    if (!ready) {
      return await finishPublicResponse(startedAt, publicResponse(cors), cors);
    }

    // ── Resolve pepper (env var only — never from DB) ───────────────────────
    const pepper = Deno.env.get("PHONE_RATE_LIMIT_PEPPER") || "";
    if (!pepper || pepper.length < 32) {
      return await finishPublicResponse(startedAt, publicResponse(cors), cors);
    }

    // ── HMAC-hashed phone and IP ──────────────────────────────────────────────
    let phoneHash: string;
    let ipHash: string;
    try {
      const clientIP = getClientIP(req);
      phoneHash = await hmacHash(normalized, pepper);
      ipHash = await hmacHash(clientIP, pepper);
    } catch {
      return await finishPublicResponse(startedAt, publicResponse(cors), cors);
    }

    // ── Atomic rate limit via RPC ─────────────────────────────────────────────
    let rateLimitResult: { allowed: boolean; retry_after_seconds: number };
    try {
      const { data: rlRaw, error: rlErr } = await supabase.rpc(
        "consume_phone_otp_rate_limit",
        { p_phone_hash: phoneHash, p_ip_hash: ipHash },
      );
      if (rlErr) {
        return await finishPublicResponse(startedAt, publicResponse(cors), cors);
      }
      rateLimitResult = typeof rlRaw === "string" ? JSON.parse(rlRaw) : rlRaw;
    } catch {
      return await finishPublicResponse(startedAt, publicResponse(cors), cors);
    }

    if (!rateLimitResult.allowed) {
      return await finishPublicResponse(startedAt, publicResponse(cors), cors);
    }

    // ── Call signInWithOtp server-side ────────────────────────────────────────
    const e164 = `+${normalized}`;
    try {
      await supabase.auth.signInWithOtp({
        phone: e164,
        options: { shouldCreateUser: false, channel: "sms" },
      });
    } catch {
      // Never reveal whether the phone exists
    }

    return await finishPublicResponse(startedAt, publicResponse(cors), cors);

  } catch {
    return await finishPublicResponse(startedAt, publicResponse(cors), cors);
  }
});
