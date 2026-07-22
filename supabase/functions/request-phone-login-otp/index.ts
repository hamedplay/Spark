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

function publicResponse() {
  return new Response(
    JSON.stringify({ ok: true }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return publicResponse();
  }

  const t0 = Date.now();

  try {
    const body = await req.json();
    const rawPhone: string | undefined = body.phone;

    // Normalize and validate
    const normalized = normalizeIranPhone(rawPhone);
    if (!normalized) {
      // Still return generic success — never reveal validation failure
      return publicResponse();
    }

    // E.164 format for GoTrue: +989XXXXXXXXX
    const e164 = `+${normalized}`;

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Check phone_login_enabled + ready
    const { data: cfgRow } = await supabase.rpc("get_public_auth_config");
    const cfg = Array.isArray(cfgRow) ? cfgRow[0] : cfgRow;
    const ready = cfg?.phone_login_ready === true;

    if (!ready) {
      return publicResponse();
    }

    // Rate limit: check recent attempts by phone hash + IP
    const clientIP = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const phoneHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalized)).then(buf => {
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    });

    const oneMinuteAgo = new Date(Date.now() - 60_000).toISOString();
    const { count } = await supabase
      .from("phone_otp_rate_limit")
      .select("*", { count: "exact", head: true })
      .eq("phone_hash", phoneHash)
      .gte("created_at", oneMinuteAgo);

    if (count && count >= 3) {
      return publicResponse();
    }

    const { count: ipCount } = await supabase
      .from("phone_otp_rate_limit")
      .select("*", { count: "exact", head: true })
      .eq("ip_address", clientIP)
      .gte("created_at", oneMinuteAgo);

    if (ipCount && ipCount >= 10) {
      return publicResponse();
    }

    // Log rate limit entry (no phone number, just hash)
    await supabase.from("phone_otp_rate_limit").insert({
      phone_hash: phoneHash,
      ip_address: clientIP,
    });

    // Call signInWithOtp server-side with shouldCreateUser=false
    // GoTrue will trigger the auth-send-sms-hook if configured
    const { error } = await supabase.auth.signInWithOtp({
      phone: e164,
      options: { shouldCreateUser: false, channel: "sms" },
    });

    // Never reveal whether the phone exists or if there was an error
    // Always return the same generic response

    // Ensure minimum response time to prevent timing-based enumeration
    const elapsed = Date.now() - t0;
    if (elapsed < 500) {
      await new Promise(resolve => setTimeout(resolve, 500 - elapsed));
    }

    return publicResponse();
  } catch {
    // Always return generic success
    return publicResponse();
  }
});
