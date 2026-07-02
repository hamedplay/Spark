import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// Public endpoint — browsers send CSP reports without Authorization headers.
// verify_jwt is false (set at deploy time).

// ── Limits ────────────────────────────────────────────────────────────────────
const MAX_BODY_BYTES = 65_536; // 64 KB — far more than any legitimate report needs
const MAX_REPORTS_PER_BATCH = 20; // cap Level-3 batches
const STRING_FIELD_MAX = 2_048; // truncate oversized string fields

// ── In-memory rate limiter (per origin, sliding 60-second window) ─────────────
// Each Edge Function instance is isolated, so this limits per-instance, not globally.
// It is sufficient to stop a single origin from flooding a single instance.
const rateLimitMap = new Map<string, number[]>();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_PER_WINDOW = 60;

function isRateLimited(origin: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const timestamps = (rateLimitMap.get(origin) ?? []).filter(t => t > cutoff);
  if (timestamps.length >= RATE_MAX_PER_WINDOW) return true;
  timestamps.push(now);
  rateLimitMap.set(origin, timestamps);
  return false;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function cap(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length > STRING_FIELD_MAX ? s.slice(0, STRING_FIELD_MAX) : s || null;
}

function capInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

type NormalizedReport = {
  document_uri: string | null;
  referrer: string | null;
  blocked_uri: string | null;
  violated_directive: string | null;
  effective_directive: string | null;
  original_policy: string | null;
  disposition: string | null;
  status_code: number | null;
  source_file: string | null;
  line_number: number | null;
  column_number: number | null;
};

function normalizeLevel2(r: Record<string, unknown>): NormalizedReport {
  return {
    document_uri:        cap(r["document-uri"]        ?? r["documentURI"]),
    referrer:            cap(r["referrer"]),
    blocked_uri:         cap(r["blocked-uri"]          ?? r["blockedURI"]),
    violated_directive:  cap(r["violated-directive"]   ?? r["violatedDirective"]),
    effective_directive: cap(r["effective-directive"]  ?? r["effectiveDirective"]),
    original_policy:     cap(r["original-policy"]      ?? r["originalPolicy"]),
    disposition:         cap(r["disposition"]),
    status_code:         capInt(r["status-code"]       ?? r["statusCode"]),
    source_file:         cap(r["source-file"]          ?? r["sourceFile"]),
    line_number:         capInt(r["line-number"]       ?? r["lineNumber"]),
    column_number:       capInt(r["column-number"]     ?? r["columnNumber"]),
  };
}

function normalizeLevel3(b: Record<string, unknown>): NormalizedReport {
  return {
    document_uri:        cap(b["documentURL"]          ?? b["documentUri"]),
    referrer:            cap(b["referrer"]),
    blocked_uri:         cap(b["blockedURL"]           ?? b["blockedUri"]),
    violated_directive:  cap(b["violatedDirective"]),
    effective_directive: cap(b["effectiveDirective"]),
    original_policy:     cap(b["originalPolicy"]),
    disposition:         cap(b["disposition"]),
    status_code:         capInt(b["statusCode"]        ?? b["status"]),
    source_file:         cap(b["sourceFile"]),
    line_number:         capInt(b["lineNumber"]),
    column_number:       capInt(b["columnNumber"]),
  };
}

function hasMinimumFields(r: NormalizedReport): boolean {
  // A legitimate CSP report always has at least one of these
  return !!(r.violated_directive || r.effective_directive || r.blocked_uri);
}

// ── Handler ───────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (req.method !== "POST") return new Response(null, { status: 405 });

  // Rate limit by forwarded IP or CF-connecting IP
  const clientIp =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown";
  if (isRateLimited(clientIp)) {
    return new Response(null, { status: 429 });
  }

  // Reject wrong content types early
  const ct = req.headers.get("content-type") ?? "";
  if (
    !ct.includes("application/csp-report") &&
    !ct.includes("application/reports+json") &&
    !ct.includes("application/json")
  ) {
    return new Response(null, { status: 415 });
  }

  // Read body with size limit
  const reader = req.body?.getReader();
  if (!reader) return new Response(null, { status: 204 });

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BODY_BYTES) {
      console.warn("[csp-report] oversized payload from", clientIp);
      return new Response(null, { status: 413 });
    }
    chunks.push(value);
  }

  const bodyText = new TextDecoder().decode(
    chunks.reduce((acc, c) => {
      const merged = new Uint8Array(acc.length + c.length);
      merged.set(acc);
      merged.set(c, acc.length);
      return merged;
    }, new Uint8Array(0)),
  );

  let rawBody: unknown;
  try {
    rawBody = JSON.parse(bodyText);
  } catch {
    return new Response(null, { status: 204 }); // silent — don't alarm browsers
  }

  // ── Normalise ─────────────────────────────────────────────────────────────
  const normalized: NormalizedReport[] = [];

  if (Array.isArray(rawBody)) {
    // Level 3 report-to format
    const batch = rawBody.slice(0, MAX_REPORTS_PER_BATCH);
    for (const entry of batch as unknown[]) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as any).type === "csp-violation" &&
        typeof (entry as any).body === "object"
      ) {
        const r = normalizeLevel3((entry as any).body as Record<string, unknown>);
        if (hasMinimumFields(r)) normalized.push(r);
      }
    }
  } else if (typeof rawBody === "object" && rawBody !== null) {
    // Level 2 report-uri format
    const obj = rawBody as Record<string, unknown>;
    const inner = obj["csp-report"];
    const source = (typeof inner === "object" && inner !== null)
      ? (inner as Record<string, unknown>)
      : obj;
    const r = normalizeLevel2(source);
    if (hasMinimumFields(r)) normalized.push(r);
  }

  if (normalized.length === 0) return new Response(null, { status: 204 });

  // ── Persist ───────────────────────────────────────────────────────────────
  const supabase = adminClient();

  const rows = normalized.map((r) => ({
    ...r,
    raw_report: rawBody,
  }));

  const { error } = await supabase.from("csp_violations").insert(rows);

  if (error) {
    console.error("[csp-report] DB insert failed:", error.message);
  }

  // Always 204 — never let a DB error cause the browser to retry.
  return new Response(null, { status: 204 });
});
