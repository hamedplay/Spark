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

async function loadIds(supabase: ReturnType<typeof adminClient>, table: string, col = "id"): Promise<Set<string>> {
  const { data } = await (supabase as any).from(table).select(col).limit(100000);
  return new Set((data ?? []).map((r: any) => String(r[col])));
}

// Profiles is excluded — user accounts are managed separately outside backup/restore
const ALLOWED_TABLES = new Set([
  "meetings", "tasks", "notes", "contacts_email",
  "chat_conversations", "chat_messages", "notifications", "user_groups",
  "user_group_members", "org_units", "org_positions", "audit_log",
  "system_config", "notification_templates", "social_channel_configs", "sms_providers",
]);

// Dependency-ordered restore sequence (parents before children)
const RESTORE_ORDER = [
  "org_units",
  "org_positions",
  "user_groups",
  "notification_templates",
  "social_channel_configs",
  "sms_providers",
  "system_config",
  "meetings",
  "tasks",
  "notes",
  "contacts_email",
  "user_group_members",
  "chat_conversations",
  "chat_messages",
  "notifications",
  "audit_log",
];

// Upsert conflict columns for tables with composite unique constraints
// All other tables use the default "id" conflict column
const CONFLICT_COLUMN: Record<string, string> = {
  notification_templates: "category,event_type,audience",
  system_config: "section,key",
  user_group_members: "group_id,user_id",
  chat_conversations: "participant_a,participant_b",
};

// Required user FK columns per table.
// Rows where any of these reference a non-existent user are skipped (pre-filter).
const REQUIRED_USER_FKS: Record<string, string[]> = {
  meetings: ["user_id"],
  tasks: ["user_id"],
  notes: ["user_id"],
  contacts_email: ["user_id"],
  user_group_members: ["user_id"],
  chat_conversations: ["participant_a", "participant_b"],
  chat_messages: ["sender_id"],
  notifications: ["user_id"],
  audit_log: ["user_id"],
};

// Nullable user FK columns per table.
// These are nullified (row is kept) when the referenced user no longer exists.
const NULLABLE_USER_FKS: Record<string, string[]> = {
  user_groups: ["created_by"],
  system_config: ["updated_by"],
  notifications: ["sender_id"],
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

/** Pre-filter rows that cannot be restored due to missing FK dependencies. */
function preFilterRows(
  tableKey: string,
  rows: Record<string, unknown>[],
  existingUserIds: Set<string>,
  existingGroupIds: Set<string>,
  existingConvIds: Set<string>,
): { filtered: Record<string, unknown>[]; skipped: RowError[] } {
  const filtered: Record<string, unknown>[] = [];
  const skipped: RowError[] = [];
  const reqFks = REQUIRED_USER_FKS[tableKey] ?? [];
  const nullFks = NULLABLE_USER_FKS[tableKey] ?? [];

  for (let i = 0; i < rows.length; i++) {
    let row = { ...rows[i] };
    const rowNum = i + 2;
    const rowId = String(row.id ?? "");
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
        skipped.push({
          row: rowNum, id: rowId,
          reason: "گروه کاربری مرجع وجود ندارد",
          dependency: `group_id=${gid.slice(0, 8)}…`,
        });
        continue;
      }
    }

    // chat_messages: check the conversation exists (restored or pre-existing)
    if (tableKey === "chat_messages") {
      const cid = String(row.conversation_id ?? "");
      if (cid && !existingConvIds.has(cid)) {
        skipped.push({
          row: rowNum, id: rowId,
          reason: "مکالمه مرجع بازیابی نشد یا وجود ندارد",
          dependency: `conversation_id=${cid.slice(0, 8)}…`,
        });
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
  existingIds: Set<string>, // pre-loaded existing IDs for insert-vs-update tracking
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
        for (const row of originalBatch) {
          if (existingIds.has(String(row.id ?? ""))) updated++;
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
      const rowId = String(origRow.id ?? "");

      const { error: e } = await (supabase as any).from(tableKey).upsert(prepRow, { onConflict: conflictCol });
      if (!e) {
        if (isComposite) inserted++;
        else if (existingIds.has(String(origRow.id ?? ""))) updated++;
        else inserted++;
      } else if (["23505", "23503", "23514", "23502"].includes(e.code ?? "")) {
        // Constraint violations: count as skipped, not hard failures
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

    // Silently drop disallowed tables (e.g. profiles in old backup files) instead of erroring
    const filteredTables: Record<string, any[]> = {};
    for (const [k, v] of Object.entries(tables)) {
      if (ALLOWED_TABLES.has(k)) filteredTables[k] = v;
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
      const deleteOrder = [...sortedKeys].sort((a, b) => {
        const ai = RESTORE_ORDER.indexOf(a);
        const bi = RESTORE_ORDER.indexOf(b);
        return (bi === -1 ? -1 : bi) - (ai === -1 ? -1 : ai);
      });
      for (const tableKey of deleteOrder) {
        const { error: delErr } = await (supabase as any)
          .from(tableKey)
          .delete()
          .neq("id", "00000000-0000-0000-0000-000000000000");
        if (delErr) {
          results[tableKey] = {
            success: false, total: 0, inserted: 0, updated: 0, skipped: 0, failed: 0,
            errors: [], deleteError: delErr.message,
          };
        }
      }
    }

    // ── Pre-load FK dependency sets ───────────────────────────────────────────
    const existingUserIds = await loadIds(supabase, "profiles", "user_id");
    let existingGroupIds = await loadIds(supabase, "user_groups", "id");
    let existingConvIds = await loadIds(supabase, "chat_conversations", "id");

    // ── Restore each table in dependency order ────────────────────────────────
    for (const tableKey of sortedKeys) {
      const rawRows: any[] = filteredTables[tableKey] ?? [];
      const total = rawRows.length;

      if (total === 0) {
        results[tableKey] = { success: true, total: 0, inserted: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
        continue;
      }

      // Refresh group IDs just before restoring members (captures newly restored groups)
      if (tableKey === "user_group_members") {
        existingGroupIds = await loadIds(supabase, "user_groups", "id");
      }
      // Refresh conversation IDs just before restoring messages
      if (tableKey === "chat_messages") {
        existingConvIds = await loadIds(supabase, "chat_conversations", "id");
      }

      const priorDeleteError = results[tableKey]?.deleteError;

      // Step 1: pre-filter rows with unresolvable FK dependencies
      const { filtered, skipped: preSkipped } = preFilterRows(
        tableKey, rawRows, existingUserIds, existingGroupIds, existingConvIds,
      );

      // Step 2: pre-load existing IDs for insert-vs-update tracking
      const isComposite = (CONFLICT_COLUMN[tableKey] ?? "").includes(",");
      const existingTableIds = isComposite ? new Set<string>() : await loadIds(supabase, tableKey, "id");

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
