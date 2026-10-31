import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import webpush from "npm:web-push@3.6.7";
import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return json({ error: authResult.error?.message || 'AUTH_ACCESS_RESTRICTED' }, authResult.error?.status || 403);

  // Normal reads use the caller's session and return only the public key.
  const { data: config, error: configError } = await authResult.userClient!.rpc('get_my_pwa_push_config');
  if (!configError && config?.publicKey) return json(config);
  // Preserve first-install provisioning; never replace existing keys on a read error.
  const needsInitialization = (!configError && config?.configured === false)
    || configError?.message?.includes('PWA_PUSH_NOT_CONFIGURED');
  if (!needsInitialization) {
    console.error('pwa-push-config read failed', configError?.code || 'CONFIG_EMPTY');
    return json({ error: 'VAPID_CONFIG_READ_FAILED', code: configError?.code || 'CONFIG_EMPTY' }, 503);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const service = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: existing, error: getError } = await service.rpc("get_pwa_vapid_config_service");
  if (getError) return json({ error: "VAPID_CONFIG_READ_FAILED" }, 500);

  let publicKey = typeof existing?.public_key === "string" ? existing.public_key : "";
  let privateKey = typeof existing?.private_key === "string" ? existing.private_key : "";

  if (!publicKey || !privateKey) {
    const generated = webpush.generateVAPIDKeys();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;

    const { error: setError } = await service.rpc("set_pwa_vapid_config_service", {
      p_public_key: publicKey,
      p_private_key: privateKey,
    });
    if (setError) return json({ error: "VAPID_CONFIG_WRITE_FAILED" }, 500);
    // A concurrent initializer may have stored the canonical pair first.
    const { data: stored, error: storedError } = await service.rpc("get_pwa_vapid_config_service");
    if (storedError || !stored?.public_key || !stored?.private_key) {
      return json({ error: "VAPID_CONFIG_READ_FAILED" }, 503);
    }
    publicKey = stored.public_key;
  }

  return json({ publicKey });
});
