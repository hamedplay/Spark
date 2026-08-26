import { isValidPhone, normalizePhone } from "./phone.ts";
import { renderSystemSmsTemplate } from "./templateRenderer.ts";

// The Edge Function creates its Supabase client without generated Database typing.
// Preserve that deliberately loose query-builder boundary after extraction.
type SmsClient = any;
type Caller = { userId: string; isAdmin: boolean };
type JsonResponder = (data: unknown, status?: number) => Response;
type ModeContext = {
  supabase: SmsClient;
  body: Record<string, any>;
  caller: Caller;
  json: JsonResponder;
};

function objectContext(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export async function handleDispatchMode({ supabase, body, caller, json }: ModeContext): Promise<Response> {
  const targetUserId: string = body.targetUserId || "";
  const category: string = body.category || "";
  const eventType: string = body.eventType || "";
  const audience: string = body.audience || "all";
  const meetingId: string | null = typeof body.meetingId === "string" && body.meetingId ? body.meetingId : null;
  const context = objectContext(body.context);
  const triggeredByUserId: string | null = body.triggeredByUserId ?? caller.userId ?? null;

  if (!targetUserId) return json({ ok: false, errorCode: "TARGET_PROFILE_NOT_FOUND", error: "targetUserId الزامی است" }, 400);
  if (!category || !eventType) return json({ ok: false, errorCode: "INVALID_REQUEST", error: "category و eventType الزامی است" }, 400);

  // Verify target user profile exists before rendering or resolving routing rules.
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("user_id, phone, is_active")
    .eq("user_id", targetUserId)
    .maybeSingle();

  if (!targetProfile) {
    await supabase.from("sms_dispatch_logs").insert({
      target_user_id: targetUserId,
      triggered_by_user_id: triggeredByUserId === "service" ? null : triggeredByUserId,
      category,
      event_type: eventType,
      audience,
      message: "",
      target_phone: null,
      status: "skipped",
      error_text: "TARGET_PROFILE_NOT_FOUND: پروفایل کاربر هدف یافت نشد",
    });
    return json({ ok: true, status: "skipped", reason: "TARGET_PROFILE_NOT_FOUND" });
  }

  // Render here, server-side. System callers cannot inject final SMS text.
  const rendered = await renderSystemSmsTemplate({
    supabase,
    category,
    eventType,
    audience,
    context,
    targetUserId,
    meetingId,
  });

  if (!rendered.ok) {
    await supabase.from("sms_dispatch_logs").insert({
      target_user_id: targetUserId,
      triggered_by_user_id: triggeredByUserId === "service" ? null : triggeredByUserId,
      category,
      event_type: eventType,
      audience,
      message: "",
      target_phone: targetProfile.phone ?? null,
      status: rendered.errorCode === "SMS_TEMPLATE_NOT_FOUND" ? "skipped" : "failed",
      error_text: `${rendered.errorCode}: ${rendered.error}`,
    });
    return json({
      ok: rendered.errorCode === "SMS_TEMPLATE_NOT_FOUND",
      status: rendered.errorCode === "SMS_TEMPLATE_NOT_FOUND" ? "skipped" : "failed",
      reason: rendered.errorCode,
      errorCode: rendered.errorCode,
      error: rendered.error,
      missing: rendered.missing ?? [],
    }, rendered.errorCode === "SMS_TEMPLATE_NOT_FOUND" ? 200 : 422);
  }

  const message = rendered.text;
  const logBase = {
    target_user_id: targetUserId,
    triggered_by_user_id: triggeredByUserId === "service" ? null : triggeredByUserId,
    category,
    event_type: eventType,
    audience,
    message,
  };

  // Resolve SMS rule: target user's group membership + sms_group_rules for this category.
  const { data: dispatchRows, error: rpcError } = await supabase
    .rpc("get_sms_dispatch_info", { target_user_id: targetUserId, p_category: category });

  if (rpcError) {
    await supabase.from("sms_dispatch_logs").insert({
      ...logBase, target_phone: null, status: "failed",
      error_text: `SMS_RULE_NOT_FOUND: ${rpcError.message}`,
    });
    return json({ ok: true, status: "skipped", reason: "SMS_RULE_NOT_FOUND" });
  }

  if (!dispatchRows?.length) {
    await supabase.from("sms_dispatch_logs").insert({
      ...logBase, target_phone: null, status: "skipped",
      error_text: `SMS_RULE_NOT_FOUND: پیامک برای دسته «${category}» در گروه‌های کاربر فعال نیست`,
    });
    return json({ ok: true, status: "skipped", reason: "SMS_RULE_NOT_FOUND" });
  }

  const resolvedProviderId: string | null = dispatchRows[0].provider_id ?? null;
  const rawPhone: string = dispatchRows[0].phone?.trim() ?? "";

  if (!rawPhone || rawPhone.length < 7) {
    await supabase.from("sms_dispatch_logs").insert({
      ...logBase, target_phone: rawPhone || null, provider_id: resolvedProviderId,
      status: "skipped", error_text: "INVALID_TARGET_PHONE: شماره موبایل کاربر ثبت نشده یا معتبر نیست",
    });
    return json({ ok: true, status: "skipped", reason: "INVALID_TARGET_PHONE" });
  }

  // Resolve provider name for logging.
  let providerName: string | null = null;
  let effectiveProviderId: string | null = resolvedProviderId;
  if (effectiveProviderId) {
    const { data: prov } = await supabase.from("sms_providers").select("title").eq("id", effectiveProviderId).maybeSingle();
    providerName = prov?.title ?? null;
  } else {
    const { data: defProv } = await supabase.from("sms_providers").select("id, title").eq("is_default", true).eq("is_active", true).maybeSingle();
    if (defProv) { effectiveProviderId = defProv.id; providerName = defProv.title; }
  }

  // Delegate only the already server-rendered text to the low-level provider mode.
  const sendBody = { mode: "send", mobiles: [rawPhone], message };
  if (effectiveProviderId) (sendBody as Record<string, unknown>).providerId = effectiveProviderId;

  const innerResp = await fetch(
    `${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify(sendBody),
    },
  );
  const result = await innerResp.json();

  if (result.ok) {
    const providerMessageId: string | null = result.returnIds?.[0] ?? null;
    await supabase.from("sms_dispatch_logs").insert({
      ...logBase,
      target_phone: rawPhone,
      provider_id: effectiveProviderId,
      provider_name: providerName,
      status: "sent",
      pack_id: result.packId ?? null,
      message_ids: result.messageIds ?? null,
      cost: result.cost ?? null,
      raw_response: result.response ?? null,
      provider_message_id: providerMessageId,
      delivery_status: providerMessageId ? "pending" : null,
    });
    return json({
      ok: true,
      status: "sent",
      targetPhone: rawPhone,
      providerId: effectiveProviderId,
      templateId: rendered.templateId,
      packId: result.packId ?? null,
      messageIds: result.messageIds ?? null,
      returnIds: result.returnIds ?? null,
    });
  }

  await supabase.from("sms_dispatch_logs").insert({
    ...logBase,
    target_phone: rawPhone,
    provider_id: effectiveProviderId,
    provider_name: providerName,
    status: "failed",
    error_text: `PROVIDER_ERROR: ${result.error ?? "خطای ناشناخته از سرویس پیامک"}`,
    raw_response: result.response ?? null,
  });
  return json({
    ok: false,
    status: "failed",
    errorCode: "PROVIDER_ERROR",
    error: result.error ?? "خطای ناشناخته از سرویس پیامک",
  });
}

export async function handleExternalMode({ supabase, body, caller, json, isAuthOtp }: ModeContext & { isAuthOtp: boolean }): Promise<Response> {
  const rawMobiles: string[] = body.mobiles || [];
  const triggeredByUserId: string | null = body.triggeredByUserId ?? caller.userId ?? null;
  const category: string = body.category || "meeting";
  const eventType: string = body.eventType || "invite";
  const audience = "external";
  const meetingId: string | null = typeof body.meetingId === "string" && body.meetingId ? body.meetingId : null;
  const context = objectContext(body.context);

  if (!rawMobiles.length) return json({ ok: false, errorCode: "INVALID_REQUEST", error: "شماره موبایل وارد نشده" }, 400);
  if (!category || !eventType) return json({ ok: false, errorCode: "INVALID_REQUEST", error: "category و eventType الزامی است" }, 400);

  // Normalize and deduplicate.
  const seen = new Set<string>();
  const validMobiles: string[] = [];
  const invalidMobiles: string[] = [];
  for (const raw of rawMobiles) {
    const trimmed = raw.replace(/\s/g, "");
    if (!isValidPhone(trimmed)) { invalidMobiles.push(raw); continue; }
    const norm = normalizePhone(trimmed);
    if (!seen.has(norm)) { seen.add(norm); validMobiles.push(norm); }
  }

  if (!validMobiles.length) {
    return json({ ok: false, errorCode: "INVALID_TARGET_PHONE", error: `شماره موبایل معتبری یافت نشد. نامعتبر: ${invalidMobiles.join(", ")}` }, 400);
  }

  // External system SMS is also template-driven. Caller-provided body.message is intentionally ignored.
  const rendered = await renderSystemSmsTemplate({
    supabase,
    category,
    eventType,
    audience,
    context,
    meetingId,
  });

  if (!rendered.ok) {
    const logs = validMobiles.map(phone => ({
      triggered_by_user_id: triggeredByUserId === "service" ? null : triggeredByUserId,
      target_user_id: null,
      target_phone: phone,
      category,
      event_type: eventType,
      audience,
      message: "",
      status: "failed",
      error_text: `${rendered.errorCode}: ${rendered.error}`,
    }));
    await supabase.from("sms_dispatch_logs").insert(logs);
    return json({
      ok: false,
      status: "failed",
      errorCode: rendered.errorCode,
      error: rendered.error,
      missing: rendered.missing ?? [],
    }, 422);
  }

  const message = rendered.text;

  // Delegate to low-level provider dispatch; provider selection remains server-side.
  const innerResp = await fetch(
    `${Deno.env.get("SUPABASE_URL")!}/functions/v1/send-sms`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!}`,
      },
      body: JSON.stringify({ mode: "send", mobiles: validMobiles, message }),
    },
  );
  const result = await innerResp.json();

  // Resolve provider name for logging.
  const { data: defProv } = await supabase.from("sms_providers").select("id, title").eq("is_default", true).eq("is_active", true).maybeSingle();
  const logProviderId: string | null = defProv?.id ?? null;
  const logProviderName: string | null = defProv?.title ?? null;

  const logBase = {
    triggered_by_user_id: triggeredByUserId === "service" ? null : triggeredByUserId,
    target_user_id: null,
    category,
    event_type: eventType,
    audience,
    message,
  };

  const logs = validMobiles.map(phone => ({
    ...logBase,
    target_phone: phone,
    provider_id: logProviderId,
    provider_name: logProviderName,
    status: result.ok ? "sent" : "failed",
    error_text: result.ok ? null : `PROVIDER_ERROR: ${result.error ?? "خطای ناشناخته"}`,
    pack_id: result.ok ? (result.packId ?? null) : null,
    message_ids: result.ok ? (result.messageIds ?? null) : null,
    raw_response: result.response ?? null,
  }));
  await supabase.from("sms_dispatch_logs").insert(logs);

  if (invalidMobiles.length > 0) {
    await supabase.from("sms_dispatch_logs").insert(
      invalidMobiles.map(phone => ({
        ...logBase, target_phone: phone, status: "skipped",
        error_text: "INVALID_TARGET_PHONE: شماره نامعتبر است",
      })),
    );
  }

  if (isAuthOtp) {
    return json({
      ok: result.ok,
      errorCode: result.ok ? null : "SMS_PROVIDER_REJECTED",
      packId: result.packId ?? null,
      messageIds: result.messageIds ?? null,
      returnIds: result.returnIds ?? null,
      cost: result.cost ?? null,
    });
  }
  return json({
    ok: result.ok,
    status: result.ok ? "sent" : "failed",
    sent: result.ok ? validMobiles.length : 0,
    skipped: invalidMobiles.length,
    templateId: rendered.templateId,
    errorCode: result.ok ? undefined : "PROVIDER_ERROR",
    error: result.ok ? undefined : (result.error ?? "خطای ناشناخته"),
    packId: result.packId ?? null,
    messageIds: result.messageIds ?? null,
    returnIds: result.returnIds ?? null,
  });
}
