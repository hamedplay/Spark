import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MiB — real file ceiling
const MULTIPART_OVERHEAD = 64 * 1024; // 64 KiB allowance for multipart framing
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + MULTIPART_OVERHEAD; // preliminary Content-Length ceiling
const QUARANTINE_BUCKET = "avatar-quarantine";

type DetectedType = { ext: "jpg" | "png" | "webp"; mime: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function detectSignature(buf: Uint8Array): DetectedType | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }
  // WebP: RIFF .... WEBP
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return { ext: "webp", mime: "image/webp" };
  }
  return null;
}

function declaredMimeAllowed(mime: string | null): boolean {
  return mime === "image/jpeg" || mime === "image/png" || mime === "image/webp";
}

function log(level: "info" | "warn" | "error", fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // ── 1. JWT validation ────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    log("warn", { requestId, status: 401, errorCategory: "missing_auth" });
    return json({ error: "Unauthorized" }, 401);
  }
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) {
    log("warn", { requestId, status: 401, errorCategory: "empty_token" });
    return json({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // Public client for user auth verification (no service role)
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const authClient = createClient(supabaseUrl, anonKey);

  let userId: string;
  try {
    const { data, error } = await authClient.auth.getUser(token);
    if (error || !data?.user) {
      log("warn", { requestId, status: 401, errorCategory: "invalid_jwt" });
      return json({ error: "Unauthorized" }, 401);
    }
    userId = data.user.id;
  } catch {
    log("warn", { requestId, status: 401, errorCategory: "auth_exception" });
    return json({ error: "Unauthorized" }, 401);
  }

  // ── 2. Receive file (multipart/form-data) ─────────────────────────────────
  // Preliminary Content-Length check: allow 2 MiB file + 64 KiB multipart overhead.
  // This is NOT the final authority — the real file size is checked after reading.
  const contentLengthHeader = req.headers.get("Content-Length");
  if (contentLengthHeader) {
    const declaredLen = parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(declaredLen) && declaredLen > MAX_REQUEST_SIZE) {
      log("warn", { requestId, userId, status: 413, errorCategory: "content_length_exceeded", declaredLen });
      return json({ error: "Request exceeds size limit" }, 413);
    }
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    log("warn", { requestId, userId, status: 400, errorCategory: "invalid_form" });
    return json({ error: "Invalid form data" }, 400);
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    log("warn", { requestId, userId, status: 400, errorCategory: "no_file" });
    return json({ error: "File field is required" }, 400);
  }

  // Optional target_user_id: when an admin uploads on behalf of another user.
  // Empty string or null means self-upload (existing behavior).
  const targetUserIdRaw = formData.get("target_user_id");
  const targetUserId =
    typeof targetUserIdRaw === "string" && targetUserIdRaw.trim() !== ""
      ? targetUserIdRaw.trim()
      : null;

  // ── 3. Real size check (Content-Length is only preliminary) ───────────────
  let bytes: Uint8Array;
  try {
    const ab = await file.arrayBuffer();
    bytes = new Uint8Array(ab);
  } catch {
    log("warn", { requestId, userId, status: 400, errorCategory: "read_failed" });
    return json({ error: "Could not read file" }, 400);
  }

  if (bytes.byteLength === 0) {
    log("warn", { requestId, userId, status: 400, errorCategory: "empty_file", fileSize: 0 });
    return json({ error: "File is empty" }, 400);
  }
  if (bytes.byteLength > MAX_FILE_SIZE) {
    log("warn", { requestId, userId, status: 413, errorCategory: "too_large", fileSize: bytes.byteLength });
    return json({ error: "File exceeds 2 MiB limit" }, 413);
  }

  // ── 4. Signature detection (magic bytes) ──────────────────────────────────
  const detected = detectSignature(bytes);
  if (!detected) {
    log("warn", { requestId, userId, status: 415, errorCategory: "unknown_signature", fileSize: bytes.byteLength });
    return json({ error: "Unsupported file type" }, 415);
  }

  // Declared MIME (UX hint) must be compatible with detected signature
  const declaredMime = file.type || "";
  if (declaredMime && !declaredMimeAllowed(declaredMime)) {
    log("warn", { requestId, userId, status: 415, errorCategory: "declared_mime_rejected", declaredMime, detected: detected.mime, fileSize: bytes.byteLength });
    return json({ error: "Declared MIME type not allowed" }, 415);
  }
  if (declaredMime && declaredMime !== detected.mime) {
    log("warn", { requestId, userId, status: 415, errorCategory: "mime_signature_mismatch", declaredMime, detected: detected.mime, fileSize: bytes.byteLength });
    return json({ error: "File signature does not match declared type" }, 415);
  }

  // ── 4b. Admin authorization for cross-user upload ──────────────────────────
  // When targetUserId is provided and differs from the caller, verify the
  // caller is an admin and the target user exists. All checks are server-side.
  let effectiveUserId = userId;
  if (targetUserId && targetUserId !== userId) {
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("user_id", userId)
      .maybeSingle();
    if (!callerProfile || callerProfile.is_admin !== true) {
      log("warn", { requestId, userId, targetUserId, status: 403, errorCategory: "not_admin" });
      return json({ error: "Forbidden" }, 403);
    }
    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("user_id")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (!targetProfile) {
      log("warn", { requestId, userId, targetUserId, status: 404, errorCategory: "target_not_found" });
      return json({ error: "Target user not found" }, 404);
    }
    effectiveUserId = targetUserId;
  }

  // ── 5. Generate safe storage path ─────────────────────────────────────────
  // {effective_user_id}/{uuid}.{ext}  — never use the user's filename, never allow ".."
  const jobFileId = crypto.randomUUID();
  const safePath = `${effectiveUserId}/${jobFileId}.${detected.ext}`;
  if (safePath.includes("..") || !safePath.startsWith(`${effectiveUserId}/`)) {
    log("error", { requestId, userId, effectiveUserId, status: 500, errorCategory: "path_safety_failed" });
    return json({ error: "Internal error" }, 500);
  }

  // ── 6. Upload to private quarantine bucket with service role ──────────────
  const adminClient = createClient(supabaseUrl, serviceRoleKey);

  const uploadResult = await adminClient.storage
    .from(QUARANTINE_BUCKET)
    .upload(safePath, bytes, {
      contentType: detected.mime,
      upsert: false,
    });

  if (uploadResult.error || !uploadResult.data) {
    log("error", { requestId, userId, status: 500, errorCategory: "storage_upload_failed", path: safePath, fileSize: bytes.byteLength, detected: detected.mime });
    return json({ error: "Storage failure" }, 500);
  }

  // ── 7. Create avatar job via RPC ───────────────────────────────────────────
  const { data: jobRows, error: jobErr } = await adminClient.rpc("create_avatar_job", {
    p_user_id: effectiveUserId,
    p_quarantine_path: safePath,
  });

  // ── 8. Rollback on job creation failure ─────────────────────────────────────
  const jobRow = Array.isArray(jobRows) ? jobRows[0] : jobRows;
  if (jobErr || !jobRow || !jobRow.id) {
    log("error", { requestId, userId, status: 500, errorCategory: "job_create_failed", path: safePath });
    // Best-effort cleanup of the freshly-uploaded quarantine file
    try {
      await adminClient.storage.from(QUARANTINE_BUCKET).remove([safePath]);
    } catch {
      log("error", { requestId, userId, errorCategory: "rollback_failed", path: safePath });
    }
    return json({ error: "Job creation failed" }, 500);
  }

  const jobId = jobRow.id as string;

  log("info", { requestId, userId, status: 200, detectedType: detected.mime, fileSize: bytes.byteLength, jobId });

  // ── 9. Success response (no quarantine_path exposed) ───────────────────────
  return json({ job_id: jobId, status: "pending" }, 200);
});
