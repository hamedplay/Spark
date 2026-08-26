import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import postgres from "npm:postgres@3.4.7";
import { hmacSha256Hex } from "../_shared/crypto.ts";

const MAX_BODY_BYTES = 4096;
const MAX_IDENTIFIER_LEN = 256;
const MAX_PASSWORD_LEN = 1024;

const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Vary": "Origin",
};

type LoginMethod = "username" | "email" | "phone";
type PasswordCredential = { email: string; password: string } | { phone: string; password: string };
type JsonObject = Record<string, unknown>;

const databaseUrl = Deno.env.get("SUPABASE_DB_URL") ?? "";
const db = databaseUrl
  ? postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 5,
      idle_timeout: 20,
    })
  : null;

function publicApiKey(): string {
  const rawPublishableKeys = Deno.env.get("SUPABASE_PUBLISHABLE_KEYS");
  if (rawPublishableKeys) {
    try {
      const keys = JSON.parse(rawPublishableKeys) as Record<string, unknown>;
      if (typeof keys.default === "string" && keys.default.length > 0) return keys.default;
    } catch {
      // Fall through to the legacy public key for backward compatibility.
    }
  }
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...baseHeaders };
  if (allowedOrigin) headers["Access-Control-Allow-Origin"] = allowedOrigin;
  return headers;
}

function json(data: unknown, status: number, allowedOrigin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" },
  });
}

function resultObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

async function getConfig(): Promise<{ origins: string[]; pepper: string }> {
  if (!db) throw new Error("DB_UNAVAILABLE");
  const rows = await db`select allowed_origins, pepper from public.get_phone_auth_config()`;
  const row = rows[0];
  if (!row) throw new Error("CONFIG_UNAVAILABLE");
  return {
    origins: Array.isArray(row.allowed_origins) ? row.allowed_origins.filter((value): value is string => typeof value === "string") : [],
    pepper: typeof row.pepper === "string" ? row.pepper : "",
  };
}

function checkOrigin(origin: string | null, allowedOrigins: string[]): string | null {
  if (!origin) return null;
  return allowedOrigins.includes(origin) ? origin : null;
}

function canonicalizePhone(input: string): string | null {
  const value = input.trim().replace(/[\s\-()]/g, "");
  if (/^\+989\d{9}$/.test(value)) return value.slice(1);
  if (/^989\d{9}$/.test(value)) return value;
  if (/^09\d{9}$/.test(value)) return `98${value.slice(1)}`;
  if (/^00989\d{9}$/.test(value)) return value.slice(2);
  return null;
}

