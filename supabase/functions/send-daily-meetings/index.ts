import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

// ─── Jalaali conversion ───────────────────────────────────────────────────────
function toJalaali(gy: number, gm: number, gd: number): { jy: number; jm: number; jd: number } {
  const g_d_no = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  let jy = 0, jm = 0, jd = 0;
  let gy2 = gm > 2 ? gy + 1 : gy;
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

const JALAALI_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const JALAALI_WEEKDAYS = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنجشنبه','جمعه'];

function formatJalaaliDate(d: Date): string {
  const j = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  const weekday = JALAALI_WEEKDAYS[(d.getUTCDay() + 1) % 7];
  return `${weekday} ${j.jd} ${JALAALI_MONTHS[j.jm - 1]} ${j.jy}`;
}

function formatJalaaliShort(d: Date): string {
  const j = toJalaali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  return `${j.jd}/${j.jm}/${j.jy}`;
}

// ─── Template renderer ────────────────────────────────────────────────────────
function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? '');
}

function validLocation(loc: string | null | undefined): string {
  if (!loc) return '';
  const t = loc.trim();
  if (t === '0' || t === '') return '';
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

const DEFAULT_NOTIF_TITLE = 'جلسات {{weekday}} {{date}} ({{count}} جلسه)';
const DEFAULT_NOTIF_BODY = 'برنامه جلسات روز {{weekday}} {{date}}:\n{{meetings_list}}';
const DEFAULT_SMS_LINE = '{{time}} | {{subject}}{{location_part}}';
const DEFAULT_SMS_BODY = 'جلسات {{weekday}} {{date}}:\n{{meetings_list}}';

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/**
 * Authorises the caller. Accepts two mechanisms:
 *  1. Scheduled cron job: `Authorization: Bearer <CRON_SECRET>` where the
 *     secret is stored in the CRON_SECRET edge-function secret.
 *  2. Manual admin invocation: a valid Supabase user JWT whose profile has
 *     is_admin = true.
 *
 * Returns the caller type, or null if the request is unauthorised.
 */
async function authorize(
  authHeader: string | null,
): Promise<"cron" | "admin" | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);

  // 1. Cron-secret check (constant-time comparison via crypto)
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  if (cronSecret.length > 0) {
    const enc = new TextEncoder();
    const a = enc.encode(token);
    const b = enc.encode(cronSecret);
    if (a.length === b.length) {
      // Constant-time compare to prevent timing attacks
      let diff = 0;
      for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
      if (diff === 0) return "cron";
    }
  }

  // 2. Admin JWT check
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  // ── Authentication & authorisation ──────────────────────────────────────────
  const callerType = await authorize(req.headers.get("Authorization"));
  if (!callerType) return json({ ok: false, error: "Unauthorized" }, 401);

  try {
    const supabase = adminClient();

    let force = false;
    let scheduled = false;
    try {
      const body = await req.json().catch(() => ({}));
      force = !!body?.force;
      // Only a cron caller is allowed to set scheduled=true
      scheduled = callerType === "cron" && !!body?.scheduled;
    } catch { /* ignore */ }

    // Audit log the invocation
    try {
      await supabase.from("audit_logs").insert({
        action: "send_daily_meetings_triggered",
        details: { caller_type: callerType, force, scheduled },
      });
    } catch { /* non-critical */ }

    // Load daily report config
    const { data: config, error: cfgErr } = await supabase
      .from("daily_report_config")
      .select("*")
      .maybeSingle();

    if (cfgErr || !config) return json({ ok: false, reason: "no_config" });
    if (!config.is_enabled && !force) return json({ ok: false, reason: "disabled" });

    // IST date/time (UTC+3:30 = 210 minutes)
    const IST_OFFSET_MINUTES = 210;
    const now = new Date();
    const istNow = new Date(now.getTime() + IST_OFFSET_MINUTES * 60 * 1000);
    const istYear = istNow.getUTCFullYear();
    const istMonth = istNow.getUTCMonth();
    const istDate = istNow.getUTCDate();

    const todayStart = new Date(Date.UTC(istYear, istMonth, istDate, 0, 0, 0) - IST_OFFSET_MINUTES * 60 * 1000);
    const todayEnd = new Date(Date.UTC(istYear, istMonth, istDate, 23, 59, 59) - IST_OFFSET_MINUTES * 60 * 1000);
    const istDayForDisplay = new Date(Date.UTC(istYear, istMonth, istDate));

    // For scheduled calls, check current minute matches send_time and day is allowed
    if (scheduled && !force) {
      const istTimeStr = `${String(istNow.getUTCHours()).padStart(2, "0")}:${String(istNow.getUTCMinutes()).padStart(2, "0")}`;
      if (istTimeStr !== config.send_time) {
        return json({ ok: false, reason: "not_time_yet", time: istTimeStr, expected: config.send_time });
      }
      const istDayIndex = (istNow.getUTCDay() + 1) % 7;
      const allowedDays: number[] = config.send_days ?? [0, 1, 2, 3, 4, 5, 6];
      if (!allowedDays.includes(istDayIndex)) {
        return json({ ok: false, reason: "day_not_scheduled", day: istDayIndex });
      }
    }

    // Jalaali date strings
    const jalaaliLong = formatJalaaliDate(istDayForDisplay);
    const jalaaliShort = formatJalaaliShort(istDayForDisplay);
    const weekday = jalaaliLong.split(' ')[0];

    // Fetch today's scheduled meetings
    const { data: meetings, error: meetingsErr } = await supabase
      .from("meetings")
      .select("id, subject, start_time, end_time, location, representative, duration, request_date, participant_user_ids, notify_users")
      .in("status_type", ["approved", "scheduled"])
      .neq("status", "cancelled")
      .gte("request_date", todayStart.toISOString())
      .lte("request_date", todayEnd.toISOString())
      .order("start_time", { ascending: true, nullsFirst: false });

    if (meetingsErr) {
      return json({ ok: false, reason: "meetings_query_error", error: meetingsErr.message });
    }

    const meetingList = meetings || [];

    // Collect all participant user IDs to resolve names
    const allUserIds = new Set<string>();
    for (const m of meetingList) {
      (m.participant_user_ids || []).forEach((id: string) => allUserIds.add(id));
      (m.notify_users || []).forEach((id: string) => allUserIds.add(id));
      if (m.representative) allUserIds.add(m.representative);
    }

    const profileMap: Record<string, string> = {};
    if (allUserIds.size > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", [...allUserIds]);
      (profiles || []).forEach((p: any) => { profileMap[p.user_id] = p.full_name || ''; });
    }

    // Collect recipient user IDs
    let recipientIds: string[] = [...(config.recipient_user_ids || [])];
    if (config.recipient_group_ids && config.recipient_group_ids.length > 0) {
      const { data: members } = await supabase
        .from("user_group_members")
        .select("user_id")
        .in("group_id", config.recipient_group_ids);
      recipientIds = [...new Set([...recipientIds, ...(members || []).map((m: any) => m.user_id)])];
    }

    if (recipientIds.length === 0) return json({ ok: false, reason: "no_recipients" });

    // Fetch recipient phone numbers for SMS
    const { data: recipientProfiles } = await supabase
      .from("profiles")
      .select("user_id, phone")
      .in("user_id", recipientIds);

    const phoneMap: Record<string, string> = {};
    (recipientProfiles || []).forEach((p: any) => { if (p.phone) phoneMap[p.user_id] = p.phone; });

    // ── Build meeting rows ────────────────────────────────────────────────────
    const meetingCount = meetingList.length;

    interface MeetingRow {
      time: string;
      subject: string;
      location: string;
      participants: string;
    }

    const rows: MeetingRow[] = meetingList.map((m: any) => {
      let time = "";
      if (m.start_time) time = m.end_time ? `${m.start_time} تا ${m.end_time}` : m.start_time;
      else if (m.duration) time = m.duration;

      const loc = validLocation(m.location);
      const partIds: string[] = [
        ...(m.participant_user_ids || []),
        ...(m.notify_users || []),
      ];
      const partNames = [...new Set(partIds.map((id: string) => profileMap[id]).filter(Boolean))];
      const participants = partNames.slice(0, 4).join('، ') + (partNames.length > 4 ? ` و ${partNames.length - 4} نفر دیگر` : '');

      return { time, subject: m.subject || '—', location: loc, participants };
    });

    const globalVars = {
      date: jalaaliShort,
      date_long: jalaaliLong,
      weekday,
      count: String(meetingCount),
    };

    // ── In-app notification ───────────────────────────────────────────────────
    let notifSent = 0;
    if (config.send_via_notification) {
      const titleTpl = config.notification_title_tpl || DEFAULT_NOTIF_TITLE;
      const bodyTpl = config.notification_body_tpl || DEFAULT_NOTIF_BODY;

      const notifTitle = renderTemplate(titleTpl, globalVars);

      let meetingsListForNotif = "";
      if (meetingCount === 0) {
        meetingsListForNotif = "امروز هیچ جلسه‌ای برنامه‌ریزی نشده است.";
      } else {
        meetingsListForNotif = rows.map(r => {
          const parts = [r.time, r.subject];
          if (r.location) parts.push(r.location);
          return `- ${parts.join(' | ')}`;
        }).join('\n');
      }

      const notifMessage = renderTemplate(bodyTpl, { ...globalVars, meetings_list: meetingsListForNotif });

      const notifRows = recipientIds.map((uid: string) => ({
        user_id: uid,
        title: notifTitle,
        message: notifMessage,
        type: "info",
        read: false,
        created_at: new Date().toISOString(),
      }));

      const { error: notifErr } = await supabase.from("notifications").insert(notifRows);
      if (!notifErr) notifSent = recipientIds.length;
    }

    // ── SMS ───────────────────────────────────────────────────────────────────
    let smsSent = 0;
    let smsError: string | null = null;
    if (config.send_via_sms) {
      const smsLineTpl = config.sms_tpl || DEFAULT_SMS_LINE;

      let smsMeetingLines = "";
      if (meetingCount === 0) {
        smsMeetingLines = "امروز جلسه‌ای برنامه‌ریزی نشده است.";
      } else {
        smsMeetingLines = rows.map(r => {
          const locPart = r.location ? ` | ${r.location}` : "";
          return renderTemplate(smsLineTpl, {
            ...globalVars,
            time: r.time,
            subject: r.subject,
            location: r.location,
            location_part: locPart,
            participants: r.participants,
          });
        }).join("\n");
      }

      const smsBody = renderTemplate(DEFAULT_SMS_BODY, { ...globalVars, meetings_list: smsMeetingLines });

      const rawMobiles = recipientIds.map((uid: string) => phoneMap[uid]).filter(Boolean);
      const mobiles = rawMobiles.map(normalizePhone);

      if (mobiles.length > 0) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

        try {
          const smsResp = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceKey}`,
            },
            body: JSON.stringify({ mobiles, message: smsBody }),
          });

          const smsData = await smsResp.json().catch(() => ({}));

          // Fetch provider info for logging
          const { data: providers } = await supabase
            .from("sms_providers")
            .select("id, title, provider_name")
            .eq("is_active", true)
            .eq("is_default", true)
            .limit(1);
          const provider = providers?.[0];

          if (smsData?.ok) {
            smsSent = mobiles.length;
            await supabase.from("sms_dispatch_logs").insert(
              rawMobiles.map((phone: string) => ({
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
              }))
            );
          } else {
            smsError = smsData?.error || "ارسال ناموفق";
            await supabase.from("sms_dispatch_logs").insert(
              rawMobiles.map((phone: string) => ({
                target_phone: phone,
                category: "daily_report",
                event_type: "daily_meetings",
                message: smsBody,
                provider_id: provider?.id ?? null,
                provider_name: provider?.title || provider?.provider_name || null,
                status: "failed",
                error_text: smsError,
                raw_response: smsData,
              }))
            );
          }
        } catch (e: any) {
          smsError = e.message;
        }
      }
    }

    // ── Bale ─────────────────────────────────────────────────────────────────
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
          const notifTitle = renderTemplate(titleTpl, globalVars);
          let meetingsListForBale = "";
          if (meetingCount === 0) {
            meetingsListForBale = "امروز هیچ جلسه‌ای برنامه‌ریزی نشده است.";
          } else {
            meetingsListForBale = rows.map(r => {
              const parts = [r.time, r.subject];
              if (r.location) parts.push(r.location);
              return `- ${parts.join(' | ')}`;
            }).join('\n');
          }
          const baleMessage = `${notifTitle}\n\n${renderTemplate(bodyTpl, { ...globalVars, meetings_list: meetingsListForBale })}`;

          const { data: mappings } = await supabase
            .from("user_bale_mapping")
            .select("user_id, bale_chat_id")
            .in("user_id", recipientIds);

          const chatMap: Record<string, string> = {};
          (mappings || []).forEach((m: any) => { if (m.bale_chat_id) chatMap[m.user_id] = m.bale_chat_id; });

          for (const uid of recipientIds) {
            const chatId = chatMap[uid];
            if (!chatId) continue;
            try {
              const res = await fetch(`https://tapi.bale.ai/bot${botToken}/sendMessage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: chatId, text: baleMessage }),
              });
              if (res.ok) baleSent++;
              else {
                const errBody = await res.text().catch(() => "");
                console.warn("[daily-meetings] Bale send failed for %s: HTTP %s %s", uid, res.status, errBody.slice(0, 100));
              }
            } catch (e: any) {
              console.warn("[daily-meetings] Bale network error for %s: %s", uid, e?.message);
            }
          }
        }
      }
    }

    return json({
      ok: true,
      meetings_count: meetingCount,
      recipients: recipientIds.length,
      notifications_sent: notifSent,
      sms_sent: smsSent,
      sms_error: smsError,
      bale_sent: baleSent,
      bale_error: baleError,
      date: jalaaliShort,
      date_long: jalaaliLong,
    });

  } catch (err: any) {
    return json({ ok: false, error: err.message }, 500);
  }
});
