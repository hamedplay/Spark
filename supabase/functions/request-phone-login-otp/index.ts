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

async function hmacHash(value: string, pepper: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(pepper),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join("");
}

function getClientIP(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0]?.trim();
  if (!first) return "unknown";
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(first)) return first;
  if (/^[0-9a-fA-F:]+$/.test(first) && first.includes(":")) return first;
  return "unknown";
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const TARGET_MIN_MS = 5200;
const TARGET_MAX_MS = 5400;

async function finishPublicResponse(
  startedAt: number,
  response: Response,
): Promise<Response> {
  const elapsed = Date.now() - startedAt;
  const jitter = Math.floor(Math.random() * (TARGET_MAX_MS - TARGET_MIN_MS + 1));
  const target = TARGET_MIN_MS + jitter;
  if (elapsed < target) {
    await new Promise(resolve => setTimeout(resolve, target - elapsed));
  }
  return new Response(response.body, {
    status: response.status,
    headers: { ...response.headers, ...corsHeaders },
  });
}

function publicResponse(): Response {
  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } },
  );
}

Deno.serve(async (req: Request) => {
  const startedAt = Date.now();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return await finishPublicResponse(startedAt, publicResponse());
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  try {
    const body = await req.json();
    const rawPhone: string | undefined = body.phone;

    const normalized = normalizeIranPhone(rawPhone);
    if (!normalized) {
      return await finishPublicResponse(startedAt, publicResponse());
    }

    // ── Check auth config ──────────────────────────────────────────────────
    const { data: cfgRow, error: cfgErr } = await supabase.rpc("get_public_auth_config");
    if (cfgErr) {
      return await finishPublicResponse(startedAt, publicResponse());
    }
    const cfg = Array.isArray(cfgRow) ? cfgRow[0] : cfgRow;
    const publicReady = cfg?.phone_login_ready === true;
    const testReady = cfg?.phone_login_test_ready === true;

    let allowDispatch = false;

    if (publicReady) {
      allowDispatch = true;
    } else if (testReady) {
      const { data: testModeRow } = await supabase
        .from("system_config").select("value")
        .eq("section", "security").eq("key", "phone_login_test_mode")
        .maybeSingle();
      const testModeEnabled = testModeRow?.value === "true";

      if (testModeEnabled) {
        const { data: testPhoneRow } = await supabase
          .from("system_config").select("value")
          .eq("section", "security").eq("key", "phone_login_test_phone")
          .maybeSingle();
        const testPhone = testPhoneRow?.value || "";
        const normalizedTestPhone = normalizeIranPhone(testPhone);

        if (normalizedTestPhone && normalized === normalizedTestPhone) {
          allowDispatch = true;
        }
      }
    }

    if (!allowDispatch) {
      return await finishPublicResponse(startedAt, publicResponse());
    }

    // ── Resolve profile + auth user BEFORE sending OTP ──────────────────────
    // 1. Find active profile with this phone
    const { data: profile } = await supabase
      .from("profiles")
      .select("user_id, phone, is_active")
      .eq("is_active", true)
      .filter("phone", "eq", normalized)
      .maybeSingle();

    // Also try raw phone format in case profiles store un-normalized
    let resolvedProfile = profile;
    if (!resolvedProfile) {
      const { data: profileByRaw } = await supabase
        .from("profiles")
        .select("user_id, phone, is_active")
        .eq("is_active", true)
        .filter("phone", "ilike", `%${normalized.slice(-10)}%`)
        .maybeSingle();
      resolvedProfile = profileByRaw;
    }

    if (!resolvedProfile) {
      return await finishPublicResponse(startedAt, publicResponse());
    }

    // 2. Find auth user with same UUID
    const { data: authUser, error: authErr } = await supabase.auth.admin.getUserById(resolvedProfile.user_id);
    if (authErr || !authUser?.user) {
      return await finishPublicResponse(startedAt, publicResponse());
    }

    // 3. Check auth.users.phone matches
    const authPhoneNorm = normalizeIranPhone(authUser.user.phone);
    if (authPhoneNorm !== normalized) {
      return await finishPublicResponse(startedAt, publicResponse());
    }

    // ── Rate limit ──────────────────────────────────────────────────────────
    const pepper = Deno.env.get("PHONE_RATE_LIMIT_PEPPER") || "";
    if (!pepper || pepper.length < 32) {
      return await finishPublicResponse(startedAt, publicResponse());
    }

    let phoneHash: string;
    let ipHash: string;
    try {
      const clientIP = getClientIP(req);
      phoneHash = await hmacHash(normalized, pepper);
      ipHash = await hmacHash(clientIP, pepper);
    } catch {
      return await finishPublicResponse(startedAt, publicResponse());
    }

    let rateLimitResult: { allowed: boolean; retry_after_seconds: number };
    try {
      const { data: rlRaw, error: rlErr } = await supabase.rpc(
        "consume_phone_otp_rate_limit",
        { p_phone_hash: phoneHash, p_ip_hash: ipHash },
      );
      if (rlErr) {
        return await finishPublicResponse(startedAt, publicResponse());
      }
      rateLimitResult = typeof rlRaw === "string" ? JSON.parse(rlRaw) : rlRaw;
    } catch {
      return await finishPublicResponse(startedAt, publicResponse());
    }

    if (!rateLimitResult.allowed) {
      return await finishPublicResponse(startedAt, publicResponse());
    }

    // ── Call signInWithOtp with shouldCreateUser: false ─────────────────────
    const e164 = `+${normalized}`;
    try {
      await supabase.auth.signInWithOtp({
        phone: e164,
        options: { shouldCreateUser: false, channel: "sms" },
      });
    } catch {
      // Never reveal whether the phone exists
    }

    return await finishPublicResponse(startedAt, publicResponse());

  } catch {
    return await finishPublicResponse(startedAt, publicResponse());
  }
});
