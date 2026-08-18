import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { hmacSha256Hex } from "../_shared/crypto.ts";


const MAX_BODY_BYTES = 4096;
const MAX_IDENTIFIER_LEN = 256;
const MAX_PASSWORD_LEN = 1024;
const INTERNAL_AUTH_DOMAIN = "auth.spark.invalid";

const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Vary": "Origin",
};

type LoginMethod = "username" | "email" | "phone";
type PasswordCredential = { email: string; password: string } | { phone: string; password: string };

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const h: Record<string, string> = { ...baseHeaders };
  if (allowedOrigin) h["Access-Control-Allow-Origin"] = allowedOrigin;
  return h;
}

function json(data: unknown, status: number, allowedOrigin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" },
  });
}

async function getConfig(): Promise<{ origins: string[]; pepper: string }> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await admin.rpc("get_phone_auth_config");
  if (error || !data) throw new Error("CONFIG_UNAVAILABLE");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("CONFIG_UNAVAILABLE");
  return {
    origins: Array.isArray(row.allowed_origins) ? row.allowed_origins : [],
    pepper: typeof row.pepper === "string" ? row.pepper : "",
  };
}

function checkOrigin(origin: string | null, allowedOrigins: string[]): string | null {
  if (!origin) return null;
  return allowedOrigins.includes(origin) ? origin : null;
}

function canonicalizePhone(input: string): string | null {
  const s = input.trim().replace(/[\s\-()]/g, "");
  if (/^\+989\d{9}$/.test(s)) return s.slice(1);
  if (/^989\d{9}$/.test(s)) return s;
  if (/^09\d{9}$/.test(s)) return `98${s.slice(1)}`;
  if (/^00989\d{9}$/.test(s)) return s.slice(2);
  return null;
}

function randomDelay(): Promise<void> {
  const ms = 200 + Math.floor(Math.random() * 400);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64UrlDecode(str: string): string {
  const normalized = str.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return atob(normalized + pad);
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function hasPasswordAmr(amr: unknown): boolean {
  return Array.isArray(amr) && amr.some((item: any) => item?.method === "password");
}

async function localLogout(accessToken: string): Promise<void> {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
        "Content-Type": "application/json",
      },
    });
  } catch {
    // The gateway allowlist makes an un-authorized session unusable even if logout fails.
  }
}

function confirmedEmail(user: any): string | null {
  return typeof user?.email === "string" && user.email.length > 0 && user.email_confirmed_at
    ? user.email
    : null;
}

function confirmedPhone(user: any): string | null {
  if (typeof user?.phone !== "string" || user.phone.length === 0 || !user.phone_confirmed_at) return null;
  const canonical = canonicalizePhone(user.phone);
  return canonical ? `+${canonical}` : null;
}

function isPublicPhoneRegistration(user: any): boolean {
  return user?.app_metadata?.registration_flow === "public_phone_v1";
}

function internalCredentialEmail(userId: string): string {
  return `reg-${userId}@${INTERNAL_AUTH_DOMAIN}`;
}

function chooseConfirmedCredential(authUser: any, password: string): PasswordCredential | null {
  const email = confirmedEmail(authUser);
  const phone = confirmedPhone(authUser);

  // Public identifiers (username/email/mobile) are aliases used only to resolve
  // the account. Prefer a confirmed Auth email as the actual password credential
  // for every alias. This keeps mobile password login working even when GoTrue's
  // native phone provider is disabled and does not require another phone OTP.
  if (email) return { email, password };
  if (phone) return { phone, password };
  return null;
}

