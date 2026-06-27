import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

async function getCallerProfile(token: string) {
  const supabase = adminClient();
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  const { data } = await supabase.from("profiles").select("is_admin").eq("user_id", user.id).maybeSingle();
  return { user, isAdmin: data?.is_admin === true };
}

async function loadIds(
  supabase: ReturnType<typeof adminClient>,
  table: string,
  col = "id",
): Promise<Set<string>> {
  const PAGE = 10000;
  const all: string[] = [];
  let page = 0;
  while (true) {
    const { data } = await (supabase as any)
      .from(table)
      .select(col)
      .range(page * PAGE, (page + 1) * PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data) all.push(String(r[col]));
    if (data.length < PAGE) break;
    page++;
  }
  return new Set(all);
}

// Profiles is excluded — user accounts are managed separately outside backup/restore.
const ALLOWED_TABLES = new Set([
  // Core content
  "meetings", "shared_meetings", "meeting_inbox", "participants",
  "tasks", "task_workflow_steps", "notes", "contacts_email",
  // Calendar
  "calendars", "calendar_occasions", "all_day_events", "calendar_subscriptions",
  // Chat
  "chat_conversations", "chat_messages", "chat_group_members", "chat_tags",
  "chat_message_reactions", "chat_message_stars", "chat_reminders",
  // Channels
  "channels", "channel_members", "channel_messages", "channel_work_topics",
  "channel_broadcasts", "channel_group_tasks", "channel_group_task_assignments",
  "channel_group_task_activities", "channel_notification_rules", "channel_sms_rules",
  "channel_message_reactions", "channel_message_stars", "channel_message_private_pins",
  // Video Conference
  "conference_rooms", "conference_participants", "conference_messages",
  "conference_polls", "conference_poll_votes", "conference_breakout_rooms",
  // Notifications
  "notifications", "notification_templates", "notification_group_rules",
  // Broadcasts
  "broadcast_messages", "broadcast_recipients",
  // User & Groups
  "user_preferences", "user_groups", "user_group_members",
  "user_access_relations", "user_bale_mapping",
  // Org structure
  "org_organizations", "org_units", "org_positions", "org_position_members",
  "org_level_definitions", "org_level_permissions", "org_position_permissions",
  // Config & Logs
  "system_config", "spark_config", "spark_ai_settings", "spark_field_keywords", "spark_memory",
  "social_channel_configs", "sms_providers", "sms_templates", "sms_group_rules", "sms_dispatch_logs",
  "daily_report_config", "rahyab_settings", "bale_link_tokens", "hr_sso_config", "audit_log",
]);

// Dependency-ordered restore sequence (parents before children).
const RESTORE_ORDER = [
  // Independent config tables first
  "org_organizations",
  "org_level_definitions",
  "org_level_permissions",
  "org_units",
  "org_positions",
  "org_position_permissions",
  "user_groups",
  "notification_templates",
  "social_channel_configs",
  "sms_providers",
  "sms_templates",
  "sms_group_rules",
  "system_config",
  "spark_config",
  "spark_ai_settings",
  "spark_field_keywords",
  "daily_report_config",
  "rahyab_settings",
  "hr_sso_config",
  // User-dependent tables
  "user_preferences",
  "user_bale_mapping",
  "user_access_relations",
  "bale_link_tokens",
  "calendars",
  "calendar_occasions",
  "all_day_events",
  "contacts_email",
  "notes",
  "tasks",
  "task_workflow_steps",
  "chat_tags",
  "spark_memory",
  // Meetings and children
  "meetings",
  "shared_meetings",
  "meeting_inbox",
  "participants",
  // Channels and children
  "channels",
  "channel_work_topics",
  "channel_members",
  "channel_notification_rules",
  "channel_sms_rules",
  "channel_broadcasts",
  "channel_group_tasks",
  "channel_messages",
  "channel_group_task_assignments",
  "channel_group_task_activities",
  "channel_message_reactions",
  "channel_message_stars",
  "channel_message_private_pins",
  // Calendar subscriptions (depends on calendars)
  "calendar_subscriptions",
  // Org position members (depends on org_positions + users)
  "org_position_members",
  // Group members (depends on user_groups + users)
  "user_group_members",
  "notification_group_rules",
  // Chat (conversations before messages and group members)
  "chat_conversations",
  "chat_group_members",
  "chat_messages",
  "chat_message_reactions",
  "chat_message_stars",
  "chat_reminders",
  // Video conference
  "conference_rooms",
  "conference_polls",
  "conference_participants",
  "conference_messages",
  "conference_poll_votes",
  "conference_breakout_rooms",
  // Broadcasts
  "broadcast_messages",
  "broadcast_recipients",
  // SMS logs
  "sms_dispatch_logs",
  // Notifications and logs last
  "notifications",
  "audit_log",
];

