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
  "meetings", "participants", "meeting_inbox", "shared_meetings", "actions",
  "tasks", "task_workflow_steps", "notes", "contacts_email",
  // Chat
  "chat_conversations", "chat_group_members", "chat_messages",
  "chat_message_stars", "chat_message_reactions", "chat_reminders", "chat_tags",
  // Channels
  "channels", "channel_members", "channel_messages", "channel_work_topics",
  "channel_broadcasts", "channel_group_tasks", "channel_group_task_assignments",
  "channel_group_task_activities", "channel_message_stars", "channel_message_reactions",
  "channel_message_private_pins", "channel_notification_rules", "channel_sms_rules",
  // Calendar
  "calendars", "calendar_occasions", "all_day_events", "calendar_subscriptions",
  // Notifications
  "notifications", "notification_templates", "notification_group_rules",
  // User & Groups
  "user_preferences", "user_bale_mapping", "user_access_relations",
  "user_groups", "user_group_members",
  // Org structure
  "org_organizations", "org_units", "org_positions", "org_position_members",
  "org_position_permissions", "org_level_definitions", "org_level_permissions",
  // Config & Logs
  "system_config", "spark_config", "spark_ai_settings", "spark_field_keywords", "spark_memory",
  "social_channel_configs", "sms_providers", "sms_templates", "sms_group_rules",
  "hr_sso_config", "rahyab_settings", "daily_report_config", "audit_log",
]);

// Dependency-ordered restore sequence (parents before children).
const RESTORE_ORDER = [
  // Independent config — no FKs
  "org_organizations",
  "org_level_definitions",
  "org_level_permissions",
  "hr_sso_config",
  "rahyab_settings",
  "spark_ai_settings",
  "spark_field_keywords",
  "notification_templates",
  "social_channel_configs",
  "sms_providers",
  "sms_templates",
  "system_config",
  "spark_config",
  "daily_report_config",
  // Org structure (depends on org_units/positions)
  "org_units",
  "org_positions",
  "org_position_permissions",
  // User-dependent
  "user_preferences",
  "user_bale_mapping",
  "user_access_relations",
  "spark_memory",
  "calendars",
  "all_day_events",
  "calendar_subscriptions",
  "calendar_occasions",
  "contacts_email",
  "notes",
  "tasks",
  "task_workflow_steps",
  "chat_tags",
  // Meetings and children
  "meetings",
  "participants",
  "meeting_inbox",
  "shared_meetings",
  "actions",
  // Channels and children
  "channels",
  "channel_notification_rules",
  "channel_sms_rules",
  "channel_work_topics",
  "channel_members",
  "channel_broadcasts",
  "channel_group_tasks",
  "channel_group_task_assignments",
  "channel_group_task_activities",
  "channel_messages",
  "channel_message_stars",
  "channel_message_reactions",
  "channel_message_private_pins",
  // Groups and group-dependent config
  "user_groups",
  "notification_group_rules",
  "sms_group_rules",
  "user_group_members",
  // Org position members (depends on org_positions + users)
  "org_position_members",
  // Chat (conversations before messages)
  "chat_conversations",
  "chat_group_members",
  "chat_messages",
  "chat_message_stars",
  "chat_message_reactions",
  "chat_reminders",
  // Notifications and logs last
  "notifications",
  "audit_log",
];

// Upsert conflict columns for tables with composite or non-standard unique constraints.
// All other tables default to "id".
const CONFLICT_COLUMN: Record<string, string> = {
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
  // New tables with composite unique constraints
  calendar_subscriptions:          "calendar_id,user_id",
  chat_group_members:              "conversation_id,user_id",
  channel_notification_rules:      "channel_id,notification_type",
  channel_sms_rules:               "channel_id,sms_category",
  channel_message_stars:           "message_id,user_id",
  channel_message_private_pins:    "message_id,user_id",
  channel_group_task_assignments:  "group_task_id,assignee_id",
  meeting_inbox:                   "meeting_id,user_id",
  notification_group_rules:        "group_id,notification_type",
  sms_group_rules:                 "group_id,sms_category",
  org_position_permissions:        "position_id,permission_key",
  org_level_permissions:           "level,permission_key",
  spark_field_keywords:            "module,field_key",
  spark_memory:                    "user_id,key",
  user_access_relations:           "user_id,related_user_id",
  user_bale_mapping:               "user_id",
};

// For tables whose PK is not "id", specify the real PK column here.
// Used by loadIds for insert-vs-update tracking.
const TABLE_PK: Record<string, string> = {
  user_preferences: "user_id",
  user_bale_mapping: "user_id",
};

