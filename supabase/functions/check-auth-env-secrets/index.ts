import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  // ── FULL auth access gate ──────────────────────────────────────────────────────
  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return deniedResponse();
  const callerUserId = authResult.userId!;

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // Check admin (FULL access already verified by gate)
    const { data: profile, error: profileErr } = await supabase
      .from("profiles")
      .select("is_admin, is_active")
      .eq("user_id", callerUserId)
      .maybeSingle();

    if (profileErr || !profile || !profile.is_active || !profile.is_admin) {
      return new Response(JSON.stringify({ ok: false, error: "NOT_ADMIN" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // 3. Check env secrets by byte length (not string length)
    const hookSecret = Deno.env.get("SEND_SMS_HOOK_SECRET") || "";
    const hookSecretBytes = new TextEncoder().encode(hookSecret).byteLength;
    const hookSecretSet = hookSecretBytes >= 16;

    const rateLimitPepper = Deno.env.get("PHONE_RATE_LIMIT_PEPPER") || "";
    const rateLimitPepperBytes = new TextEncoder().encode(rateLimitPepper).byteLength;
    const rateLimitPepperSet = rateLimitPepperBytes >= 16;

    const recoverySecret = Deno.env.get("PHONE_PASSWORD_RESET_SECRET") || "";
    const recoverySecretBytes = new TextEncoder().encode(recoverySecret).byteLength;
    const recoverySecretSet = recoverySecretBytes >= 32;

    const allowedOriginsStr = Deno.env.get("PHONE_LOGIN_ALLOWED_ORIGINS") || "";
    const allowedOriginsSet = allowedOriginsStr.trim().length > 0;

    // 4. Return only booleans — no secret values
    return new Response(JSON.stringify({
      ok: true,
      hook_secret_set: hookSecretSet,
      rate_limit_pepper_set: rateLimitPepperSet,
      recovery_secret_set: recoverySecretSet,
      allowed_origins_set: allowedOriginsSet,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });

  } catch {
    return new Response(JSON.stringify({ ok: false, error: "INTERNAL_ERROR" }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