// Upsert conflict columns for tables with composite or non-standard unique constraints.
// All other tables default to "id".
const CONFLICT_COLUMN: Record<string, string> = {
  // Existing
  notification_templates:          "category,event_type,audience",
  system_config:                   "section,key",
  user_group_members:              "group_id,user_id",
  chat_conversations:              "participant_a,participant_b",
  user_preferences:                "user_id",
  channel_members:                 "channel_id,user_id",
  org_position_members:            "position_id,user_id",
  sms_templates:                   "category,event_type,audience",
  spark_config:                    "module",
  chat_tags:                       "user_id,name",
  // New
  broadcast_recipients:            "message_id,user_id",
  calendar_subscriptions:          "calendar_id,user_id",
  channel_group_task_assignments:  "group_task_id,assignee_id",
  channel_message_private_pins:    "message_id,user_id",
  channel_message_reactions:       "message_id,user_id,emoji",
  channel_message_stars:           "message_id,user_id",
  channel_notification_rules:      "channel_id,notification_type",
  channel_sms_rules:               "channel_id,sms_category",
  chat_group_members:              "conversation_id,user_id",
  chat_message_reactions:          "message_id,user_id,emoji",
  chat_message_stars:              "message_id,user_id",
  conference_participants:         "room_id,user_id",
  conference_poll_votes:           "poll_id,user_id",
  notification_group_rules:        "group_id,notification_type",
  org_level_definitions:           "level",
  org_level_permissions:           "level,permission_key",
  org_position_permissions:        "position_id,permission_key",
  sms_group_rules:                 "group_id,sms_category",
  spark_field_keywords:            "module,field_key",
  spark_memory:                    "user_id,key",
  user_access_relations:           "user_id,related_user_id",
  user_bale_mapping:               "user_id",
};

// For tables whose PK is not "id", specify the real PK column here.
const TABLE_PK: Record<string, string> = {
  user_preferences: "user_id",
  bale_link_tokens: "token",
};

// Required user FK columns per table.
// Rows where any of these reference a non-existent profile are skipped entirely.
const REQUIRED_USER_FKS: Record<string, string[]> = {
  // Existing
  meetings:                    ["user_id"],
  tasks:                       ["user_id"],
  notes:                       ["user_id"],
  contacts_email:              ["user_id"],
  user_preferences:            ["user_id"],
  user_group_members:          ["user_id"],
  chat_conversations:          ["participant_a", "participant_b"],
  chat_messages:               ["sender_id"],
  channel_members:             ["user_id"],
  channel_messages:            ["sender_id"],
  calendars:                   ["user_id"],
  org_position_members:        ["user_id"],
  notifications:               ["user_id"],
  audit_log:                   ["user_id"],
  chat_tags:                   ["user_id"],
  // New
  all_day_events:              ["user_id"],
  bale_link_tokens:            ["user_id"],
  broadcast_recipients:        ["user_id"],
  calendar_subscriptions:      ["user_id"],
  channel_message_private_pins:["user_id"],  // part of composite key
  channel_message_reactions:   ["user_id"],  // part of composite key
  channel_message_stars:       ["user_id"],  // part of composite key
  chat_group_members:          ["user_id"],
  chat_message_reactions:      ["user_id"],  // part of composite key
  chat_message_stars:          ["user_id"],  // part of composite key
  chat_reminders:              ["user_id"],
  conference_participants:     ["user_id"],  // part of composite key
  conference_poll_votes:       ["user_id"],  // part of composite key
  meeting_inbox:               ["user_id"],
  spark_memory:                ["user_id"],
  user_access_relations:       ["user_id", "related_user_id"],
  user_bale_mapping:           ["user_id"],
};

