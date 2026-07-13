import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Daily report edge function — sends daily management meeting summaries
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Timezone ────────────────────────────────────────────────────────────────
const TEHRAN_TIMEZONE = "Asia/Tehran";

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
function getTehranDateParts(now = new Date()): Record<string, string> {
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
function jsWeekdayToJalaaliIndex(jsWeekday: number): number {
  // JS: Sun=0 Mon=1 Tue=2 Wed=3 Thu=4 Fri=5 Sat=6
  // Jalaali: Sat=0 Sun=1 Mon=2 Tue=3 Wed=4 Thu=5 Fri=6
  return (jsWeekday + 1) % 7;
}

function getTehranNow(now = new Date()): TehranNow {
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
function getTehranOffsetMinutes(d: Date): number {
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
function toJalaali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
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

const JALAALI_MONTHS = ["فروردین", "اردیبهشت", "خرداد", "تیر", "مرداد", "شهریور", "مهر", "آبان", "آذر", "دی", "بهمن", "اسفند"];
const JALAALI_WEEKDAYS = ["شنبه", "یکشنبه", "دوشنبه", "سه‌شنبه", "چهارشنبه", "پنجشنبه", "جمعه"];

function formatJalaaliDate(year: number, month: number, day: number, weekdayIndex: number): string {
  const j = toJalaali(year, month, day);
  return `${JALAALI_WEEKDAYS[weekdayIndex]} ${j.jd} ${JALAALI_MONTHS[j.jm - 1]} ${j.jy}`;
}

function formatJalaaliShort(year: number, month: number, day: number): string {
  const j = toJalaali(year, month, day);
  return `${j.jy}/${String(j.jm).padStart(2, "0")}/${String(j.jd).padStart(2, "0")}`;
}

// ─── Template renderer ────────────────────────────────────────────────────────
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? "");
}

function validLocation(loc: string | null | undefined): string {
  if (!loc) return "";
  const t = loc.trim();
  if (t === "0" || t === "") return "";
  return t;
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0098")) return digits.slice(2);
  if (digits.startsWith("98") && digits.length === 12) return digits;
  if (digits.startsWith("0") && digits.length === 11) return "98" + digits.slice(1);
  if (digits.length === 10) return "98" + digits;
  return digits;
}

const DEFAULT_NOTIF_TITLE = "جلسات {{weekday}} {{date}} ({{count}} جلسه)";
const DEFAULT_NOTIF_BODY = "برنامه جلسات روز {{weekday}} {{date}}:\n{{meetings_list}}";
const DEFAULT_SMS_LINE = "{{time}} | {{subject}}{{location_part}}";
const DEFAULT_SMS_BODY = "جلسات {{weekday}} {{date}}:\n{{meetings_list}}";

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// ─── Grace period ───────────────────────────────────────────────────────────
const SCHEDULE_GRACE_PERIOD_MINUTES = 15;
const SEND_WINDOW_MINUTES = 5;

function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

// ─── Authorization ───────────────────────────────────────────────────────────
async function authorize(
  authHeader: string | null,
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

  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  // 2. Service role key — trusted as cron caller
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey.length > 0 && timingSafeCompare(token, serviceKey)) return "cron";

  // 3. Anon key — trusted as cron caller (for pg_cron via pg_net)
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (anonKey.length > 0 && timingSafeCompare(token, anonKey)) return "cron";

  // 4. Legacy CRON_SECRET env var
  const legacyCronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (legacyCronSecret.length > 0 && timingSafeCompare(token, legacyCronSecret)) return "cron";

  // 5. Admin JWT check
  const supabase = adminClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin, is_active")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!profile?.is_active || !profile?.is_admin) return null;
  return "admin";
}

// ─── Send window check ────────────────────────────────────────────────────────
function isWithinSendWindow(
  currentMinutes: number,
  configuredMinutes: number,
  windowMinutes = 5,
): boolean {
  return (
    currentMinutes >= configuredMinutes &&
    currentMinutes < configuredMinutes + windowMinutes
  );
}