// Required user FK columns per table.
// Rows where any of these reference a non-existent profile are skipped entirely.
const REQUIRED_USER_FKS: Record<string, string[]> = {
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
  // New tables
  all_day_events:              ["user_id"],
  calendar_subscriptions:      ["user_id"],
  user_bale_mapping:           ["user_id"],
  user_access_relations:       ["user_id"],
  spark_memory:                ["user_id"],
  meeting_inbox:               ["user_id"],
  shared_meetings:             ["sender_id"],
  chat_group_members:          ["user_id"],
  chat_message_stars:          ["user_id"],
  chat_message_reactions:      ["user_id"],
  chat_reminders:              ["user_id"],
  channel_group_task_activities: ["user_id"],
  channel_message_stars:       ["user_id"],
  channel_message_reactions:   ["user_id"],
  channel_message_private_pins: ["user_id"],
};

// Nullable user FK columns per table.
// These are nullified (row is kept) when the referenced user no longer exists.
const NULLABLE_USER_FKS: Record<string, string[]> = {
  user_groups:           ["created_by"],
  system_config:         ["updated_by"],
  notifications:         ["sender_id"],
  channels:              ["created_by"],
  channel_messages:      ["pinned_by"],
  channel_work_topics:   ["created_by", "assignee_id"],
  org_position_members:  ["assigned_by"],
  daily_report_config:   ["updated_by"],
  // New tables
  channel_group_tasks:         ["created_by"],
  channel_group_task_assignments: ["assignee_id"],
  user_access_relations:       ["created_by"],
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
 * Continues processing remaining rows even when some are skipped.
 */
function preFilterRows(
  tableKey: string,
  rows: Record<string, unknown>[],
  existingUserIds: Set<string>,
  existingGroupIds: Set<string>,
  existingConvIds: Set<string>,
  existingChannelIds: Set<string>,
  existingMeetingIds: Set<string>,
  existingTaskIds: Set<string>,
  existingChatMsgIds: Set<string>,
  existingChannelMsgIds: Set<string>,
  existingChannelGroupTaskIds: Set<string>,
): { filtered: Record<string, unknown>[]; skipped: RowError[] } {
  const filtered: Record<string, unknown>[] = [];
  const skipped: RowError[] = [];
  const reqFks = REQUIRED_USER_FKS[tableKey] ?? [];
  const nullFks = NULLABLE_USER_FKS[tableKey] ?? [];

  for (let i = 0; i < rows.length; i++) {
    let row = { ...rows[i] };
    const rowNum = i + 2;
    const rowId = String(row.id ?? row.user_id ?? "");
    let skip = false;

    // Required user FK check
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

    // notification_group_rules / sms_group_rules: check group exists
    if (tableKey === "notification_group_rules" || tableKey === "sms_group_rules") {
      const gid = String(row.group_id ?? "");
      if (gid && !existingGroupIds.has(gid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "گروه کاربری مرجع وجود ندارد", dependency: `group_id=${gid.slice(0, 8)}…` });
        continue;
      }
    }

    // channel-dependent tables: check the channel exists
    if (["channel_members", "channel_messages", "channel_work_topics",
         "channel_broadcasts", "channel_group_tasks",
         "channel_notification_rules", "channel_sms_rules"].includes(tableKey)) {
      const cid = String(row.channel_id ?? "");
      if (cid && !existingChannelIds.has(cid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "کانال مرجع بازیابی نشد یا وجود ندارد", dependency: `channel_id=${cid.slice(0, 8)}…` });
        continue;
      }
    }

    // chat_messages / chat_group_members: check the conversation exists
    if (tableKey === "chat_messages" || tableKey === "chat_group_members") {
      const cid = String(row.conversation_id ?? "");
      if (cid && !existingConvIds.has(cid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "مکالمه مرجع بازیابی نشد یا وجود ندارد", dependency: `conversation_id=${cid.slice(0, 8)}…` });
        continue;
      }
    }

    // participants / meeting_inbox / shared_meetings / actions: check the meeting exists
    if (["participants", "meeting_inbox", "shared_meetings", "actions"].includes(tableKey)) {
      const mid = String(row.meeting_id ?? "");
      if (mid && !existingMeetingIds.has(mid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "جلسه مرجع بازیابی نشد یا وجود ندارد", dependency: `meeting_id=${mid.slice(0, 8)}…` });
        continue;
      }
    }

    // task_workflow_steps: check the task exists
    if (tableKey === "task_workflow_steps") {
      const tid = String(row.task_id ?? "");
      if (tid && !existingTaskIds.has(tid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "وظیفه مرجع بازیابی نشد یا وجود ندارد", dependency: `task_id=${tid.slice(0, 8)}…` });
        continue;
      }
    }

    // chat_message_stars / chat_message_reactions / chat_reminders: check message exists
    if (["chat_message_stars", "chat_message_reactions", "chat_reminders"].includes(tableKey)) {
      const mid = String(row.message_id ?? "");
      if (mid && !existingChatMsgIds.has(mid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "پیام چت مرجع بازیابی نشد یا وجود ندارد", dependency: `message_id=${mid.slice(0, 8)}…` });
        continue;
      }
    }

    // channel_message_stars / reactions / private_pins: check channel message exists
    if (["channel_message_stars", "channel_message_reactions", "channel_message_private_pins"].includes(tableKey)) {
      const mid = String(row.message_id ?? "");
      if (mid && !existingChannelMsgIds.has(mid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "پیام کانال مرجع بازیابی نشد یا وجود ندارد", dependency: `message_id=${mid.slice(0, 8)}…` });
        continue;
      }
    }

    // channel_group_task_assignments / activities: check the group task exists
    if (["channel_group_task_assignments", "channel_group_task_activities"].includes(tableKey)) {
      const tid = String(row.group_task_id ?? row.task_id ?? "");
      if (tid && !existingChannelGroupTaskIds.has(tid)) {
        skipped.push({ row: rowNum, id: rowId, reason: "وظیفه گروهی کانال مرجع بازیابی نشد", dependency: `task_id=${tid.slice(0, 8)}…` });
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

    // Batch failed — fall back to row-by-row to maximise successful inserts
    for (let j = 0; j < batch.length; j++) {
      const prepRow = batch[j];
      const origRow = originalBatch[j];
      const rowNum = i + j + 2;
      const rowId = String(origRow.id ?? origRow.user_id ?? "");
      const pkCol = TABLE_PK[tableKey] ?? "id";

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

    // Silently drop disallowed tables
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
    const existingUserIds       = await loadIds(supabase, "profiles", "user_id");
    let existingGroupIds        = await loadIds(supabase, "user_groups", "id");
    let existingConvIds         = await loadIds(supabase, "chat_conversations", "id");
    let existingChannelIds      = await loadIds(supabase, "channels", "id");
    let existingMeetingIds      = await loadIds(supabase, "meetings", "id");
    let existingTaskIds         = await loadIds(supabase, "tasks", "id");
    let existingChatMsgIds      = new Set<string>();
    let existingChannelMsgIds   = new Set<string>();
    let existingGroupTaskIds    = new Set<string>();

    // ── Restore each table in dependency order ────────────────────────────────
    for (const tableKey of sortedKeys) {
      const rawRows: any[] = filteredTables[tableKey] ?? [];
      const total = rawRows.length;

      if (total === 0) {
        results[tableKey] = { success: true, total: 0, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
        continue;
      }

      // Refresh FK sets after parent tables are restored
      if (tableKey === "user_group_members" || tableKey === "notification_group_rules" || tableKey === "sms_group_rules") {
        existingGroupIds = await loadIds(supabase, "user_groups", "id");
      }
      if (tableKey === "chat_messages" || tableKey === "chat_group_members") {
        existingConvIds = await loadIds(supabase, "chat_conversations", "id");
      }
      if (["channel_members", "channel_messages", "channel_work_topics",
           "channel_broadcasts", "channel_group_tasks",
           "channel_notification_rules", "channel_sms_rules"].includes(tableKey)) {
        existingChannelIds = await loadIds(supabase, "channels", "id");
      }
      if (["participants", "meeting_inbox", "shared_meetings", "actions"].includes(tableKey)) {
        existingMeetingIds = await loadIds(supabase, "meetings", "id");
      }
      if (tableKey === "task_workflow_steps") {
        existingTaskIds = await loadIds(supabase, "tasks", "id");
      }
      if (["chat_message_stars", "chat_message_reactions", "chat_reminders"].includes(tableKey)) {
        existingChatMsgIds = await loadIds(supabase, "chat_messages", "id");
      }
      if (["channel_message_stars", "channel_message_reactions", "channel_message_private_pins"].includes(tableKey)) {
        existingChannelMsgIds = await loadIds(supabase, "channel_messages", "id");
      }
      if (["channel_group_task_assignments", "channel_group_task_activities"].includes(tableKey)) {
        existingGroupTaskIds = await loadIds(supabase, "channel_group_tasks", "id");
      }

      const priorDeleteError = results[tableKey]?.deleteError;

      // Step 1: pre-filter rows with unresolvable FK dependencies
      const { filtered, skipped: preSkipped } = preFilterRows(
        tableKey, rawRows,
        existingUserIds, existingGroupIds, existingConvIds,
        existingChannelIds, existingMeetingIds, existingTaskIds,
        existingChatMsgIds, existingChannelMsgIds, existingGroupTaskIds,
      );

      // Step 2: pre-load existing IDs for insert-vs-update tracking
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
