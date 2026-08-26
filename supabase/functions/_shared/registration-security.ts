// Shared security utilities for public registration edge functions (v4 hardened)
import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { normalizeIranPhone } from "./phone.ts";
import { hmacSha256Hex } from "./crypto.ts";
export { hmacSha256Hex };

export { normalizeIranPhone };


export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function getRequestOrigin(req: Request): string {
  return req.headers.get("origin") || "";
}

let cachedOrigins: Set<string> | null = null;
let originsCacheTime = 0;

export async function getAllowedOrigins(): Promise<Set<string>> {
  if (cachedOrigins && Date.now() - originsCacheTime < 60000) return cachedOrigins;
  const origins = new Set<string>();
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !key) {
      console.log("[ORIGINS] missing env vars");
      return origins;
    }
    const res = await fetch(`${url}/rest/v1/rpc/get_phone_auth_config`, {
      method: "POST",
      headers: {
        "apikey": key,
        "Authorization": `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!res.ok) {
      console.log("[ORIGINS] RPC error:", res.status, await res.text().catch(() => ""));
      return origins;
    }
    const data = await res.json();
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !Array.isArray(row.allowed_origins) || row.allowed_origins.length === 0) {
      return origins;
    }
    for (const o of row.allowed_origins) {
      const trimmed = String(o).trim();
      if (trimmed) origins.add(trimmed);
    }
  } catch (err) {
    console.log("[ORIGINS] exception:", String(err));
    return origins;
  }
  cachedOrigins = origins;
  originsCacheTime = Date.now();
  return origins;
}

export async function isOriginAllowed(origin: string): Promise<boolean> {
  if (!origin) return false;
  const allowed = await getAllowedOrigins();
  return allowed.has(origin);
}

export async function corsResponse(req: Request, data: unknown, status = 200): Promise<Response> {
  const origin = getRequestOrigin(req);
  const allowed = await isOriginAllowed(origin);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (allowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Client-Info, Apikey";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export async function preflightResponse(req: Request): Promise<Response> {
  const origin = getRequestOrigin(req);
  const allowed = await isOriginAllowed(origin);
  const headers: Record<string, string> = {};
  if (allowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Client-Info, Apikey";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(null, { status: 200, headers });
}

export function rejectOrigin(): Response {
  return new Response(JSON.stringify({ error: "درخواست نامعتبر است." }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export async function getRegistrationSecret(client?: ReturnType<typeof adminClient>): Promise<string> {
  const envSecret = Deno.env.get("REGISTRATION_PHONE_OTP_SECRET") || "";
  if (envSecret.length >= 32) return envSecret;

  const supabase = client ?? adminClient();
  const { data, error } = await supabase.rpc("get_registration_phone_otp_secret_service");
  if (error || typeof data !== "string" || data.length < 32) {
    throw new Error("REGISTRATION_PHONE_OTP_SECRET not configured");
  }
  return data;
}

export async function hashIdentity(secret: string, first: string, last: string, username: string, email: string, phone: string): Promise<string> {
  return hmacSha256Hex(secret, `identity|${first}|${last}|${username}|${email}|${phone}`);
}

export async function hashEmail(secret: string, email: string): Promise<string> {
  return hmacSha256Hex(secret, `email|${email}`);
}

export async function hashUsername(secret: string, username: string): Promise<string> {
  return hmacSha256Hex(secret, `username|${username.toLowerCase()}`);
}

export async function hashPhone(secret: string, phone: string): Promise<string> {
  return hmacSha256Hex(secret, `phone|${phone}`);
}

export async function hashIp(secret: string, ip: string): Promise<string> {
  return hmacSha256Hex(secret, `ip|${ip}`);
}

export async function hashOtp(secret: string, challengeId: string, identityHash: string, phoneHash: string, otp: string): Promise<string> {
  return hmacSha256Hex(secret, `otp|${challengeId}|${identityHash}|${phoneHash}|${otp}`);
}

export function generateOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, "0");
}

export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  const aHmac = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const aSig = new Uint8Array(await crypto.subtle.sign("HMAC", aHmac, aBytes));
  const bSig = new Uint8Array(await crypto.subtle.sign("HMAC", aHmac, bBytes));
  let diff = 0;
  for (let i = 0; i < aSig.length; i++) diff |= aSig[i] ^ bSig[i];
  return diff === 0;
}

export async function abortAwareDelay(ms: number, signal?: AbortSignal): Promise<void> {
  try {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), ms);
      signal?.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
  } catch { /* ignore */ }
}
