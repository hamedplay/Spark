import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.112.3";

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
const RATE_MAX_ORIGINS = 10_000;

function isRateLimited(origin: string): boolean {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;
  const timestamps = (rateLimitMap.get(origin) ?? []).filter(t => t > cutoff);
  if (timestamps.length >= RATE_MAX_PER_WINDOW) return true;
  timestamps.push(now);
  rateLimitMap.set(origin, timestamps);

  // Bound memory if an attacker rotates source addresses aggressively.
  if (rateLimitMap.size > RATE_MAX_ORIGINS) {
    for (const [key, values] of rateLimitMap) {
      if (values.every(t => t <= cutoff)) rateLimitMap.delete(key);
    }
    if (rateLimitMap.size > RATE_MAX_ORIGINS) rateLimitMap.clear();
  }

  return false;
}

// ── Short-lived duplicate suppression ────────────────────────────────────────
// Browsers can emit the same violation on every repeated request. Persisting one
// identical report every few minutes is enough for diagnostics and prevents a
// single broken client/build from creating hundreds of thousands of rows.
const DEDUPE_WINDOW_MS = 5 * 60_000;
const DEDUPE_MAX_ENTRIES = 5_000;
const dedupeMap = new Map<string, number>();

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

const VOLATILE_OR_SENSITIVE_QUERY_PARAMS = new Set([
  "apikey",
  "access_token",
  "refresh_token",
  "token",
  "key",
  "secret",
  "signature",
  "sig",
  "code",
  "t",
  "ts",
  "_",
  "cachebust",
  "cache_bust",
]);