function parseTimeToMinutes(timeStr: string): number {
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

async function resolveDailyReportRecipients(
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

// ─── Main handler ────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // ── Auth ──
  // X-Cron-Secret header for VPS cron / systemd; Authorization Bearer for admin UI
  const cronSecretHeader = req.headers.get("x-cron-secret") || req.headers.get("X-Cron-Secret");
  const callerType = await authorize(req.headers.get("Authorization"), cronSecretHeader);

  if (!callerType) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const supabase = adminClient();

    let force = false;
    let scheduled = false;
    let dryRun = false;
    try {
      const body = await req.json().catch(() => ({}));
      force = !!body?.force;
      dryRun = !!body?.dry_run;
      scheduled = callerType === "cron" && !!body?.scheduled;
    } catch { /* ignore */ }

    // ── Load config ──
    const { data: config, error: cfgErr } = await supabase
      .from("daily_report_config")
      .select("*")
      .maybeSingle();

    if (cfgErr || !config) return json({ ok: false, reason: "no_config" });
    if (!config.is_enabled && !force) return json({ ok: false, reason: "disabled" });

    // ── Tehran time ──
    const tehranNow = getTehranNow();
    const tehranDateParts = getTehranDateParts();
    const tehranYear = parseInt(tehranDateParts.year);
    const tehranMonth = parseInt(tehranDateParts.month);
    const tehranDay = parseInt(tehranDateParts.day);

    // ── Scheduled check with grace period ──
    const currentMinutes = parseTimeToMinutes(tehranNow.time);
    const configuredMinutes = parseTimeToMinutes(config.send_time || "07:00");
    const withinSendWindow = isWithinSendWindow(currentMinutes, configuredMinutes, SEND_WINDOW_MINUTES);
    const withinGracePeriod =
      currentMinutes >= configuredMinutes &&
      currentMinutes < configuredMinutes + SCHEDULE_GRACE_PERIOD_MINUTES;
    const pastGracePeriod = currentMinutes >= configuredMinutes + SCHEDULE_GRACE_PERIOD_MINUTES;

    if (scheduled && !force) {
      const allowedDays: number[] = config.send_days ?? [0, 1, 2, 3, 4, 5, 6];
      if (!allowedDays.includes(tehranNow.weekdayIndex)) {
        return json({
          ok: false,
          trigger_type: "scheduled",
          timezone: TEHRAN_TIMEZONE,
          tehran_date: tehranNow.date,
          tehran_time: tehranNow.time,
          configured_time: config.send_time,
          within_send_window: withinSendWindow,
          within_grace_period: withinGracePeriod,
          already_processed: false,
          reason: "skipped_day",
          tehran_weekday: tehranNow.weekdayIndex,
        });
      }

      if (!withinGracePeriod) {
        if (pastGracePeriod) {
          // Beyond grace period — mark as missed, do not send
          if (!dryRun) {
            try {
              await supabase.from("daily_report_runs").insert({
                config_id: config.id,
                report_date: tehranNow.date,
                timezone: TEHRAN_TIMEZONE,
                scheduled_time: config.send_time,
                started_at: new Date().toISOString(),
                completed_at: new Date().toISOString(),
                status: "missed",
                trigger_type: "scheduled",
                run_key: `${config.id}:${tehranNow.date}:scheduled`,
                error_text: `past_grace_period: ${tehranNow.time} > ${config.send_time}+${SCHEDULE_GRACE_PERIOD_MINUTES}min`,
              });
            } catch { /* non-fatal */ }
          }
          return json({
            ok: false,
            trigger_type: "scheduled",
            timezone: TEHRAN_TIMEZONE,
            tehran_date: tehranNow.date,
            tehran_time: tehranNow.time,
            configured_time: config.send_time,
            within_send_window: withinSendWindow,
            within_grace_period: false,
            already_processed: false,
            reason: "missed",
          });
        }
        // Before send_time — not time yet
        return json({
          ok: false,
          trigger_type: "scheduled",
          timezone: TEHRAN_TIMEZONE,
          tehran_date: tehranNow.date,
          tehran_time: tehranNow.time,
          configured_time: config.send_time,
          within_send_window: false,
          within_grace_period: false,
          already_processed: false,
          reason: "skipped_not_time",
        });
      }
    }

    // ── Idempotency: check daily_report_runs ──
    const reportDate = tehranNow.date;
    const triggerType = force ? "manual" : "scheduled";
    const runKey = force
      ? `${config.id}:${reportDate}:manual:${crypto.randomUUID()}`
      : `${config.id}:${reportDate}:scheduled`;

    if (!dryRun) {
      // For scheduled: check if a scheduled run already exists for today
      if (!force) {
        const { data: existingScheduled } = await supabase
          .from("daily_report_runs")
          .select("id, status")
          .eq("config_id", config.id)
          .eq("report_date", reportDate)
          .eq("trigger_type", "scheduled")
          .maybeSingle();

        if (existingScheduled && (existingScheduled.status === "completed" || existingScheduled.status === "running")) {
          return json({
            ok: false,
            trigger_type: "scheduled",
            timezone: TEHRAN_TIMEZONE,
            tehran_date: tehranNow.date,
            tehran_time: tehranNow.time,
            configured_time: config.send_time,
            within_send_window: withinSendWindow,
            within_grace_period: withinGracePeriod,
            already_processed: true,
            reason: "already_processed",
            status: existingScheduled.status,
          });
        }
      }

      // Insert run record with unique run_key (atomic — concurrent requests get unique constraint violation)
      const { error: insertErr } = await supabase.from("daily_report_runs").insert({
        config_id: config.id,
        report_date: reportDate,
        timezone: TEHRAN_TIMEZONE,
        scheduled_time: config.send_time,
        started_at: new Date().toISOString(),
        status: "running",
        trigger_type: triggerType,
        run_key: runKey,
      });

      if (insertErr) {
        // run_key collision — another concurrent run with same key exists
        return json({
          ok: false,
          trigger_type: triggerType,
          timezone: TEHRAN_TIMEZONE,
          tehran_date: tehranNow.date,
          tehran_time: tehranNow.time,
          configured_time: config.send_time,
          within_send_window: withinSendWindow,
          within_grace_period: withinGracePeriod,
          already_processed: true,
          reason: "already_processed",
          error: insertErr.message,
        });
      }
    }

    // ── Resolve recipients ──
    const resolved = await resolveDailyReportRecipients(supabase, config);
    const recipientIds = resolved.recipientIds;

    if (recipientIds.length === 0) {
      // Update run record
      if (!dryRun) {
        await supabase.from("daily_report_runs")
          .update({ status: "skipped_no_recipients", completed_at: new Date().toISOString(), error_text: "no_recipients" })
          .eq("run_key", runKey);
      }
      return json({
        ok: false,
        trigger_type: triggerType,
        timezone: TEHRAN_TIMEZONE,
        tehran_date: tehranNow.date,
        tehran_time: tehranNow.time,
        configured_time: config.send_time,
        within_send_window: withinSendWindow,
        within_grace_period: withinGracePeriod,
        already_processed: false,
        reason: "skipped_no_recipients",
        recipient_count: 0,
        meeting_count: meetingCount,
      });
    }

    // ── Fetch per-recipient calendar meetings ──
    // Uses the SAME visibility logic as CalendarPage.tsx:
    //   Creator      → always visible
    //   Participant  → visible unless meeting_inbox status is 'pending' or 'declined'
    //   Observer     → visible unless meeting_inbox status is 'pending' or 'declined'
    // This is the single source of truth for "what meetings show in a user's calendar".
    // The shared service lives at src/lib/getUserCalendarMeetings.ts.
    // This edge function inlines the same logic because Deno can't import from src/.

    const EXCLUDED_INBOX_STATUSES = new Set(["pending", "declined"]);

    // Batch fetch: 1 meetings query + 1 meeting_inbox query for all recipients
    const { data: allMeetings, error: meetingsErr } = await supabase
      .from("meetings")
      .select("id,subject,request_date,start_time,end_time,duration,location,representative,phone,notes,priority,status,status_type,created_at,user_id,calendar_id,external_participants,participant_user_ids,notify_users,members_only,meeting_manager,is_online")
      .neq("status", "closed")
      .gte("request_date", tehranNow.startOfDayUtc)
      .lte("request_date", tehranNow.endOfDayUtc)
      .order("start_time", { ascending: true, nullsFirst: false });

    if (meetingsErr) {
      if (!dryRun) {
        await supabase.from("daily_report_runs")
          .update({ status: "failed", completed_at: new Date().toISOString(), error_text: meetingsErr.message })
          .eq("run_key", runKey);
      }
      return json({
        ok: false,
        trigger_type: triggerType,
        timezone: TEHRAN_TIMEZONE,
        tehran_date: tehranNow.date,
        tehran_time: tehranNow.time,
        reason: "meetings_query_error",
        error: meetingsErr.message,
      });
    }

    // Fetch meeting_inbox for all recipients
    const { data: allInbox, error: inboxErr } = await supabase
      .from("meeting_inbox")
      .select("meeting_id,user_id,status")
      .in("user_id", recipientIds);

    if (inboxErr) {
      if (!dryRun) {
        await supabase.from("daily_report_runs")
          .update({ status: "failed", completed_at: new Date().toISOString(), error_text: inboxErr.message })
          .eq("run_key", runKey);
      }
      return json({
        ok: false,
        trigger_type: triggerType,
        timezone: TEHRAN_TIMEZONE,
        tehran_date: tehranNow.date,
        tehran_time: tehranNow.time,
        reason: "inbox_query_error",
        error: inboxErr.message,
      });
    }

    // Build inbox status map: Map<userId, Map<meetingId, status>>
    const inboxByUser = new Map<string, Map<string, string>>();
    for (const r of allInbox || []) {
      let userMap = inboxByUser.get(r.user_id);
      if (!userMap) { userMap = new Map(); inboxByUser.set(r.user_id, userMap); }
      userMap.set(r.meeting_id, r.status);
    }

    // Group meetings per recipient using the calendar visibility logic
    const recipientMeetingMap = new Map<string, any[]>();
    for (const uid of recipientIds) {
      recipientMeetingMap.set(uid, []);
    }

    for (const m of allMeetings || []) {
      for (const uid of recipientIds) {
        // Creator → always visible
        if (m.user_id === uid) {
          recipientMeetingMap.get(uid)!.push(m);
          continue;
        }
        // Only include meetings the user is related to (participant or observer)
        const isParticipant = (m.participant_user_ids || []).includes(uid);
        const isObserver = (m.notify_users || []).includes(uid);
        if (!isParticipant && !isObserver) continue;
        // Participant/Observer → visible unless inbox says pending/declined
        const userInbox = inboxByUser.get(uid);
        const inboxS = userInbox?.get(m.id);
        if (!EXCLUDED_INBOX_STATUSES.has(inboxS || "")) {
          recipientMeetingMap.get(uid)!.push(m);
        }
      }
    }

    // ── Resolve participant names for all meetings ──
    const allUserIds = new Set<string>();
    for (const [, meetings] of recipientMeetingMap) {
      for (const m of meetings) {
        (m.participant_user_ids || []).forEach((id: string) => allUserIds.add(id));
        (m.notify_users || []).forEach((id: string) => allUserIds.add(id));
        if (m.representative) allUserIds.add(m.representative);
      }
    }

    const profileMap: Record<string, string> = {};
    if (allUserIds.size > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", [...allUserIds]);
      (profiles || []).forEach((p: any) => { profileMap[p.user_id] = p.full_name || ""; });
    }

    // ── Build per-recipient reports ──
    interface MeetingRow {
      time: string;
      subject: string;
      location: string;
      participants: string;
    }

    interface RecipientReport {
      user_id: string;
      meetings: any[];
      rows: MeetingRow[];
      meeting_count: number;
      meeting_ids: string[];
      skipped: boolean;
      skip_reason: string | null;
    }

    function buildMeetingRows(meetings: any[]): MeetingRow[] {
      return meetings.map((m: any) => {
        let time = "";
        if (m.start_time) time = m.end_time ? `${m.start_time} تا ${m.end_time}` : m.start_time;
        else if (m.duration) time = m.duration;

        const loc = validLocation(m.location);
        const partIds: string[] = [
          ...(m.participant_user_ids || []),
          ...(m.notify_users || []),
        ];
        const partNames = [...new Set(partIds.map((id: string) => profileMap[id]).filter(Boolean))];
        const participants = partNames.slice(0, 4).join("، ") +
          (partNames.length > 4 ? ` و ${partNames.length - 4} نفر دیگر` : "");

        return { time, subject: m.subject || "—", location: loc, participants };
      });
    }

    const sendEmptyReport = config.send_empty_report !== false; // default true
    const recipientReports: RecipientReport[] = [];

    for (const uid of recipientIds) {
      const userMeetings = recipientMeetingMap.get(uid) || [];
      const userRows = buildMeetingRows(userMeetings);
      const meetingIds = userMeetings.map((m: any) => m.id);
      const hasNoMeetings = userMeetings.length === 0;
      const skipped = hasNoMeetings && !sendEmptyReport;

      recipientReports.push({
        user_id: uid,
        meetings: userMeetings,
        rows: userRows,
        meeting_count: userMeetings.length,
        meeting_ids: meetingIds,
        skipped,
        skip_reason: skipped ? "no_calendar_meetings_and_empty_report_disabled" : null,
      });
    }

    const totalMeetings = recipientReports.reduce((sum, r) => sum + r.meeting_count, 0);
    const skippedRecipients = recipientReports.filter(r => r.skipped).length;
    const sentRecipients = recipientReports.length - skippedRecipients;

    // ── Jalaali date strings ──
    const jalaaliLong = formatJalaaliDate(tehranYear, tehranMonth, tehranDay, tehranNow.weekdayIndex);
    const jalaaliShort = formatJalaaliShort(tehranYear, tehranMonth, tehranDay);
    const weekday = JALAALI_WEEKDAYS[tehranNow.weekdayIndex];

    // ── Diagnostic logging (no sensitive data) ──
    console.info("[daily-report]", {
      trigger: triggerType,
      timezone: TEHRAN_TIMEZONE,
      tehranDate: tehranNow.date,
      tehranTime: tehranNow.time,
      configuredTime: config.send_time,
      configuredDays: config.send_days,
      tehranWeekdayIndex: tehranNow.weekdayIndex,
      directRecipientCount: resolved.directRecipientCount,
      selectedGroupCount: resolved.selectedGroupCount,
      rawGroupMembersCount: resolved.rawGroupMembersCount,
      uniqueGroupMembersCount: resolved.uniqueGroupMembersCount,
      deduplicatedRecipientCount: resolved.deduplicatedRecipientCount,
      duplicateCount: resolved.duplicateCount,
      totalMeetings,
      skippedRecipients,
      sentRecipients,
      dryRun,
      recipientReports: recipientReports.map(r => ({
        user_id: r.user_id,
        calendar_meeting_count: r.meeting_count,
        meeting_ids: r.meeting_ids,
        skipped: r.skipped,
      })),
    });

    // ── Dry run: return without sending ──
    if (dryRun) {
      const { data: recipientProfiles } = await supabase
        .from("profiles")
        .select("user_id, phone")
        .in("user_id", recipientIds);
      const phoneCount = (recipientProfiles || []).filter((p: any) => p.phone).length;
      const noPhoneCount = recipientIds.length - phoneCount;

      const { data: baleMappings } = await supabase
        .from("user_bale_mapping")
        .select("user_id, bale_chat_id")
        .in("user_id", recipientIds);
      const baleCount = (baleMappings || []).filter((m: any) => m.bale_chat_id).length;

      return json({
        ok: true,
        dry_run: true,
        trigger_type: triggerType,
        timezone: TEHRAN_TIMEZONE,
        tehran_date: tehranNow.date,
        tehran_time: tehranNow.time,
        tehran_weekday: tehranNow.weekdayIndex,
        tehran_weekday_label: weekday,
        jalali_date: jalaaliShort,
        jalali_date_long: jalaaliLong,
        configured_time: config.send_time,
        configured_days: config.send_days,
        within_send_window: withinSendWindow,
        within_grace_period: withinGracePeriod,
        already_processed: false,
        selected_user_count: resolved.directRecipientCount,
        selected_group_count: resolved.selectedGroupCount,
        raw_group_members_count: resolved.rawGroupMembersCount,
        unique_group_members_count: resolved.uniqueGroupMembersCount,
        deduplicated_recipient_count: resolved.deduplicatedRecipientCount,
        duplicate_count: resolved.duplicateCount,
        send_empty_report: sendEmptyReport,
        recipients: recipientIds,
        recipient_reports: recipientReports.map(r => ({
          user_id: r.user_id,
          calendar_meeting_count: r.meeting_count,
          meeting_ids: r.meeting_ids,
          skipped: r.skipped,
          skip_reason: r.skip_reason,
        })),
        total_meetings: totalMeetings,
        skipped_recipients: skippedRecipients,
        sent_recipients: sentRecipients,
        notification_targets: config.send_via_notification ? sentRecipients : 0,
        sms_targets: config.send_via_sms ? phoneCount : 0,
        sms_skipped_no_phone: config.send_via_sms ? noPhoneCount : 0,
        bale_targets: config.send_via_bale ? baleCount : 0,
      });
    }

    // ── Per-recipient notification sending ──
    let notifSent = 0;
    if (config.send_via_notification) {
      const titleTpl = config.notification_title_tpl || DEFAULT_NOTIF_TITLE;
      const bodyTpl = config.notification_body_tpl || DEFAULT_NOTIF_BODY;

      const notifRows: any[] = [];
      for (const report of recipientReports) {
        if (report.skipped) continue;

        const userVars = {
          date: jalaaliShort,
          date_long: jalaaliLong,
          weekday,
          count: String(report.meeting_count),
        };

        const notifTitle = renderTemplate(titleTpl, userVars);

        let meetingsList = "";
        if (report.meeting_count === 0) {
          meetingsList = "برای امروز جلسه‌ای در تقویم شما ثبت نشده است.";
        } else {
          meetingsList = report.rows.map((r: MeetingRow) => {
            const parts = [r.time, r.subject];
            if (r.location) parts.push(r.location);
            return `- ${parts.join(" | ")}`;
          }).join("\n");
        }

        const notifMessage = renderTemplate(bodyTpl, { ...userVars, meetings_list: meetingsList });

        notifRows.push({
          user_id: report.user_id,
          title: notifTitle,
          message: notifMessage,
          type: "info",
          read: false,
          created_at: new Date().toISOString(),
        });
      }

      if (notifRows.length > 0) {
        const { error: notifErr } = await supabase.from("notifications").insert(notifRows);
        if (!notifErr) notifSent = notifRows.length;
      }
    }

    // ── Fetch recipient phones for SMS ──
    const { data: recipientProfiles } = await supabase
      .from("profiles")
      .select("user_id, phone")
      .in("user_id", recipientIds);

    const phoneMap: Record<string, string> = {};
    (recipientProfiles || []).forEach((p: any) => { if (p.phone) phoneMap[p.user_id] = p.phone; });

    // ── Per-recipient SMS ──
    let smsSent = 0;
    let smsSkippedNoPhone = 0;
    let smsError: string | null = null;
    if (config.send_via_sms) {
      const smsLineTpl = config.sms_tpl || DEFAULT_SMS_LINE;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

      const { data: providers } = await supabase
        .from("sms_providers")
        .select("id, title, provider_name")
        .eq("is_active", true)
        .eq("is_default", true)
        .limit(1);
      const provider = providers?.[0];

      for (const report of recipientReports) {
        if (report.skipped) continue;

        const phone = phoneMap[report.user_id];
        if (!phone) { smsSkippedNoPhone++; continue; }

        const userVars = {
          date: jalaaliShort,
          date_long: jalaaliLong,
          weekday,
          count: String(report.meeting_count),
        };

        let smsMeetingLines = "";
        if (report.meeting_count === 0) {
          smsMeetingLines = "برای امروز جلسه‌ای در تقویم شما ثبت نشده است.";
        } else {
          smsMeetingLines = report.rows.map((r: MeetingRow) => {
            const locPart = r.location ? ` | ${r.location}` : "";
            return renderTemplate(smsLineTpl, {
              ...userVars,
              time: r.time,
              subject: r.subject,
              location: r.location,
              location_part: locPart,
              participants: r.participants,
            });
          }).join("\n");
        }

        const smsBody = renderTemplate(DEFAULT_SMS_BODY, { ...userVars, meetings_list: smsMeetingLines });
        const mobile = normalizePhone(phone);

        try {
          const smsResp = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ mobiles: [mobile], message: smsBody }),
          });

          const smsData = await smsResp.json().catch(() => ({}));

          if (smsData?.ok) {
            smsSent++;
            const returnIds: string[] = Array.isArray(smsData.returnIds) ? smsData.returnIds : [];
            const providerMessageId = returnIds[0] ?? null;
            await supabase.from("sms_dispatch_logs").insert({
              target_phone: phone,
              category: "daily_report",
              event_type: "daily_meetings",
              message: smsBody,
              provider_id: provider?.id ?? null,
              provider_name: provider?.title || provider?.provider_name || null,
              status: "sent",
              pack_id: smsData.packId ? String(smsData.packId) : null,
              cost: smsData.cost ?? null,
              raw_response: smsData,
              provider_message_id: providerMessageId,
              delivery_status: providerMessageId ? "pending" : null,
            });
          } else {
            smsError = smsData?.error || "ارسال ناموفق";
            await supabase.from("sms_dispatch_logs").insert({
              target_phone: phone,
              category: "daily_report",
              event_type: "daily_meetings",
              message: smsBody,
              provider_id: provider?.id ?? null,
              provider_name: provider?.title || provider?.provider_name || null,
              status: "failed",
              error_text: smsError,
              raw_response: smsData,
            });
          }
        } catch (e: any) {
          smsError = e.message;
        }
      }
    }

    // ── Per-recipient Bale ──
    let baleSent = 0;
    let baleError: string | null = null;
    if (config.send_via_bale) {
      const { data: baleCfg } = await supabase
        .from("social_channel_configs")
        .select("bot_token, is_active")
        .eq("channel", "bale")
        .maybeSingle();

      if (!baleCfg?.is_active) {
        baleError = "ربات بله غیرفعال است";
      } else {
        const botToken = (baleCfg?.bot_token ?? "").trim();
        if (!botToken) {
          baleError = "توکن ربات بله تنظیم نشده";
        } else {
          const titleTpl = config.notification_title_tpl || DEFAULT_NOTIF_TITLE;
          const bodyTpl = config.notification_body_tpl || DEFAULT_NOTIF_BODY;

          const { data: mappings } = await supabase
            .from("user_bale_mapping")
            .select("user_id, bale_chat_id")
            .in("user_id", recipientIds);

          const chatMap: Record<string, string> = {};
          (mappings || []).forEach((m: any) => { if (m.bale_chat_id) chatMap[m.user_id] = m.bale_chat_id; });

          for (const report of recipientReports) {
            if (report.skipped) continue;

            const chatId = chatMap[report.user_id];
            if (!chatId) continue;

            const userVars = {
              date: jalaaliShort,
              date_long: jalaaliLong,
              weekday,
              count: String(report.meeting_count),
            };

            const notifTitle = renderTemplate(titleTpl, userVars);

            let meetingsList = "";
            if (report.meeting_count === 0) {
              meetingsList = "برای امروز جلسه‌ای در تقویم شما ثبت نشده است.";
            } else {
              meetingsList = report.rows.map((r: MeetingRow) => {
                const parts = [r.time, r.subject];
                if (r.location) parts.push(r.location);
                return `- ${parts.join(" | ")}`;
              }).join("\n");
            }

            const baleMessage = `${notifTitle}\n\n${renderTemplate(bodyTpl, { ...userVars, meetings_list: meetingsList })}`;

            try {
              const res = await fetch(`https://tapi.bale.ai/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: baleMessage }),
              });
              if (res.ok) baleSent++;
              else {
                const errBody = await res.text().catch(() => "");
                console.warn("[daily-meetings] Bale send failed for %s: HTTP %s %s", report.user_id, res.status, errBody.slice(0, 100));
              }
            } catch (e: any) {
              console.warn("[daily-meetings] Bale network error for %s: %s", report.user_id, e?.message);
            }
          }
        }
      }
    }

    // ── Update run record ──
    await supabase.from("daily_report_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        recipient_count: sentRecipients,
        meeting_count: totalMeetings,
      })
      .eq("run_key", runKey);

    // ── Update last_sent_date ──
    await supabase.from("daily_report_config")
      .update({ last_sent_date: reportDate, updated_at: new Date().toISOString() })
      .eq("id", config.id);

    return json({
      ok: true,
      trigger_type: triggerType,
      timezone: TEHRAN_TIMEZONE,
      tehran_date: tehranNow.date,
      tehran_time: tehranNow.time,
      configured_time: config.send_time,
      within_send_window: withinSendWindow,
      within_grace_period: withinGracePeriod,
      already_processed: false,
      send_empty_report: sendEmptyReport,
      recipient_count: sentRecipients,
      total_recipients: recipientIds.length,
      skipped_recipients: skippedRecipients,
      sent_recipients: sentRecipients,
      total_meetings: totalMeetings,
      notifications_sent: notifSent,
      sms_sent: smsSent,
      sms_skipped_no_phone: smsSkippedNoPhone,
      sms_error: smsError,
      bale_sent: baleSent,
      bale_error: baleError,
      jalali_date: jalaaliShort,
      jalali_date_long: jalaaliLong,
      tehran_weekday: tehranNow.weekdayIndex,
      recipient_reports: recipientReports.map(r => ({
        user_id: r.user_id,
        calendar_meeting_count: r.meeting_count,
        meeting_ids: r.meeting_ids,
        skipped: r.skipped,
        skip_reason: r.skip_reason,
      })),
    });
  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