Deno.serve(async (req: Request) => {
  let allowedOrigin: string | null = null;
  let pepper = "";

  try {
    const config = await getConfig();
    pepper = config.pepper;
    allowedOrigin = checkOrigin(req.headers.get("Origin"), config.origins);
  } catch {
    return json({ error: "LOGIN_UNAVAILABLE" }, 503, null);
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(allowedOrigin) });
  }
  if (!allowedOrigin) return json({ error: "INVALID_REQUEST" }, 400, null);
  if (req.method !== "POST") return json({ error: "METHOD_NOT_ALLOWED" }, 405, allowedOrigin);

  const contentType = req.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return json({ error: "INVALID_CONTENT_TYPE" }, 400, allowedOrigin);
  }

  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return json({ error: "INVALID_BODY" }, 400, allowedOrigin);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ error: "BODY_TOO_LARGE" }, 400, allowedOrigin);
  }

  let body: { method?: unknown; identifier?: unknown; password?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "INVALID_BODY" }, 400, allowedOrigin);
  }

  if (typeof body.method !== "string" || typeof body.identifier !== "string" || typeof body.password !== "string") {
    return json({ error: "INVALID_BODY" }, 400, allowedOrigin);
  }
  if (!["username", "email", "phone"].includes(body.method)) {
    return json({ error: "INVALID_METHOD" }, 400, allowedOrigin);
  }

  const method = body.method as LoginMethod;
  const identifier = body.identifier;
  const password = body.password;
  if (!identifier || identifier.length > MAX_IDENTIFIER_LEN) {
    return json({ error: "INVALID_IDENTIFIER" }, 400, allowedOrigin);
  }
  if (!password || password.length > MAX_PASSWORD_LEN) {
    return json({ error: "INVALID_PASSWORD" }, 400, allowedOrigin);
  }
  if (pepper.length < 32) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: methodsData, error: methodsErr } = await admin.rpc("get_public_login_methods");
    if (methodsErr || !methodsData) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    const methodsRow = Array.isArray(methodsData) ? methodsData[0] : methodsData;
    const methodEnabled =
      (method === "username" && methodsRow?.username_login === true) ||
      (method === "email" && methodsRow?.email_login === true) ||
      (method === "phone" && methodsRow?.phone_login === true);
    if (!methodEnabled) return json({ error: "LOGIN_METHOD_DISABLED" }, 403, allowedOrigin);

    let canonicalIdentifier = "";
    if (method === "phone") {
      const canonical = canonicalizePhone(identifier);
      if (!canonical) {
        await randomDelay();
        return json({ error: "INVALID_CREDENTIALS" }, 401, allowedOrigin);
      }
      canonicalIdentifier = canonical;
    } else {
      canonicalIdentifier = identifier.trim().toLowerCase();
    }

    const clientIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip")?.trim() ||
      "0.0.0.0";
    const identifierHash = await hmacSha256Hex(
      pepper,
      `password-login|identifier|${method}|${canonicalIdentifier}`,
    );
    const ipHash = await hmacSha256Hex(pepper, `password-login|ip|${clientIp}`);

    const { data: rlData, error: rlErr } = await admin.rpc("consume_password_login_rate_limit_v1", {
      p_method: method,
      p_identifier_hash: identifierHash,
      p_ip_hash: ipHash,
      p_pair_limit: 10,
      p_ip_limit: 50,
      p_window_seconds: 900,
    });
    if (rlErr) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    const rlRow = Array.isArray(rlData) ? rlData[0] : rlData;
    if (!rlRow || rlRow.allowed !== true) {
      const retryAfter = typeof rlRow?.retry_after_seconds === "number" ? rlRow.retry_after_seconds : 900;
      return json({ error: "RATE_LIMITED", retry_after_seconds: retryAfter }, 429, allowedOrigin);
    }

    let targetUserId: string | null = null;

    if (method === "username") {
      const { data: profile, error } = await admin
        .from("profiles")
        .select("user_id")
        .eq("normalized_username", canonicalIdentifier)
        .maybeSingle();
      if (error) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
      targetUserId = isValidUuid(profile?.user_id) ? profile.user_id : null;
    } else if (method === "phone") {
      const { data: resolveData, error: resolveErr } = await admin.rpc(
        "resolve_phone_password_login_v1",
        { p_normalized_phone: canonicalIdentifier },
      );
      if (resolveErr) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
      const resolveRow = Array.isArray(resolveData) ? resolveData[0] : resolveData;
      targetUserId = isValidUuid(resolveRow?.user_id) ? resolveRow.user_id : null;
    } else {
      const { data: profile, error } = await admin
        .from("profiles")
        .select("user_id")
        .eq("normalized_email", canonicalIdentifier)
        .maybeSingle();
      if (error) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
      targetUserId = isValidUuid(profile?.user_id) ? profile.user_id : null;
    }

    let credential: PasswordCredential = {
      email: `invalid-${crypto.randomUUID()}@example.invalid`,
      password,
    };

    if (targetUserId) {
      const { data: targetData, error: targetErr } = await admin.auth.admin.getUserById(targetUserId);
      if (targetErr || !targetData?.user) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);

      let authUser = targetData.user;

      if (isPublicPhoneRegistration(authUser) && !confirmedEmail(authUser) && confirmedPhone(authUser)) {
        const { data: passwordMatches, error: passwordVerifyErr } = await admin.rpc(
          "verify_public_registration_password_service",
          { p_user_id: targetUserId, p_password: password },
        );

        if (passwordVerifyErr) {
          return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
        }

        if (passwordMatches !== true) {
          try {
            await admin.rpc("record_auth_failure", {
              p_user_id: targetUserId,
              p_identifier_hash: identifierHash,
              p_ip_hash: ipHash,
            });
          } catch {
            // Never block the generic credential response on bookkeeping failure.
          }
          await randomDelay();
          return json({ error: "INVALID_CREDENTIALS" }, 401, allowedOrigin);
        }

        const { data: migratedData, error: migrateErr } = await admin.auth.admin.updateUserById(
          targetUserId,
          {
            email: internalCredentialEmail(targetUserId),
            email_confirm: true,
          },
        );
        if (migrateErr || !migratedData?.user) {
          return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
        }
        authUser = migratedData.user;
      }

      const selected = chooseConfirmedCredential(authUser, password);
      if (selected) credential = selected;
    } else if (method === "email") {
      credential = { email: canonicalIdentifier, password };
    }

    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const signInResult = await anon.auth.signInWithPassword(credential);
    if (signInResult.error || !signInResult.data.session || !signInResult.data.user) {
      try {
        if (targetUserId) {
          await admin.rpc("record_auth_failure", {
            p_user_id: targetUserId,
            p_identifier_hash: identifierHash,
            p_ip_hash: ipHash,
          });
        }
      } catch {
        // Never block login response on audit/lockout bookkeeping failure.
      }
      await randomDelay();
      return json({ error: "INVALID_CREDENTIALS" }, 401, allowedOrigin);
    }

    const accessToken = signInResult.data.session.access_token;
    const userId = signInResult.data.user.id;
    if (targetUserId && userId !== targetUserId) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }

    let jwtPayload: { sub?: string; session_id?: string; amr?: unknown };
    try {
      const parts = accessToken.split(".");
      if (parts.length < 2) throw new Error("INVALID_JWT");
      jwtPayload = JSON.parse(base64UrlDecode(parts[1]));
    } catch {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }

    if (jwtPayload.sub !== userId || !hasPasswordAmr(jwtPayload.amr)) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }
    const sessionId = jwtPayload.session_id;
    if (!isValidUuid(sessionId)) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }

    const { data: verifiedUser, error: userErr } = await admin.auth.getUser(accessToken);
    if (userErr || !verifiedUser?.user || verifiedUser.user.id !== userId) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }

    const { data: authData, error: authErr } = await admin.rpc("authorize_password_gateway_session_v1", {
      p_session_id: sessionId,
      p_user_id: userId,
      p_login_method: method,
      p_identifier_hash: identifierHash,
      p_ip_hash: ipHash,
    });
    if (authErr || !authData) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }
    const authRow = Array.isArray(authData) ? authData[0] : authData;
    if (!authRow || authRow.authorized !== true) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }

    const { data: settingsData, error: settingsErr } = await admin
      .from("auth_security_settings")
      .select("session_management_enabled, session_idle_timeout_minutes, session_absolute_lifetime_minutes")
      .eq("id", 1)
      .maybeSingle();
    if (settingsErr) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }

    if (settingsData?.session_management_enabled) {
      const { data: regData, error: regErr } = await admin.rpc("register_session_security_state_v2", {
        p_session_id: sessionId,
        p_user_id: userId,
        p_idle_timeout_minutes: settingsData.session_idle_timeout_minutes ?? 480,
        p_absolute_lifetime_minutes: settingsData.session_absolute_lifetime_minutes ?? 1440,
        p_device_summary: req.headers.get("user-agent")?.slice(0, 200) ?? "unknown",
        p_ip_hash: ipHash,
      });
      if (regErr || !regData?.ok) {
        await localLogout(accessToken);
        return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
      }
    }

    return json(
      {
        access_token: accessToken,
        refresh_token: signInResult.data.session.refresh_token,
        login_method: method,
      },
      200,
      allowedOrigin,
    );
  } catch {
    return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }
});
