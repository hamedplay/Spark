import { createClient } from "npm:@supabase/supabase-js@2.112.3";
import { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";

// Daily report edge function — sends daily management meeting summaries
export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Timezone ────────────────────────────────────────────────────────────────
export const TEHRAN_TIMEZONE = "Asia/Tehran";

interface TehranNow {
  date: string;          // YYYY-MM-DD (Gregorian, Tehran)
  time: string;          // HH:mm (Tehran)
  weekdayIndex: number;  // 0=شنبه … 6=جمعه
  startOfDayUtc: string; // ISO timestamp for start of Tehran day
  endOfDayUtc: string;   // ISO timestamp for end of Tehran day
}

/**
 * Returns Tehran date parts using Intl.DateTimeFormat.
 * Handles DST correctly — offset is never hardcoded.
 */
export function getTehranDateParts(now = new Date()): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEHRAN_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });

  const parts = Object.fromEntries(
    formatter
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return parts;
}

/**
 * Converts a JS weekday (Sun=0..Sat=6) to Jalaali weekday index
 * (Sat=0=شنبه, Sun=1=یکشنبه, …, Fri=6=جمعه).
 */
export function jsWeekdayToJalaaliIndex(jsWeekday: number): number {
  // JS: Sun=0 Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6
  // Jalaali: Sat=0 Sun=1 Mon=2 Tue=3 Wed=4 Thu=5 Fri=6
  return (jsWeekday + 1) % 7;
}

export function getTehranNow(now = new Date()): TehranNow {
  const parts = getTehranDateParts(now);
  const year = parseInt(parts.year);
  const month = parseInt(parts.month);
  const day = parseInt(parts.day);
  const hour = parseInt(parts.hour);
  const minute = parseInt(parts.minute);
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const date = `${parts.year}-${parts.month}-${parts.day}`;

  // Determine weekday using Intl weekday (short: Sat, Sun, Mon, …)
  const weekdayShort = parts.weekday; // "Sat","Sun","Mon","Tue","Wed","Thu","Fri"
  const weekdayMap: Record<string, number> = {
    Sat: 0, Sun: 1, Mon: 2, Tue: 3, Wed: 4, Thu: 5, Fri: 6,
  };
  const weekdayIndex = weekdayMap[weekdayShort] ?? 0;

  // Compute start/end of Tehran day in UTC
  // We need to find the UTC instant that corresponds to 00:00 Tehran time
  // and 23:59:59.999 Tehran time.
  // Use Intl to format a Date at midnight Tehran and parse back.
  const startOfDayTehran = new Date();
  startOfDayTehran.setFullYear(year, month - 1, day);
  startOfDayTehran.setHours(0, 0, 0, 0);

  // Get the UTC offset for Tehran at this instant
  const tehranOffsetMin = getTehranOffsetMinutes(startOfDayTehran);
  const startOfDayUtc = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - tehranOffsetMin * 60 * 1000);
  const endOfDayUtc = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - tehranOffsetMin * 60 * 1000);

  return {
    date,
    time,
    weekdayIndex,
    startOfDayUtc: startOfDayUtc.toISOString(),
    endOfDayUtc: endOfDayUtc.toISOString(),
  };
}

/**
 * Returns the UTC offset (in minutes) for Tehran at the given date.
 * Uses Intl.DateTimeFormat to detect DST.
 */
export function getTehranOffsetMinutes(d: Date): number {
  // Format the same instant in Tehran and UTC, compute difference
  const tehranParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TEHRAN_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);

  const tp = Object.fromEntries(
    tehranParts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );

  // Construct what Tehran local time looks like as if it were UTC
  const tehranAsUtcMs = Date.UTC(
    parseInt(tp.year), parseInt(tp.month) - 1, parseInt(tp.day),
    parseInt(tp.hour), parseInt(tp.minute), parseInt(tp.second),
  );
  const actualUtcMs = d.getTime();
  return Math.round((tehranAsUtcMs - actualUtcMs) / 60000);
}

// ─── Jalaali conversion ───────────────────────────────────────────────────────
export function toJalaali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  const g_d_no = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = 0, jm = 0, jd = 0;
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) +
    Math.floor((gy2 + 399) / 400) + gd + g_d_no[gm - 1];
  jy = -1595 + (33 * Math.floor(days / 12053));
  days %= 12053;
  jy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) { jy += Math.floor((days - 1) / 365); days = (days - 1) % 365; }
  jm = days < 186 ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
  jd = 1 + (days < 186 ? days % 31 : (days - 186) % 30);
  return { jy, jm, jd };
}

export const JALAALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
export const JALAALI_WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

export function formatJalaaliDate(year: number, month: number, day: number, weekdayIndex: number): string {
  const j = toJalaali(year, month, day);
  return `${JALAALI_WEEKDAYS[weekdayIndex]} ${j.jd} ${JALAALI_MONTHS[j.jm - 1]} ${j.jy}`;
}

export function formatJalaaliShort(year: number, month: number, day: number): string {
  const j = toJalaali(year, month, day);
  return `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`;
}

// ─── Template renderer ────────────────────────────────────────────────────────
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

