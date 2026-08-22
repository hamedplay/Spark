import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.111.0";
import {
  Gravity,
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  MagickGeometry,
} from "npm:@imagemagick/magick-wasm@0.0.42";
import { requireFullAuthAccess, deniedResponse } from "../_shared/requireFullAuthAccess.ts";

const wasmBytes = await Deno.readFile(
  new URL(
    "magick.wasm",
    import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.42"),
  ),
);
await initializeImageMagick(wasmBytes);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MULTIPART_OVERHEAD = 64 * 1024;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + MULTIPART_OVERHEAD;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 40_000_000;
const OUTPUT_SIZE = 512;
const OUTPUT_QUALITY = 82;
const QUARANTINE_BUCKET = "avatar-quarantine";
const AVATARS_BUCKET = "avatars";

type DetectedType = { ext: "jpg" | "png" | "webp"; mime: string };

type AdminClient = ReturnType<typeof createClient>;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function detectSignature(buf: Uint8Array): DetectedType | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }
  if (
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
    buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }
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

function containsAscii(bytes: Uint8Array, token: string): boolean {
  const needle = new TextEncoder().encode(token);
  outer: for (let i = 0; i <= bytes.length - needle.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) {
      if (bytes[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
}

function isAnimatedContainer(bytes: Uint8Array, detected: DetectedType): boolean {
  if (detected.ext === "png") return containsAscii(bytes, "acTL");
  if (detected.ext === "webp") {
    return containsAscii(bytes, "ANIM") || containsAscii(bytes, "ANMF");
  }
  return false;
}

function processImage(bytes: Uint8Array): Uint8Array {
  return ImageMagick.read(bytes, (image): Uint8Array => {
    image.autoOrient();

    const width = image.width;
    const height = image.height;
    if (
      width <= 0 || height <= 0 ||
      width > MAX_DIMENSION || height > MAX_DIMENSION ||
      width * height > MAX_PIXELS
    ) {
      throw new Error("IMAGE_DIMENSIONS_REJECTED");
    }

    image.crop(new MagickGeometry("1:1"), Gravity.Center);
    image.resize(OUTPUT_SIZE, OUTPUT_SIZE);
    image.quality = OUTPUT_QUALITY;

    let output: Uint8Array | null = null;
    image.write(MagickFormat.WebP, (data) => {
      output = Uint8Array.from(data);
    });

    if (!output || output.byteLength === 0) {
      throw new Error("IMAGE_ENCODE_FAILED");
    }
    return output;
  });
}

function log(level: "info" | "warn" | "error", fields: Record<string, unknown>) {
  const line = JSON.stringify({ level, ts: new Date().toISOString(), ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

async function removeStorageObject(
  adminClient: AdminClient,
  bucket: string,
  path: string | null | undefined,
): Promise<boolean> {
  if (!path) return true;
  const { error } = await adminClient.storage.from(bucket).remove([path]);
  if (error) return false;
  return true;
}

async function markJobFailed(
  adminClient: AdminClient,
  jobId: string,
  workerId: string,
  reason: string,
): Promise<void> {
  try {
    await adminClient.rpc("fail_avatar_job", {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_error: reason.slice(0, 500),
      p_permanent: true,
    });
  } catch {
    // Best effort only. The request still fails closed.
  }
}

async function finishCleanup(
  adminClient: AdminClient,
  jobId: string,
  quarantinePath: string,
  previousAvatarPath: string | null,
): Promise<void> {
  const oldDeleted = await removeStorageObject(
    adminClient,
    AVATARS_BUCKET,
    previousAvatarPath,
  );
  const quarantineDeleted = await removeStorageObject(
    adminClient,
    QUARANTINE_BUCKET,
    quarantinePath,
  );

  const now = new Date().toISOString();
  const bothDone = oldDeleted && quarantineDeleted;
  const cleanupError = bothDone
    ? null
    : [
      oldDeleted ? null : "old_avatar_delete_failed",
      quarantineDeleted ? null : "quarantine_delete_failed",
    ].filter(Boolean).join(",");

  try {
    await adminClient
      .from("avatar_jobs")
      .update({
        cleanup_status: bothDone ? "completed" : "pending",
        cleanup_worker_id: null,
        cleanup_started_at: null,
        cleanup_heartbeat_at: null,
        cleanup_next_retry_at: null,
        cleanup_last_error: cleanupError,
        old_avatar_deleted_at: previousAvatarPath && oldDeleted ? now : null,
        quarantine_deleted_at: quarantineDeleted ? now : null,
        updated_at: now,
      })
      .eq("id", jobId);
  } catch {
    // Cleanup metadata must never roll back an already committed avatar change.
  }
}

async function cleanupSupersededPendingJobs(
  adminClient: AdminClient,
  userId: string,
  currentJobId: string,
  currentCreatedAt: string | null,
): Promise<void> {
  if (!currentCreatedAt) return;

  const { data: staleJobs, error } = await adminClient
    .from("avatar_jobs")
    .select("id, quarantine_path")
    .eq("user_id", userId)
    .neq("id", currentJobId)
    .in("status", ["pending", "retry_wait"])
    .lt("created_at", currentCreatedAt);

  if (error || !staleJobs?.length) return;

  for (const stale of staleJobs) {
    const deleted = await removeStorageObject(
      adminClient,
      QUARANTINE_BUCKET,
      stale.quarantine_path,
    );
    if (!deleted) continue;

    await adminClient
      .from("avatar_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        next_retry_at: null,
        last_error: "superseded_by_newer_completed_avatar",
        worker_id: null,
        started_at: null,
        heartbeat_at: null,
        quarantine_deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", stale.id)
      .in("status", ["pending", "retry_wait"]);
  }
}

Deno.serve(async (req: Request) => {
  const requestId = crypto.randomUUID();

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authResult = await requireFullAuthAccess(req);
  if (!authResult.ok) return deniedResponse();
  const userId = authResult.userId!;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabasePublicUrl = (Deno.env.get("SUPABASE_PUBLIC_URL") ?? "").replace(/\/+$/, "");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabasePublicUrl || !serviceRoleKey) {
    log("error", { requestId, userId, status: 500, errorCategory: "missing_runtime_config" });
    return json({ error: "Internal error" }, 500);
  }

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

  const targetUserIdRaw = formData.get("target_user_id");
  const targetUserId =
    typeof targetUserIdRaw === "string" && targetUserIdRaw.trim() !== ""
      ? targetUserIdRaw.trim()
      : null;

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    log("warn", { requestId, userId, status: 400, errorCategory: "read_failed" });
    return json({ error: "Could not read file" }, 400);
  }

  if (bytes.byteLength === 0) {
    return json({ error: "File is empty" }, 400);
  }
  if (bytes.byteLength > MAX_FILE_SIZE) {
    return json({ error: "File exceeds 2 MiB limit" }, 413);
  }

  const detected = detectSignature(bytes);
  if (!detected) {
    return json({ error: "Unsupported file type" }, 415);
  }

  const declaredMime = file.type || "";
  if (declaredMime && !declaredMimeAllowed(declaredMime)) {
    return json({ error: "Declared MIME type not allowed" }, 415);
  }
  if (declaredMime && declaredMime !== detected.mime) {
    return json({ error: "File signature does not match declared type" }, 415);
  }
  if (isAnimatedContainer(bytes, detected)) {
    log("warn", { requestId, userId, status: 415, errorCategory: "animated_image_rejected", detected: detected.mime });
    return json({ error: "Animated images are not allowed" }, 415);
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let effectiveUserId = userId;
  if (targetUserId && targetUserId !== userId) {
    const { data: callerProfile } = await adminClient
      .from("profiles")
      .select("is_admin")
      .eq("user_id", userId)
      .maybeSingle();
    if (!callerProfile || callerProfile.is_admin !== true) {
      return json({ error: "Forbidden" }, 403);
    }

    const { data: targetProfile } = await adminClient
      .from("profiles")
      .select("user_id")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (!targetProfile) {
      return json({ error: "Target user not found" }, 404);
    }
    effectiveUserId = targetUserId;
  }

  const jobFileId = crypto.randomUUID();
  const safePath = `${effectiveUserId}/${jobFileId}.${detected.ext}`;
  if (safePath.includes("..") || !safePath.startsWith(`${effectiveUserId}/`)) {
    return json({ error: "Internal error" }, 500);
  }

  const uploadResult = await adminClient.storage
    .from(QUARANTINE_BUCKET)
    .upload(safePath, bytes, {
      contentType: detected.mime,
      upsert: false,
    });

  if (uploadResult.error || !uploadResult.data) {
    log("error", { requestId, userId, status: 500, errorCategory: "storage_upload_failed", path: safePath });
    return json({ error: "Storage failure" }, 500);
  }

  const { data: jobRows, error: jobErr } = await adminClient.rpc("create_avatar_job", {
    p_user_id: effectiveUserId,
    p_quarantine_path: safePath,
  });

  const jobRow = Array.isArray(jobRows) ? jobRows[0] : jobRows;
  if (jobErr || !jobRow?.id) {
    await removeStorageObject(adminClient, QUARANTINE_BUCKET, safePath);
    log("error", { requestId, userId, status: 500, errorCategory: "job_create_failed", path: safePath });
    return json({ error: "Job creation failed" }, 500);
  }

  const jobId = jobRow.id as string;
  const workerId = `edge-avatar-upload:${requestId}`;

  const { data: claimRows, error: claimErr } = await adminClient.rpc(
    "claim_avatar_job_by_id_v1",
    { p_job_id: jobId, p_worker_id: workerId },
  );
  const claimed = Array.isArray(claimRows) ? claimRows[0] : claimRows;
  if (claimErr || !claimed?.id || claimed.id !== jobId) {
    await removeStorageObject(adminClient, QUARANTINE_BUCKET, safePath);
    await adminClient
      .from("avatar_jobs")
      .update({
        status: "failed",
        completed_at: new Date().toISOString(),
        last_error: "synchronous_claim_failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", jobId)
      .eq("status", "pending");
    log("error", { requestId, userId, jobId, status: 500, errorCategory: "job_claim_failed" });
    return json({ error: "Image processing unavailable" }, 500);
  }

  let processed: Uint8Array;
  try {
    processed = processImage(bytes);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "image_processing_failed";
    await markJobFailed(adminClient, jobId, workerId, reason);
    await removeStorageObject(adminClient, QUARANTINE_BUCKET, safePath);
    log("warn", { requestId, userId, jobId, status: 422, errorCategory: "image_processing_failed", reason });
    return json({ error: "Image could not be processed" }, 422);
  }

  const outputPath = `${effectiveUserId}/${jobId}.webp`;
  const { error: outputErr } = await adminClient.storage
    .from(AVATARS_BUCKET)
    .upload(outputPath, processed, {
      contentType: "image/webp",
      cacheControl: "3600",
      upsert: false,
    });

  if (outputErr) {
    await markJobFailed(adminClient, jobId, workerId, "avatar_output_upload_failed");
    await removeStorageObject(adminClient, QUARANTINE_BUCKET, safePath);
    log("error", { requestId, userId, jobId, status: 500, errorCategory: "output_upload_failed" });
    return json({ error: "Image processing unavailable" }, 500);
  }

  const avatarUrl = `${supabasePublicUrl}/storage/v1/object/public/${AVATARS_BUCKET}/${outputPath}`;

  const { data: completeRows, error: completeErr } = await adminClient.rpc(
    "complete_avatar_job",
    {
      p_job_id: jobId,
      p_worker_id: workerId,
      p_output_path: outputPath,
      p_avatar_url: avatarUrl,
    },
  );

  if (completeErr) {
    await removeStorageObject(adminClient, AVATARS_BUCKET, outputPath);
    await markJobFailed(adminClient, jobId, workerId, "avatar_profile_commit_failed");
    await removeStorageObject(adminClient, QUARANTINE_BUCKET, safePath);
    log("error", { requestId, userId, jobId, status: 500, errorCategory: "profile_commit_failed" });
    return json({ error: "Profile update failed" }, 500);
  }

  const completeRow = Array.isArray(completeRows) ? completeRows[0] : completeRows;
  const previousAvatarPath = typeof completeRow?.previous_avatar_path === "string"
    ? completeRow.previous_avatar_path
    : null;

  await finishCleanup(adminClient, jobId, safePath, previousAvatarPath);
  await cleanupSupersededPendingJobs(
    adminClient,
    effectiveUserId,
    jobId,
    typeof jobRow.created_at === "string" ? jobRow.created_at : null,
  );

  log("info", {
    requestId,
    userId,
    effectiveUserId,
    status: 200,
    detectedType: detected.mime,
    inputBytes: bytes.byteLength,
    outputBytes: processed.byteLength,
    jobId,
  });

  return json({
    job_id: jobId,
    status: "completed",
    avatar_url: avatarUrl,
  }, 200);
});
