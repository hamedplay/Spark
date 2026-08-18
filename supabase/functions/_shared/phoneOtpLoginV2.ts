import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { hmacSha256Hex } from "./crypto.ts";
export { hmacSha256Hex };


export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export function canonicalizeIranPhone(input: string): string | null {
  let s = input.trim().replace(/[\s\-()]/g, "");
  if (/^\+989\d{9}$/.test(s)) return s.slice(1);
  if (/^989\d{9}$/.test(s)) return s;
  if (/^09\d{9}$/.test(s)) return "98" + s.slice(1);
  if (/^00989\d{9}$/.test(s)) return s.slice(2);
  return null;
}

export function generateSixDigitOtp(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const num = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
  const otp = Math.abs(num) % 1000000;
  return otp.toString().padStart(6, "0");
}

export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "0.0.0.0"
  );
}

export function isValidUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function minimumResponseDelay(start: number): Promise<void> {
  const elapsed = Date.now() - start;
  const target = 800 + Math.floor(Math.random() * 400);
  const remaining = target - elapsed;
  if (remaining > 0) {
    await new Promise((r) => setTimeout(r, remaining));
  }
}

export const baseCorsHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
  "Pragma": "no-cache",
  "Vary": "Origin",
};

export function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const h: Record<string, string> = { ...baseCorsHeaders };
  if (allowedOrigin) h["Access-Control-Allow-Origin"] = allowedOrigin;
  return h;
}

export function checkOrigin(origin: string | null, allowedOrigins: string[]): string | null {
  if (!origin) return null;
  for (const allowed of allowedOrigins) {
    if (origin === allowed) return origin;
  }
  return null;
}

export function jsonResponse(
  data: unknown,
  status: number,
  allowedOrigin: string | null,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" },
  });
}