function normalizeUrlLike(v: unknown): string | null {
  const s = cap(v);
  if (!s) return null;

  try {
    const url = new URL(s);
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return s;

    const keysToDelete: string[] = [];
    for (const key of url.searchParams.keys()) {
      if (VOLATILE_OR_SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) url.searchParams.delete(key);
    return cap(url.toString());
  } catch {
    return s;
  }
}

function sanitizeRawReport(raw: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = { ...raw };
  const urlFields = [
    "document-uri",
    "documentURI",
    "documentURL",
    "documentUri",
    "blocked-uri",
    "blockedURI",
    "blockedURL",
    "blockedUri",
    "source-file",
    "sourceFile",
  ];

  for (const field of urlFields) {
    if (field in sanitized) sanitized[field] = normalizeUrlLike(sanitized[field]);
  }

  return sanitized;
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

type PendingReport = {
  normalized: NormalizedReport;
  raw: Record<string, unknown>;
};

function normalizeLevel2(r: Record<string, unknown>): NormalizedReport {
  return {
    document_uri:        normalizeUrlLike(r["document-uri"]        ?? r["documentURI"]),
    referrer:            normalizeUrlLike(r["referrer"]),
    blocked_uri:         normalizeUrlLike(r["blocked-uri"]          ?? r["blockedURI"]),
    violated_directive:  cap(r["violated-directive"]   ?? r["violatedDirective"]),
    effective_directive: cap(r["effective-directive"]  ?? r["effectiveDirective"]),
    original_policy:     cap(r["original-policy"]      ?? r["originalPolicy"]),
    disposition:         cap(r["disposition"]),
    status_code:         capInt(r["status-code"]       ?? r["statusCode"]),
    source_file:         normalizeUrlLike(r["source-file"]          ?? r["sourceFile"]),
    line_number:         capInt(r["line-number"]       ?? r["lineNumber"]),
    column_number:       capInt(r["column-number"]     ?? r["columnNumber"]),
  };
}

function normalizeLevel3(b: Record<string, unknown>): NormalizedReport {
  return {
    document_uri:        normalizeUrlLike(b["documentURL"]          ?? b["documentUri"]),
    referrer:            normalizeUrlLike(b["referrer"]),
    blocked_uri:         normalizeUrlLike(b["blockedURL"]           ?? b["blockedUri"]),
    violated_directive:  cap(b["violatedDirective"]),
    effective_directive: cap(b["effectiveDirective"]),
    original_policy:     cap(b["originalPolicy"]),
    disposition:         cap(b["disposition"]),
    status_code:         capInt(b["statusCode"]        ?? b["status"]),
    source_file:         normalizeUrlLike(b["sourceFile"]),
    line_number:         capInt(b["lineNumber"]),
    column_number:       capInt(b["columnNumber"]),
  };
}

function hasMinimumFields(r: NormalizedReport): boolean {
  // A legitimate CSP report always has at least one of these
  return !!(r.violated_directive || r.effective_directive || r.blocked_uri);
}

function reportFingerprint(r: NormalizedReport): string {
  return [
    r.effective_directive ?? r.violated_directive ?? "",
    r.blocked_uri ?? "",
    r.document_uri ?? "",
    r.source_file ?? "",
    r.line_number?.toString() ?? "",
    r.column_number?.toString() ?? "",
  ].join("\u001f");
}

function shouldPersistReport(r: NormalizedReport): boolean {
  const now = Date.now();
  const cutoff = now - DEDUPE_WINDOW_MS;

  if (dedupeMap.size >= DEDUPE_MAX_ENTRIES) {
    for (const [key, lastPersistedAt] of dedupeMap) {
      if (lastPersistedAt <= cutoff) dedupeMap.delete(key);
    }
    // Keep memory bounded even under a distributed high-cardinality flood.
    if (dedupeMap.size >= DEDUPE_MAX_ENTRIES) dedupeMap.clear();
  }

  const fingerprint = reportFingerprint(r);
  const lastPersistedAt = dedupeMap.get(fingerprint);
  if (lastPersistedAt != null && lastPersistedAt > cutoff) return false;

  dedupeMap.set(fingerprint, now);
  return true;
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
  const pending: PendingReport[] = [];

  if (Array.isArray(rawBody)) {
    // Level 3 report-to format
    const batch = rawBody.slice(0, MAX_REPORTS_PER_BATCH);
    for (const entry of batch as unknown[]) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        (entry as any).type === "csp-violation" &&
        typeof (entry as any).body === "object" &&
        (entry as any).body !== null
      ) {
        const raw = (entry as any).body as Record<string, unknown>;
        const normalized = normalizeLevel3(raw);
        if (hasMinimumFields(normalized)) {
          pending.push({ normalized, raw: sanitizeRawReport(raw) });
        }
      }
    }
  } else if (typeof rawBody === "object" && rawBody !== null) {
    // Level 2 report-uri format
    const obj = rawBody as Record<string, unknown>;
    const inner = obj["csp-report"];
    const source = (typeof inner === "object" && inner !== null)
      ? (inner as Record<string, unknown>)
      : obj;
    const normalized = normalizeLevel2(source);
    if (hasMinimumFields(normalized)) {
      pending.push({ normalized, raw: sanitizeRawReport(source) });
    }
  }

  if (pending.length === 0) return new Response(null, { status: 204 });

  // Suppress identical reports for a short window. Continuous violations are
  // still sampled periodically, so first_seen/last_seen diagnostics remain useful.
  const persistable = pending.filter(({ normalized }) => shouldPersistReport(normalized));
  if (persistable.length === 0) return new Response(null, { status: 204 });

  // ── Persist ───────────────────────────────────────────────────────────────
  const supabase = adminClient();

  // For Reporting API batches, keep only each report's own body instead of
  // copying the entire batch into raw_report for every row.
  const rows = persistable.map(({ normalized, raw }) => ({
    ...normalized,
    raw_report: raw,
  }));

  const { error } = await supabase.from("csp_violations").insert(rows);

  if (error) {
    console.error("[csp-report] DB insert failed:", error.message);
  }

  // Always 204 — never let a DB error cause the browser to retry.
  return new Response(null, { status: 204 });
});
