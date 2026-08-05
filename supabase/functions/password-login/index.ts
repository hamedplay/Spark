import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const MAX_BODY_BYTES = 4096;
const MAX_IDENTIFIER_LEN = 256;
const MAX_PASSWORD_LEN = 1024;

const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
};

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const h: Record<string, string> = { ...baseHeaders };
  if (allowedOrigin) {
    h["Access-Control-Allow-Origin"] = allowedOrigin;
  }
  return h;
}

function json(data: unknown, status: number, allowedOrigin: string | null): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" },
  });
}

async function getAllowedOrigins(): Promise<{ origins: string[]; pepper: string }> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { data, error } = await admin.rpc("get_phone_auth_config");
  if (error || !data) return { origins: [], pepper: "" };
  const row = Array.isArray(data) ? data[0] : data;
  const allowedOrigins: string[] = Array.isArray(row?.allowed_origins) ? row.allowed_origins : [];
  const pepper: string = typeof row?.pepper === "string" ? row.pepper : "";
  return { origins: allowedOrigins, pepper };
}

function checkOrigin(origin: string | null, allowedOrigins: string[]): string | null {
  if (!origin) return null;
  for (const allowed of allowedOrigins) {
    if (origin === allowed) return origin;
  }
  return null;
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function canonicalizePhone(input: string): string | null {
  let s = input.trim();
  s = s.replace(/[\s\-()]/g, "");
  if (/^\+989\d{9}$/.test(s)) return s.slice(1);
  if (/^989\d{9}$/.test(s)) return s;
  if (/^09\d{9}$/.test(s)) return "98" + s.slice(1);
  if (/^00989\d{9}$/.test(s)) return s.slice(2);
  return null;
}

function randomDelay(): Promise<void> {
  const ms = 200 + Math.floor(Math.random() * 400);
  return new Promise((r) => setTimeout(r, ms));
}

Deno.serve(async (req: Request) => {
  const { origins: allowedOrigins, pepper } = await getAllowedOrigins();
  const origin = req.headers.get("Origin");
  const allowedOrigin = checkOrigin(origin, allowedOrigins);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(allowedOrigin) });
  }

  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405, allowedOrigin);
  }

  const contentType = req.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) {
    return json({ error: "INVALID_CONTENT_TYPE" }, 400, allowedOrigin);
  }

  const contentLength = parseInt(req.headers.get("Content-Length") ?? "0", 10);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: "BODY_TOO_LARGE" }, 400, allowedOrigin);
  }

  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    return json({ error: "BODY_TOO_LARGE" }, 400, allowedOrigin);
  }

  let body: { method?: unknown; identifier?: unknown; password?: unknown };
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "INVALID_BODY" }, 400, allowedOrigin);
  }

  const method = body.method;
  const identifier = body.identifier;
  const password = body.password;

  if (typeof method !== "string" || typeof identifier !== "string" || typeof password !== "string") {
    return json({ error: "INVALID_BODY" }, 400, allowedOrigin);
  }

  if (!["username", "email", "phone"].includes(method)) {
    return json({ error: "INVALID_METHOD" }, 400, allowedOrigin);
  }

  if (identifier.length === 0 || identifier.length > MAX_IDENTIFIER_LEN) {
    return json({ error: "INVALID_IDENTIFIER" }, 400, allowedOrigin);
  }

  if (password.length === 0 || password.length > MAX_PASSWORD_LEN) {
    return json({ error: "INVALID_PASSWORD" }, 400, allowedOrigin);
  }

  if (pepper.length < 32) {
    return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  // Read login methods
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: methodsData, error: methodsErr } = await admin.rpc("get_public_login_methods");
  if (methodsErr || !methodsData) {
    return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }
  const methodsRow = Array.isArray(methodsData) ? methodsData[0] : methodsData;

  const methodEnabled =
    (method === "username" && methodsRow?.username_login === true) ||
    (method === "email" && methodsRow?.email_login === true) ||
    (method === "phone" && methodsRow?.phone_login === true);

  if (!methodEnabled) {
    return json({ error: "LOGIN_METHOD_DISABLED" }, 403, allowedOrigin);
  }

  // Canonicalize identifier
  let canonicalIdentifier: string;
  let signInIdentifier: string;
  let signInField: "email" | "phone";

  if (method === "username") {
    canonicalIdentifier = identifier.trim().toLowerCase();
    signInField = "email";
    signInIdentifier = "";
  } else if (method === "email") {
    canonicalIdentifier = identifier.trim().toLowerCase();
    signInField = "email";
    signInIdentifier = canonicalIdentifier;
  } else {
    const canonical = canonicalizePhone(identifier);
    if (!canonical) {
      await randomDelay();
      return json({ error: "INVALID_CREDENTIALS" }, 401, allowedOrigin);
    }
    canonicalIdentifier = canonical;
    signInField = "phone";
    signInIdentifier = "+" + canonical;
  }

  // Compute hashes
  const clientIp =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "0.0.0.0";

  const identifierHash = await hmacSha256Hex(
    pepper,
    `password-login|identifier|${method}|${canonicalIdentifier}`,
  );
  const ipHash = await hmacSha256Hex(pepper, `password-login|ip|${clientIp}`);

  // Rate limit
  const { data: rlData, error: rlErr } = await admin.rpc(
    "consume_password_login_rate_limit_v1",
    {
      p_method: method,
      p_identifier_hash: identifierHash,
      p_ip_hash: ipHash,
      p_pair_limit: 10,
      p_ip_limit: 50,
      p_window_seconds: 900,
    },
  );

  if (rlErr) {
    return json({ error: "LOGIN_UNAVAILABLE" }, 503, allowedOrigin);
  }

  const rlRow = Array.isArray(rlData) ? rlData[0] : rlData;
  if (!rlRow || rlRow.allowed !== true) {
    const retryAfter = typeof rlRow?.retry_after_seconds === "number" ? rlRow.retry_after_seconds : 900;
    return json({ error: "RATE_LIMITED", retry_after_seconds: retryAfter }, 429, allowedOrigin);
  }

  // For username: look up email via service role
  if (method === "username") {
    const { data: emailData, error: emailErr } = await admin.rpc("get_email_by_username", {
      p_username: canonicalIdentifier,
    });
    const usernameExists = !emailErr && typeof emailData === "string" && emailData.length > 0;
    signInIdentifier = usernameExists
      ? (emailData as string)
      : `invalid-${crypto.randomUUID()}@example.invalid`;
  }

  // Sign in with anon client
  const anon = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let signInResult;
  if (signInField === "email") {
    signInResult = await anon.auth.signInWithPassword({
      email: signInIdentifier,
      password,
    });
  } else {
    signInResult = await anon.auth.signInWithPassword({
      phone: signInIdentifier,
      password,
    });
  }

  if (signInResult.error || !signInResult.data.session) {
    await randomDelay();
    return json({ error: "INVALID_CREDENTIALS" }, 401, allowedOrigin);
  }

  return json(
    {
      access_token: signInResult.data.session.access_token,
      refresh_token: signInResult.data.session.refresh_token,
      login_method: method,
    },
    200,
    allowedOrigin,
  );
});
