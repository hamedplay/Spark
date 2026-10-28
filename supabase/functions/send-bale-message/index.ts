import { deliverBaleNotification } from '../_shared/baleDelivery.ts';
import { createClient } from "npm:@supabase/supabase-js@2.111.0";
import {
  requireFullAuthAccess,
  deniedResponse,
} from "../_shared/requireFullAuthAccess.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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

  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return deniedResponse();

  const callerUserId = authResult.userId!;

  let body: { userId?: string; text?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "بدنه درخواست نامعتبر" }, 400);
  }

  const { userId, text } = body;
  if (!userId || typeof userId !== "string") return json({ ok: false, error: "userId لازم است" }, 400);
  if (!text || typeof text !== "string") return json({ ok: false, error: "text لازم است" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: callerProfile, error: callerErr } = await admin
    .from("profiles")
    .select("is_admin, is_active, organization")
    .eq("user_id", callerUserId)
    .maybeSingle();

  if (callerErr || !callerProfile) {
    return json({ ok: false, error: "دسترسی غیرمجاز" }, 401);
  }
  if (!callerProfile.is_active) {
    return json({ ok: false, error: "حساب کاربری غیرفعال است" }, 403);
  }

  if (!callerProfile.is_admin) {
    const { data: targetProfile, error: targetErr } = await admin
      .from("profiles")
      .select("is_active, organization")
      .eq("user_id", userId)
      .maybeSingle();

    if (targetErr || !targetProfile) {
      return json({ ok: false, error: "کاربر مورد نظر یافت نشد" }, 403);
    }
    if (!targetProfile.is_active) {
      return json({ ok: false, error: "کاربر مورد نظر غیرفعال است" }, 403);
    }

    const callerOrg = (callerProfile.organization ?? "").trim();
    const targetOrg = (targetProfile.organization ?? "").trim();
    if (!callerOrg || !targetOrg || callerOrg !== targetOrg) {
      return json({ ok: false, error: "دسترسی غیرمجاز: کاربران باید در یک سازمان باشند" }, 403);
    }
  }

  const result = await deliverBaleNotification(admin, userId, text);
  return json({ ok: result.status === 'sent' || result.status === 'skipped',
    skipped: result.status === 'skipped', ...result }, result.status === 'uncertain' ? 502 : 200);
});
