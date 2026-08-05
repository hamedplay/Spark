// Shared security utilities for public registration edge functions (v4)

export const corsHeaders = {
  "Access-Control-Allow-Origin": "https://icpgvfadixevdjtkllap.supabase.co",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Access-Control-Max-Age": "86400",
} as const;

export const ALLOWED_ORIGINS = new Set([
  "https://icpgvfadixevdjtkllap.supabase.co",
]);

export function getRequestOrigin(req: Request): string {
  return req.headers.get("origin") || req.headers.get("referer") || "";
}

export function isOriginAllowed(origin: string): boolean {
  if (!origin) return false;
  return ALLOWED_ORIGINS.has(origin);
}

export function corsResponse(req: Request, data: unknown, status = 200): Response {
  const origin = getRequestOrigin(req);
  const allowed = isOriginAllowed(origin);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (allowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Client-Info, Apikey";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(JSON.stringify(data), { status, headers });
}

export function preflightResponse(req: Request): Response {
  const origin = getRequestOrigin(req);
  const allowed = isOriginAllowed(origin);
  const headers: Record<string, string> = {};
  if (allowed && origin) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Client-Info, Apikey";
    headers["Access-Control-Max-Age"] = "86400";
  }
  return new Response(null, { status: 200, headers });
}

export function rejectOrigin(req: Request): Response {
  return new Response(JSON.stringify({ error: "درخواست نامعتبر است." }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

export function normalizeIranPhone(value?: string | null): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^00989\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\d{9}$/.test(digits)) return digits;
  if (/^09\d{9}$/.test(digits)) return `98${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `98${digits}`;
  return "";
}

export async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateOtp(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(arr[0] % 1000000).padStart(6, "0");
}

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

import { createClient } from "npm:@supabase/supabase-js@2";
