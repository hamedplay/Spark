export type SmsDeliveryMode = "immediate" | "window" | "fixed_time";

export type SmsDeliveryPolicy = {
  category: string;
  eventType: string;
  mode: SmsDeliveryMode;
  windowStart: string;
  windowEnd: string;
  fixedTime: string;
  timezone: string;
  lockedImmediate: boolean;
};

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const AUTH_IMMEDIATE_EVENTS = new Set([
  "auth:login_otp",
  "auth:registration_phone_otp",
]);

function parseMinutes(value: string): number | null {
  if (!TIME_RE.test(value)) return null;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function zonedParts(date: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day")),
    hour: Number(map.get("hour")),
    minute: Number(map.get("minute")),
  };
}

function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const targetMs = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = new Date(targetMs);
  for (let i = 0; i < 3; i += 1) {
    const local = zonedParts(guess, timeZone);
    const localAsUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
    guess = new Date(guess.getTime() + (targetMs - localAsUtc));
  }
  return guess;
}

function addDays(parts: { year: number; month: number; day: number }, days: number) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  };
}

export function isLockedImmediateSmsEvent(category: string, eventType: string): boolean {
  return AUTH_IMMEDIATE_EVENTS.has(category + ":" + eventType);
}

export async function loadSmsDeliveryPolicy(
  supabase: any,
  category: string,
  eventType: string,
): Promise<SmsDeliveryPolicy> {
  const lockedImmediate = isLockedImmediateSmsEvent(category, eventType);
  if (lockedImmediate) {
    return {
      category,
      eventType,
      mode: "immediate",
      windowStart: "06:00",
      windowEnd: "20:00",
      fixedTime: "09:00",
      timezone: "Asia/Tehran",
      lockedImmediate: true,
    };
  }

  const { data, error } = await supabase
    .from("sms_delivery_policies")
    .select("delivery_mode,window_start,window_end,fixed_time,timezone")
    .eq("category", category)
    .eq("event_type", eventType)
    .maybeSingle();

  if (error && error.code !== "PGRST116" && error.code !== "42P01" && error.code !== "PGRST205") {
    throw error;
  }

  const rawMode = String(data?.delivery_mode || "immediate");
  const mode: SmsDeliveryMode =
    rawMode === "window" || rawMode === "fixed_time" ? rawMode : "immediate";
  const windowStart = TIME_RE.test(String(data?.window_start || ""))
    ? String(data.window_start).slice(0, 5)
    : "06:00";
  const windowEnd = TIME_RE.test(String(data?.window_end || ""))
    ? String(data.window_end).slice(0, 5)
    : "20:00";
  const fixedTime = TIME_RE.test(String(data?.fixed_time || ""))
    ? String(data.fixed_time).slice(0, 5)
    : "09:00";

  return {
    category,
    eventType,
    mode,
    windowStart,
    windowEnd,
    fixedTime,
    timezone: String(data?.timezone || "Asia/Tehran"),
    lockedImmediate: false,
  };
}

export function evaluateSmsDeliveryPolicy(
  policy: SmsDeliveryPolicy,
  now = new Date(),
  eventCreatedAt = now,
): { sendNow: boolean; nextAllowedAt: Date | null } {
  if (policy.lockedImmediate || policy.mode === "immediate") {
    return { sendNow: true, nextAllowedAt: null };
  }

  const localNow = zonedParts(now, policy.timezone);
  const localEvent = zonedParts(eventCreatedAt, policy.timezone);
  const nowMinutes = localNow.hour * 60 + localNow.minute;
  const eventMinutes = localEvent.hour * 60 + localEvent.minute;

  if (policy.mode === "fixed_time") {
    const fixed = parseMinutes(policy.fixedTime);
    if (fixed == null) return { sendNow: true, nextAllowedAt: null };
    const [hour, minute] = policy.fixedTime.split(":").map(Number);
    const eventDate = eventMinutes <= fixed ? localEvent : addDays(localEvent, 1);
    const target = zonedToUtc(eventDate.year, eventDate.month, eventDate.day, hour, minute, policy.timezone);
    if (now.getTime() >= target.getTime()) {
      return { sendNow: true, nextAllowedAt: null };
    }
    return { sendNow: false, nextAllowedAt: target };
  }

  const start = parseMinutes(policy.windowStart);
  const end = parseMinutes(policy.windowEnd);
  if (start == null || end == null || start === end) {
    return { sendNow: true, nextAllowedAt: null };
  }

  const [startHour, startMinute] = policy.windowStart.split(":").map(Number);

  const eventInsideWindow = start < end
    ? eventMinutes >= start && eventMinutes < end
    : eventMinutes >= start || eventMinutes < end;

  if (eventInsideWindow) {
    return { sendNow: true, nextAllowedAt: null };
  }

  let targetDate;
  if (start < end) {
    targetDate = eventMinutes < start ? localEvent : addDays(localEvent, 1);
  } else {
    targetDate = localEvent;
  }

  const target = zonedToUtc(
    targetDate.year,
    targetDate.month,
    targetDate.day,
    startHour,
    startMinute,
    policy.timezone,
  );

  if (now.getTime() >= target.getTime()) {
    return { sendNow: true, nextAllowedAt: null };
  }

  return { sendNow: false, nextAllowedAt: target };
}

export async function queueDeferredSms(
  supabase: any,
  input: {
    deliveryMode: "dispatch" | "external" | "send";
    targetUserId?: string | null;
    targetPhones?: string[];
    category: string;
    eventType: string;
    audience?: string;
    context?: Record<string, unknown>;
    meetingId?: string | null;
    actorUserId?: string | null;
    eventKey?: string | null;
    rawMessage?: string | null;
    providerId?: string | null;
    availableAt: Date;
  },
): Promise<"queued" | "duplicate"> {
  const phones = [...(input.targetPhones || [])].sort();
  const identity = input.targetUserId
    ? "user:" + input.targetUserId
    : "phones:" + phones.join(",");
  const base = input.eventKey
    ? "event:" + input.eventKey
    : [
        input.deliveryMode,
        input.category,
        input.eventType,
        input.meetingId || "none",
        input.actorUserId || "system",
        identity,
        input.availableAt.toISOString().slice(0, 16),
      ].join(":");

  const { error } = await supabase.from("deferred_sms_queue").insert({
    delivery_mode: input.deliveryMode,
    target_user_id: input.targetUserId || null,
    target_phones: phones,
    category: input.category,
    event_type: input.eventType,
    audience: input.audience || "all",
    context: input.context || {},
    meeting_id: input.meetingId || null,
    actor_user_id: input.actorUserId || null,
    event_key: input.eventKey || null,
    raw_message: input.rawMessage || null,
    provider_id: input.providerId || null,
    idempotency_key: "sms-policy:" + base + ":" + identity,
    available_at: input.availableAt.toISOString(),
    status: "pending",
  });

  if (!error) return "queued";
  if (error.code === "23505") return "duplicate";
  throw error;
}
