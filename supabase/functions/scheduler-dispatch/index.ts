import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, X-Cron-Secret",
  "Cache-Control": "no-store",
};

type TaskName =
  | "notification_outbox"
  | "minutes_reminders"
  | "decision_due_overdue"
  | "daily_report";

interface TaskConfig {
  slug: string;
  secretEnv: string;
  body: Record<string, unknown>;
}

const TASKS: Record<TaskName, TaskConfig> = {
  notification_outbox: {
    slug: "process-notification-outbox",
    secretEnv: "NOTIFICATION_OUTBOX_CRON_SECRET",
    body: {},
  },
  minutes_reminders: {
    slug: "process-minutes-reminders",
    secretEnv: "MINUTES_REMINDER_CRON_SECRET",
    body: {},
  },
  decision_due_overdue: {
    slug: "process-decision-due-overdue",
    secretEnv: "DECISION_DUE_CRON_SECRET",
    body: {},
  },
  daily_report: {
    slug: "send-daily-meetings",
    secretEnv: "DAILY_REPORT_CRON_SECRET",
    body: { scheduled: true },
  },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isTaskName(value: unknown): value is TaskName {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TASKS, value);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const providedSecret = req.headers.get("X-Cron-Secret");
  if (!providedSecret) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey || !anonKey) return json({ error: "server_misconfigured" }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: authorized, error: authError } = await admin.rpc("verify_cron_secret", {
    candidate: providedSecret,
  });
  if (authError) {
    console.error("[scheduler-dispatch] cron secret verification failed", authError.message);
    return json({ error: "authorization_unavailable" }, 503);
  }
  if (authorized !== true) return json({ error: "forbidden" }, 403);

  let payload: Record<string, unknown>;
  try {
    const parsed = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "invalid_body" }, 400);
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ error: "invalid_body" }, 400);
  }

  if (!isTaskName(payload.task)) return json({ error: "invalid_task" }, 400);
  const task = payload.task;
  const config = TASKS[task];

  // Server 3 keeps its worker-specific secrets. Hosted deployments can fall
  // back to the same Vault-backed secret that authenticated this dispatcher.
  const targetSecret = Deno.env.get(config.secretEnv) || providedSecret;

  // Use the same legacy anon credential in both gateway headers. Mixing a
  // publishable apikey with a different Authorization API key is rejected by
  // the current Supabase gateway as conflicting credentials. Authorization of
  // the scheduled operation itself remains the Vault-backed X-Cron-Secret.
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "X-Cron-Secret": targetSecret,
    "apikey": anonKey,
    "Authorization": `Bearer ${anonKey}`,
  };

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/${config.slug}`, {
      method: "POST",
      headers,
      body: JSON.stringify(config.body),
      signal: AbortSignal.timeout(120_000),
    });

    const responseText = await response.text();
    let targetBody: unknown = responseText;
    try {
      targetBody = responseText ? JSON.parse(responseText) : null;
    } catch {
      // Keep non-JSON responses as text for diagnostics.
    }

    if (!response.ok) {
      console.error("[scheduler-dispatch] target failed", {
        task,
        status: response.status,
      });
      return json({ error: "target_failed", task, target_status: response.status, target_body: targetBody }, 502);
    }

    return json({ ok: true, task, target_status: response.status, target_body: targetBody });
  } catch (error) {
    console.error("[scheduler-dispatch] target request failed", {
      task,
      error: error instanceof Error ? error.message : String(error),
    });
    return json({ error: "target_unavailable", task }, 503);
  }
});
