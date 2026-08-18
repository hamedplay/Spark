import { createClient } from "npm:@supabase/supabase-js@2.112.3";

export const postJsonCorsBaseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export function createServiceRoleClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function getPhoneAuthAllowedOrigins(): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("get_phone_auth_config");
  if (error || !data) return [];
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !Array.isArray(row.allowed_origins)) return [];
  return Array.from(new Set(
    row.allowed_origins
      .filter((value: unknown): value is string => typeof value === "string")
      .map((value: string) => value.trim())
      .filter(Boolean),
  ));
}

export function createJsonResponseHeaders(baseCorsHeaders: Record<string, string>) {
  return (origin: string | null): Record<string, string> => ({
    ...baseCorsHeaders,
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Vary": "Origin",
  });
}