// Nullable user FK columns per table.
// These are nullified (row is kept) when the referenced user no longer exists.
const NULLABLE_USER_FKS: Record<string, string[]> = {
  // Existing
  user_groups:                    ["created_by"],
  system_config:                  ["updated_by"],
  notifications:                  ["sender_id"],
  channels:                       ["created_by"],
  channel_messages:               ["pinned_by"],
  channel_work_topics:            ["created_by", "assignee_id"],
  org_position_members:           ["assigned_by"],
  daily_report_config:            ["updated_by"],
  // New
  broadcast_messages:             ["sender_id"],
  channel_group_task_activities:  ["user_id"],
  channel_group_task_assignments: ["assignee_id"],
  channel_group_tasks:            ["created_by"],
  conference_messages:            ["user_id"],
  shared_meetings:                ["sender_id", "recipient_id"],
  sms_dispatch_logs:              ["target_user_id", "triggered_by_user_id"],
  task_workflow_steps:            ["from_user_id", "to_user_id"],
  user_access_relations:          ["created_by"],
};

const BATCH_SIZE = 50;
const MAX_ERRORS = 100;

interface RowError {
  row: number;
  id: string;
  reason: string;
  code?: string;
  dependency?: string;
}

interface TableResult {
  success: boolean;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: RowError[];
  deleteError?: string;
}

/**
 * Pre-filter rows that cannot be restored due to missing FK dependencies.
 * Nullifies nullable user FKs instead of skipping the row.
 */
function preFilterRows(
  tableKey: string,
  rows: Record<string, unknown>[],
  existingUserIds: Set<string>,
  existingGroupIds: Set<string>,
  existingConvIds: Set<string>,
  existingChannelIds: Set<string>,
  existingMeetingIds: Set<string>,
): { filtered: Record<string, unknown>[]; skipped: RowError[] } {
  const filtered: Record<string, unknown>[] = [];
  const skipped: RowError[] = [];
  const reqFks = REQUIRED_USER_FKS[tableKey] ?? [];
  const nullFks = NULLABLE_USER_FKS[tableKey] ?? [];

  for (let i = 0; i < rows.length; i++) {
    let row = { ...rows[i] };
    const rowNum = i + 2;
    const rowId = String(row.id ?? row.user_id ?? row.token ?? "");
    let skip = false;

    // Required user FK check — skip row if referenced user not in system
    for (const col of reqFks) {
      const val = String(row[col] ?? "");
      if (val && !existingUserIds.has(val)) {
        skipped.push({
          row: rowNum, id: rowId,
          reason: "کاربر مرجع در سیستم وجود ندارد",
          dependency: `${col}=${val.slice(0, 8)}…`,
        });
        skip = true;
        break;
      }
    }
    if (skip) continue;

    // Nullable user FK — nullify instead of skipping
    for (const col of nullFks) {
      const val = String(row[col] ?? "");
      if (val && !existingUserIds.has(val)) {
        row = { ...row, [col]: null };
      }
    }

    // user_group_members: check the group itself exists
    if (tableKey === "user_group_members") {
      const gid = String(row.group_id ?? "");
      if (gid && !existingGroupIds.has(gid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "گروه کاربری مرجع وجود ندارد", dependency: `group_id=${gid.slice(0, 8)}…` });
        continue;
      }
    }

    // channel_members, channel_messages, channel_work_topics, channel_broadcasts,
    // channel_group_tasks, channel_notification_rules, channel_sms_rules: check channel exists
    if ([
      "channel_members", "channel_messages", "channel_work_topics",
      "channel_broadcasts", "channel_group_tasks",
      "channel_notification_rules", "channel_sms_rules",
    ].includes(tableKey)) {
      const cid = String(row.channel_id ?? "");
      if (cid && !existingChannelIds.has(cid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "کانال مرجع بازیابی نشد یا وجود ندارد", dependency: `channel_id=${cid.slice(0, 8)}…` });
        continue;
      }
    }

    // chat_messages, chat_group_members: check the conversation exists
    if (tableKey === "chat_messages" || tableKey === "chat_group_members") {
      const cid = String(row.conversation_id ?? "");
      if (cid && !existingConvIds.has(cid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "مکالمه مرجع بازیابی نشد یا وجود ندارد", dependency: `conversation_id=${cid.slice(0, 8)}…` });
        continue;
      }
    }

    // participants, meeting_inbox, shared_meetings: check the meeting exists
    if (tableKey === "participants" || tableKey === "meeting_inbox" || tableKey === "shared_meetings") {
      const mid = String(row.meeting_id ?? "");
      if (mid && !existingMeetingIds.has(mid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "جلسه مرجع بازیابی نشد یا وجود ندارد", dependency: `meeting_id=${mid.slice(0, 8)}…` });
        continue;
      }
    }

    filtered.push(row);
  }

  return { filtered, skipped };
}

