import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

// CSP violation reports are sent by browsers with no Authorization header.
// This function is intentionally public (verify_jwt: false).
// It uses the service-role key only for inserting into the violations table.

const CORS_HEADERS = {
  // Browsers send violation reports as same-origin requests from the page;
  // no CORS response headers are needed, but a 2xx status must be returned.
  "Content-Type": "application/json",
};

function adminClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

Deno.serve(async (req: Request) => {
  // Browsers may pre-flight; respond immediately.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  // Only accept POST (CSP report delivery method).
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  // Browsers send CSP reports as:
  //   Content-Type: application/csp-report   (CSP Level 2 / report-uri)
  //   Content-Type: application/reports+json (CSP Level 3 / report-to)
  //   Content-Type: application/json         (some proxies)
  const ct = req.headers.get("content-type") ?? "";
  if (
    !ct.includes("application/csp-report") &&
    !ct.includes("application/reports+json") &&
    !ct.includes("application/json")
  ) {
    return new Response(JSON.stringify({ error: "Unsupported content type" }), {
      status: 415,
      headers: CORS_HEADERS,
    });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  // ── Normalise both report formats ─────────────────────────────────────────
  // CSP Level 2 (report-uri): { "csp-report": { ... } }
  // CSP Level 3 (report-to):  [ { "type": "csp-violation", "body": { ... } } ]

  type CspReportBody = {
    document_uri?: string;
    referrer?: string;
    blocked_uri?: string;
    violated_directive?: string;
    effective_directive?: string;
    original_policy?: string;
    disposition?: string;
    status_code?: number;
    source_file?: string;
    line_number?: number;
    column_number?: number;
  };

  const reports: CspReportBody[] = [];

  if (Array.isArray(rawBody)) {
    // report-to format: array of Report objects
    for (const entry of rawBody as any[]) {
      if (entry?.type === "csp-violation" && entry?.body) {
        const b = entry.body;
        reports.push({
          document_uri:        b.documentURL      ?? b.documentUri      ?? undefined,
          referrer:            b.referrer                                ?? undefined,
          blocked_uri:         b.blockedURL        ?? b.blockedUri       ?? undefined,
          violated_directive:  b.violatedDirective                       ?? undefined,
          effective_directive: b.effectiveDirective                      ?? undefined,
          original_policy:     b.originalPolicy                          ?? undefined,
          disposition:         b.disposition                             ?? undefined,
          status_code:         b.statusCode        ?? b.status           ?? undefined,
          source_file:         b.sourceFile                              ?? undefined,
          line_number:         b.lineNumber                              ?? undefined,
          column_number:       b.columnNumber                            ?? undefined,
        });
      }
    }
  } else if (typeof rawBody === "object" && rawBody !== null) {
    // report-uri format: single object with "csp-report" key
    const r = (rawBody as any)["csp-report"] ?? rawBody;
    reports.push({
      document_uri:        r["document-uri"]         ?? r.documentURI         ?? undefined,
      referrer:            r["referrer"]                                       ?? undefined,
      blocked_uri:         r["blocked-uri"]           ?? r.blockedURI         ?? undefined,
      violated_directive:  r["violated-directive"]    ?? r.violatedDirective   ?? undefined,
      effective_directive: r["effective-directive"]   ?? r.effectiveDirective  ?? undefined,
      original_policy:     r["original-policy"]       ?? r.originalPolicy      ?? undefined,
      disposition:         r["disposition"]                                     ?? undefined,
      status_code:         r["status-code"]           ?? r.statusCode          ?? undefined,
      source_file:         r["source-file"]           ?? r.sourceFile          ?? undefined,
      line_number:         r["line-number"]           ?? r.lineNumber          ?? undefined,
      column_number:       r["column-number"]         ?? r.columnNumber        ?? undefined,
    });
  }

  if (reports.length === 0) {
    // Nothing recognisable — accept silently (don't alarm browsers).
    return new Response(JSON.stringify({ ok: true }), {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // ── Persist to DB ──────────────────────────────────────────────────────────
  const supabase = adminClient();

  const rows = reports.map((r) => ({
    document_uri:        r.document_uri        ?? null,
    referrer:            r.referrer            ?? null,
    blocked_uri:         r.blocked_uri         ?? null,
    violated_directive:  r.violated_directive  ?? null,
    effective_directive: r.effective_directive ?? null,
    original_policy:     r.original_policy     ?? null,
    disposition:         r.disposition         ?? null,
    status_code:         r.status_code         ?? null,
    source_file:         r.source_file         ?? null,
    line_number:         r.line_number         ?? null,
    column_number:       r.column_number       ?? null,
    raw_report:          rawBody,
  }));

  const { error } = await supabase.from("csp_violations").insert(rows);

  if (error) {
    console.error("[csp-report] DB insert failed:", error.message);
    // Still return 2xx — we don't want the browser to retry endlessly.
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  // 204 No Content is the conventional response for CSP report endpoints.
  return new Response(null, { status: 204 });
});