function randomDelay(): Promise<void> {
  const ms = 200 + Math.floor(Math.random() * 400);
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function base64UrlDecode(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return atob(normalized + padding);
}

function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function hasPasswordAmr(amr: unknown): boolean {
  return Array.isArray(amr) && amr.some((item: unknown) => {
    const record = resultObject(item);
    return record?.method === "password";
  });
}

function confirmedEmail(user: JsonObject): string | null {
  return typeof user.email === "string" && user.email.length > 0 && user.email_confirmed_at
    ? user.email
    : null;
}

function confirmedPhone(user: JsonObject): string | null {
  if (typeof user.phone !== "string" || user.phone.length === 0 || !user.phone_confirmed_at) return null;
  const canonical = canonicalizePhone(user.phone);
  return canonical ? `+${canonical}` : null;
}

function chooseConfirmedCredential(authUser: JsonObject, password: string): PasswordCredential | null {
  const email = confirmedEmail(authUser);
  if (email) return { email, password };
  const phone = confirmedPhone(authUser);
  if (phone) return { phone, password };
  return null;
}

async function localLogout(accessToken: string): Promise<void> {
  try {
    await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/logout?scope=local`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "apikey": publicApiKey(),
        "Content-Type": "application/json",
      },
    });
  } catch {
    // Gateway authorization still makes an un-authorized session unusable if logout fails.
  }
}

async function recordAuthFailure(userId: string, identifierHash: string, ipHash: string): Promise<void> {
  if (!db) return;
  try {
    await db`select public.record_auth_failure(${userId}::uuid, ${identifierHash}, ${ipHash})`;
  } catch {
    // Never block the generic credential response on bookkeeping failure.
  }
}

async function resolveTargetUserId(method: LoginMethod, canonicalIdentifier: string): Promise<string | null> {
  if (!db) throw new Error("DB_UNAVAILABLE");

  if (method === "username") {
    const rows = await db`
      select user_id
      from public.profiles
      where normalized_username = ${canonicalIdentifier}
      limit 2
    `;
    if (rows.length > 1) throw new Error("AMBIGUOUS_IDENTIFIER");
    return isValidUuid(rows[0]?.user_id) ? rows[0].user_id : null;
  }

  if (method === "phone") {
    const rows = await db`select user_id from public.resolve_phone_password_login_v1(${canonicalIdentifier})`;
    if (rows.length > 1) throw new Error("AMBIGUOUS_IDENTIFIER");
    return isValidUuid(rows[0]?.user_id) ? rows[0].user_id : null;
  }

  const rows = await db`
    select user_id
    from public.profiles
    where normalized_email = ${canonicalIdentifier}
    limit 2
  `;
  if (rows.length > 1) throw new Error("AMBIGUOUS_IDENTIFIER");
  return isValidUuid(rows[0]?.user_id) ? rows[0].user_id : null;
}

async function getAuthUserForCredential(userId: string): Promise<JsonObject | null> {
  if (!db) throw new Error("DB_UNAVAILABLE");
  const rows = await db`
    select id, email, phone, email_confirmed_at, phone_confirmed_at, raw_app_meta_data
    from auth.users
    where id = ${userId}::uuid
      and deleted_at is null
    limit 1
  `;
  return rows[0] ? rows[0] as JsonObject : null;
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
  if (pepper.length < 32 || !db) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);

  try {
    const methodsRows = await db`select * from public.get_public_login_methods()`;
    const methods = methodsRows[0];
    if (!methods) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);

    const methodEnabled =
      (method === "username" && methods.username_login === true) ||
      (method === "email" && methods.email_login === true) ||
      (method === "phone" && methods.phone_login === true);
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

    const rateRows = await db`
      select public.consume_password_login_rate_limit_v1(
        ${method},
        ${identifierHash},
        ${ipHash},
        ${10},
        ${50},
        ${900}
      ) as result
    `;
    const rateResult = resultObject(rateRows[0]?.result);
    if (!rateResult) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    if (rateResult.allowed !== true) {
      const retryAfter = typeof rateResult.retry_after_seconds === "number" ? rateResult.retry_after_seconds : 900;
      return json({ error: "RATE_LIMITED", retry_after_seconds: retryAfter }, 429, allowedOrigin);
    }

    const targetUserId = await resolveTargetUserId(method, canonicalIdentifier);
    let credential: PasswordCredential = {
      email: `invalid-${crypto.randomUUID()}@example.invalid`,
      password,
    };

    if (targetUserId) {
      const authUser = await getAuthUserForCredential(targetUserId);
      if (!authUser) return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
      const selected = chooseConfirmedCredential(authUser, password);
      if (selected) credential = selected;
    } else if (method === "email") {
      credential = { email: canonicalIdentifier, password };
    }

    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      publicApiKey(),
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const signInResult = await authClient.auth.signInWithPassword(credential);
    if (signInResult.error || !signInResult.data.session || !signInResult.data.user) {
      if (targetUserId) await recordAuthFailure(targetUserId, identifierHash, ipHash);
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

    const { data: verifiedUser, error: userError } = await authClient.auth.getUser(accessToken);
    if (userError || !verifiedUser?.user || verifiedUser.user.id !== userId) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }

    const authorizationRows = await db`
      select public.authorize_password_gateway_session_v1(
        ${sessionId}::uuid,
        ${userId}::uuid,
        ${method},
        ${identifierHash},
        ${ipHash}
      ) as result
    `;
    const authorization = resultObject(authorizationRows[0]?.result);
    if (!authorization || authorization.authorized !== true) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }

    const settingsRows = await db`
      select session_management_enabled, session_idle_timeout_minutes, session_absolute_lifetime_minutes
      from public.auth_security_settings
      where id = 1
      limit 1
    `;
    const settings = settingsRows[0];
    if (!settings) {
      await localLogout(accessToken);
      return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
    }

    if (settings.session_management_enabled === true) {
      const idleMinutes = typeof settings.session_idle_timeout_minutes === "number" ? settings.session_idle_timeout_minutes : 480;
      const absoluteMinutes = typeof settings.session_absolute_lifetime_minutes === "number" ? settings.session_absolute_lifetime_minutes : 1440;
      const registrationRows = await db`
        select public.register_session_security_state_v2(
          ${sessionId}::uuid,
          ${userId}::uuid,
          ${idleMinutes},
          ${absoluteMinutes},
          ${req.headers.get("user-agent")?.slice(0, 200) ?? "unknown"},
          ${ipHash}
        ) as result
      `;
      const registration = resultObject(registrationRows[0]?.result);
      if (!registration || registration.ok !== true) {
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