/**
 * For composite-conflict tables, strip the `id` column before upserting to avoid
 * primary key conflicts when the backup id differs from the destination id.
 */
function prepareRow(tableKey: string, row: Record<string, unknown>): Record<string, unknown> {
  const conflictCol = CONFLICT_COLUMN[tableKey] ?? "id";
  if (conflictCol.includes(",")) {
    const { id: _id, ...rest } = row as any;
    return rest;
  }
  return row;
}

async function upsertRows(
  supabase: ReturnType<typeof adminClient>,
  tableKey: string,
  rows: Record<string, unknown>[],
  existingIds: Set<string>,
): Promise<{ inserted: number; updated: number; constraintSkipped: number; failed: number; errors: RowError[] }> {
  const conflictCol = CONFLICT_COLUMN[tableKey] ?? "id";
  const isComposite = conflictCol.includes(",");
  let inserted = 0;
  let updated = 0;
  let constraintSkipped = 0;
  let failed = 0;
  const errors: RowError[] = [];

  const preparedRows = rows.map(r => prepareRow(tableKey, r));

  for (let i = 0; i < preparedRows.length; i += BATCH_SIZE) {
    const batch = preparedRows.slice(i, i + BATCH_SIZE);
    const originalBatch = rows.slice(i, i + BATCH_SIZE);

    const { error } = await (supabase as any).from(tableKey).upsert(batch, { onConflict: conflictCol });
    if (!error) {
      if (isComposite) {
        inserted += batch.length;
      } else {
        const pkCol = TABLE_PK[tableKey] ?? "id";
        for (const row of originalBatch) {
          if (existingIds.has(String(row[pkCol] ?? ""))) updated++;
          else inserted++;
        }
      }
      continue;
    }

    // Batch failed — fall back to row-by-row
    for (let j = 0; j < batch.length; j++) {
      const prepRow = batch[j];
      const origRow = originalBatch[j];
      const rowNum = i + j + 2;
      const pkCol = TABLE_PK[tableKey] ?? "id";
      const rowId = String(origRow.id ?? origRow.user_id ?? origRow.token ?? "");

      const { error: e } = await (supabase as any).from(tableKey).upsert(prepRow, { onConflict: conflictCol });
      if (!e) {
        if (isComposite) inserted++;
        else if (existingIds.has(String(origRow[pkCol] ?? ""))) updated++;
        else inserted++;
      } else if (["23505", "23503", "23514", "23502"].includes(e.code ?? "")) {
        constraintSkipped++;
        if (errors.length < MAX_ERRORS) {
          const reason =
            e.code === "23503" ? "رکورد وابسته یافت نشد" :
            e.code === "23505" ? "رکورد تکراری" :
            `نقض قید (${e.code})`;
          errors.push({ row: rowNum, id: rowId, reason, code: e.code, dependency: e.message?.slice(0, 120) });
        }
      } else {
        failed++;
        if (errors.length < MAX_ERRORS) {
          errors.push({ row: rowNum, id: rowId, reason: e.message?.slice(0, 200) ?? "خطای ناشناخته", code: e.code });
        }
      }
    }
  }

  return { inserted, updated, constraintSkipped, failed, errors };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const jsonRes = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonRes({ error: "Unauthorized" }, 401);
    const token = authHeader.replace("Bearer ", "");
    const caller = await getCallerProfile(token);
    if (!caller) return jsonRes({ error: "Unauthorized" }, 401);
    if (!caller.isAdmin) return jsonRes({ error: "Admin access required" }, 403);

    const { tables, strategy } = await req.json() as {
      tables: Record<string, any[]>;
      strategy: "upsert" | "replace";
    };

    if (!tables || typeof tables !== "object") return jsonRes({ error: "Invalid payload" }, 400);
    if (strategy !== "upsert" && strategy !== "replace") return jsonRes({ error: "Invalid strategy" }, 400);

    // Silently drop disallowed tables (e.g. profiles, _meta in old backup files)
    const filteredTables: Record<string, any[]> = {};
    for (const [k, v] of Object.entries(tables)) {
      if (ALLOWED_TABLES.has(k) && Array.isArray(v)) filteredTables[k] = v;
    }

    const supabase = adminClient();
    const results: Record<string, TableResult> = {};

    const sortedKeys = Object.keys(filteredTables).sort((a, b) => {
      const ai = RESTORE_ORDER.indexOf(a);
      const bi = RESTORE_ORDER.indexOf(b);
      return (ai === -1 ? RESTORE_ORDER.length : ai) - (bi === -1 ? RESTORE_ORDER.length : bi);
    });

    // ── Replace strategy: delete in reverse dependency order ──────────────────
    if (strategy === "replace") {
      const deleteOrder = [...sortedKeys].reverse();
      for (const tableKey of deleteOrder) {
        const pkCol = TABLE_PK[tableKey] ?? "id";
        const { error: delErr } = await (supabase as any)
          .from(tableKey)
          .delete()
          .neq(pkCol, "00000000-0000-0000-0000-000000000000");
        if (delErr) {
          results[tableKey] = {
            success: false, total: 0, inserted: 0, updated: 0, skipped: 0, failed: 0,
            errors: [], deleteError: delErr.message,
          };
        }
      }
    }

    // ── Pre-load FK dependency sets ───────────────────────────────────────────
    const existingUserIds  = await loadIds(supabase, "profiles", "user_id");
    let existingGroupIds   = await loadIds(supabase, "user_groups", "id");
    let existingConvIds    = await loadIds(supabase, "chat_conversations", "id");
    let existingChannelIds = await loadIds(supabase, "channels", "id");
    let existingMeetingIds = await loadIds(supabase, "meetings", "id");

    // ── Restore each table in dependency order ────────────────────────────────
    for (const tableKey of sortedKeys) {
      const rawRows: any[] = filteredTables[tableKey] ?? [];
      const total = rawRows.length;

      if (total === 0) {
        results[tableKey] = { success: true, total: 0, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
        continue;
      }

      // Refresh FK sets after each "parent" table is restored.
      if (tableKey === "user_group_members" || tableKey === "notification_group_rules") {
        existingGroupIds = await loadIds(supabase, "user_groups", "id");
      }
      if (tableKey === "chat_messages" || tableKey === "chat_group_members") {
        existingConvIds = await loadIds(supabase, "chat_conversations", "id");
      }
      if ([
        "channel_members", "channel_messages", "channel_work_topics",
        "channel_broadcasts", "channel_group_tasks",
        "channel_notification_rules", "channel_sms_rules",
      ].includes(tableKey)) {
        existingChannelIds = await loadIds(supabase, "channels", "id");
      }
      if (tableKey === "participants" || tableKey === "meeting_inbox" || tableKey === "shared_meetings") {
        existingMeetingIds = await loadIds(supabase, "meetings", "id");
      }

      const priorDeleteError = results[tableKey]?.deleteError;

      const { filtered, skipped: preSkipped } = preFilterRows(
        tableKey, rawRows,
        existingUserIds, existingGroupIds, existingConvIds,
        existingChannelIds, existingMeetingIds,
      );

      const conflictCol = CONFLICT_COLUMN[tableKey] ?? "id";
      const isComposite = conflictCol.includes(",");
      const pkCol = TABLE_PK[tableKey] ?? "id";
      const existingTableIds = isComposite ? new Set<string>() : await loadIds(supabase, tableKey, pkCol);

      try {
        const { inserted, updated, constraintSkipped, failed, errors } =
          await upsertRows(supabase, tableKey, filtered, existingTableIds);

        results[tableKey] = {
          success: failed === 0,
          total,
          inserted,
          updated,
          skipped: preSkipped.length + constraintSkipped,
          failed,
          errors: [...preSkipped, ...errors],
          ...(priorDeleteError ? { deleteError: priorDeleteError } : {}),
        };
      } catch (err: any) {
        results[tableKey] = {
          success: false,
          total,
          inserted: 0,
          updated: 0,
          skipped: preSkipped.length,
          failed: filtered.length,
          errors: [...preSkipped, { row: 0, id: "", reason: err.message, code: "FATAL" }],
          ...(priorDeleteError ? { deleteError: priorDeleteError } : {}),
        };
      }
    }

    return jsonRes({ results });
  } catch (err: any) {
    return jsonRes({ error: err.message }, 500);
  }
});