export function validLocation(loc: string | null | undefined): string {
  if (!loc) return "";
  const t = loc.trim();
  if (t === "0" || t === "") return "";
  return t;
}

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0098")) return digits.slice(2);
  if (digits.startsWith("98") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return "98" + digits.slice(1);
  if (digits.length === 10) return "98" + digits;
  return digits;
}

export const DEFAULT_NOTIF_TITLE = "جلسات {{weekday}} {{date}} ({{count}} جلسه)";
export const DEFAULT_NOTIF_BODY = "برنامه جلسات روز {{weekday}} {{date}}:\n{{meetings_list}}";
export const DEFAULT_SMS_LINE = "{{time}} | {{subject}}{{location_part}}";
export const DEFAULT_SMS_BODY = "جلسات {{weekday}} {{date}}:\n{{meetings_list}}";

export function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// ─── Grace period ───────────────────────────────────────────────────────────
export const SCHEDULE_GRACE_PERIOD_MINUTES = 15;
export const SEND_WINDOW_MINUTES = 5;

export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

// ─── Authorization ───────────────────────────────────────────────────────────
export async function authorize(
  req: Request,
  cronSecretHeader: string | null,
): Promise<"cron" | "admin" | null> {
  // 1. X-Cron-Secret header — preferred for VPS cron / systemd
  const cronSecretEnv = Deno.env.get("DAILY_REPORT_CRON_SECRET") ?? "";
  if (cronSecretHeader && cronSecretEnv && timingSafeCompare(cronSecretHeader, cronSecretEnv)) {
    return "cron";
  }

  // 1b. Also check against vault-stored cron_secret (for pg_cron)
  if (cronSecretHeader) {
    const supabase = adminClient();
    const { data } = await supabase.rpc("verify_cron_secret", { candidate: cronSecretHeader });
    if (data === true) return "cron";
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  // 2. Service role key — trusted as cron caller
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey.length > 0 && timingSafeCompare(token, serviceKey)) return "cron";

  // 3. Legacy CRON_SECRET env var
  const legacyCronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (legacyCronSecret.length > 0 && timingSafeCompare(token, legacyCronSecret)) return "cron";

  // 4. Admin JWT via centralized auth gate
  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return null;
  const callerUserId = authResult.userId!;

  const supabase = adminClient();
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_active")
    .eq("user_id", callerUserId)
    .maybeSingle();
  if (!profile?.is_active || !profile?.is_admin) return null;
  return "admin";
}

// ─── Send window check ────────────────────────────────────────────────────────
export function isWithinSendWindow(
  currentMinutes: number,
  configuredMinutes: number,
  windowMinutes = 5,
): boolean {
  return (
    currentMinutes >= configuredMinutes &&
    currentMinutes < configuredMinutes + windowMinutes
  );
}

export function parseTimeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + (m || 0);
}

// ─── Recipient resolution ────────────────────────────────────────────────────
interface RecipientResolution {
  recipientIds: string[];
  directRecipientCount: number;
  selectedGroupCount: number;
  rawGroupMembersCount: number;
  uniqueGroupMembersCount: number;
  deduplicatedRecipientCount: number;
  duplicateCount: number;
}

export async function resolveDailyReportRecipients(
  supabase: ReturnType<typeof adminClient>,
  config: any,
): Promise<RecipientResolution> {
  const directUserIds = new Set<string>();
  const groupMemberIds = new Set<string>();

  // 1. Direct users
  for (const userId of (config.recipient_user_ids || [])) {
    if (userId && typeof userId === "string") {
      directUserIds.add(userId);
    }
  }

  // 2. Group members
  const groupIds = (config.recipient_group_ids || []).filter(
    (id: string) => id && typeof id === "string",
  );

  let rawGroupMembersCount = 0;

  if (groupIds.length > 0) {
    // Validate that the groups actually exist
    const { data: validGroups, error: groupErr } = await supabase
      .from("user_groups")
      .select("id")
      .in("id", groupIds);

    if (groupErr) {
      throw new Error(`group_validation_query_failed: ${groupErr.message}`);
    }

    const validGroupIds = (validGroups || []).map((g: any) => g.id);
    if (validGroupIds.length === 0) {
      // All group IDs are invalid — no group members to add
    } else {
      const { data: members, error } = await supabase
        .from("user_group_members")
        .select("user_id")
        .in("group_id", validGroupIds);

      if (error) {
        throw new Error(`group_members_query_failed: ${error.message}`);
      }

      for (const m of (members || [])) {
        if (m.user_id && typeof m.user_id === "string") {
          groupMemberIds.add(m.user_id);
          rawGroupMembersCount++;
        }
      }
    }
  }

  // 3. Merge and deduplicate
  const finalRecipientIds = new Set<string>();
  for (const id of directUserIds) finalRecipientIds.add(id);
  for (const id of groupMemberIds) finalRecipientIds.add(id);

  const rawCombinedCount = directUserIds.size + groupMemberIds.size;
  const deduplicatedRecipientCount = finalRecipientIds.size;
  const duplicateCount = rawCombinedCount - deduplicatedRecipientCount;

  return {
    recipientIds: [...finalRecipientIds],
    directRecipientCount: directUserIds.size,
    selectedGroupCount: groupIds.length,
    rawGroupMembersCount,
    uniqueGroupMembersCount: groupMemberIds.size,
    deduplicatedRecipientCount,
    duplicateCount,
  };
}
