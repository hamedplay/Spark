import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import fs from "node:fs";

const WORKER_ID = process.env.AVATAR_WORKER_ID || `worker-${crypto.randomUUID().slice(0, 8)}`;

let supabase = null;

function getClient() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  }
  supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return supabase;
}

const QUARANTINE_BUCKET = "avatar-quarantine";
const AVATARS_BUCKET = "avatars";

const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 30000;
const RECLAIM_INTERVAL_MS = 60000;
const CLEANUP_POLL_INTERVAL_MS = 10000;
const CLEANUP_HEARTBEAT_INTERVAL_MS = 30000;
const CLEANUP_RECLAIM_INTERVAL_MS = 60000;

const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_DIMENSION = 8192;
const MAX_PIXELS = 40000000;
const OUTPUT_SIZE = 512;
const OUTPUT_QUALITY = 82;

let lastPollAt = 0;
let shuttingDown = false;
const HEALTH_FILE = "/tmp/worker-health";

function writeHealth() {
  try {
    fs.writeFileSync(HEALTH_FILE, String(Date.now()));
  } catch {
    // tmpfs might not be ready yet; ignore
  }
}

function log(level, event, fields = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    worker_id: WORKER_ID,
    event,
    ...fields,
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function classifyError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  if (
    msg.includes("decode") ||
    msg.includes("unsupported") ||
    msg.includes("dimensions") ||
    msg.includes("pixel") ||
    msg.includes("exceed") ||
    msg.includes("animated") ||
    msg.includes("multipage") ||
    msg.includes("invalid") ||
    msg.includes("format") ||
    msg.includes("vips") ||
    msg.includes("sharp")
  ) {
    return { permanent: true, category: "permanent_image" };
  }
  if (
    msg.includes("timeout") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound") ||
    msg.includes("econnrefused") ||
    msg.includes("fetch") ||
    msg.includes("network") ||
    msg.includes("5") && /status|response|http/.test(msg)
  ) {
    return { permanent: false, category: "transient_network" };
  }
  return { permanent: false, category: "transient_unknown" };
}

async function downloadQuarantineFile(path) {
  const { data, error } = await getClient().storage
    .from(QUARANTINE_BUCKET)
    .download(path);
  if (error) throw error;
  if (!data) throw new Error("download returned no data");
  const buf = Buffer.from(await data.arrayBuffer());
  return buf;
}

async function processImage(buf) {
  if (buf.byteLength > MAX_FILE_SIZE) {
    throw new Error("file exceeds 2 MiB limit");
  }

  const meta = await sharp(buf, { limitInputPixels: MAX_PIXELS, animated: false }).metadata();

  // Check for animated/multipage: load with animated:true to detect pages
  let animatedMeta = meta;
  try {
    animatedMeta = await sharp(buf, { limitInputPixels: MAX_PIXELS, animated: true }).metadata();
  } catch {
    // If animated loading fails, use the non-animated metadata
  }
  if (animatedMeta.pages && animatedMeta.pages > 1) {
    throw new Error("animated/multipage image rejected");
  }
  if (meta.width && meta.width > MAX_DIMENSION) {
    throw new Error(`dimensions ${meta.width}x${meta.height || "?"} exceed max ${MAX_DIMENSION}`);
  }
  if (meta.height && meta.height > MAX_DIMENSION) {
    throw new Error(`dimensions ${meta.width || "?"}x${meta.height} exceed max ${MAX_DIMENSION}`);
  }
  if (meta.width && meta.height && meta.width * meta.height > MAX_PIXELS) {
    throw new Error(`pixels ${meta.width * meta.height} exceed max ${MAX_PIXELS}`);
  }

  const processed = await sharp(buf, { limitInputPixels: MAX_PIXELS })
    .rotate()
    .resize(OUTPUT_SIZE, OUTPUT_SIZE, { fit: "cover", position: "centre" })
    .webp({ quality: OUTPUT_QUALITY })
    .toBuffer();

  return processed;
}

async function uploadOutput(userId, jobId, buf) {
  const outputPath = `${userId}/${jobId}.webp`;
  const { error } = await getClient().storage
    .from(AVATARS_BUCKET)
    .upload(outputPath, buf, {
      contentType: "image/webp",
      upsert: false,
      cacheControl: "3600",
    });
  if (error) throw error;
  return outputPath;
}

function getPublicUrl(path) {
  const { data } = getClient().storage.from(AVATARS_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function deleteStorageFile(bucket, path) {
  const { error } = await getClient().storage.from(bucket).remove([path]);
  if (error) {
    if (String(error.message || "").includes("not found") || String(error.message || "").includes("404")) {
      return { deleted: true, notFound: true };
    }
    throw error;
  }
  return { deleted: true, notFound: false };
}

async function processJob(job) {
  const { id: jobId, user_id: userId, quarantine_path: quarantinePath } = job;
  const start = Date.now();

  log("info", "job_started", { job_id: jobId, user_id: userId });

  const heartbeat = setInterval(async () => {
    try {
      await getClient().rpc("heartbeat_avatar_job", {
        p_job_id: jobId,
        p_worker_id: WORKER_ID,
      });
    } catch {
      log("warn", "heartbeat_failed", { job_id: jobId, error_category: "transient" });
    }
  }, HEARTBEAT_INTERVAL_MS);

  try {
    const buf = await downloadQuarantineFile(quarantinePath);
    log("info", "quarantine_downloaded", { job_id: jobId, size_bytes: buf.byteLength });

    const processed = await processImage(buf);
    log("info", "image_processed", { job_id: jobId, output_bytes: processed.byteLength });

    const outputPath = await uploadOutput(userId, jobId, processed);
    const avatarUrl = getPublicUrl(outputPath);
    log("info", "output_uploaded", { job_id: jobId, output_path: outputPath });

    let completeErr = null;
    let completeResult = null;
    try {
      const res = await getClient().rpc("complete_avatar_job", {
        p_job_id: jobId,
        p_worker_id: WORKER_ID,
        p_output_path: outputPath,
        p_avatar_url: avatarUrl,
      });
      completeResult = res.data;
      completeErr = res.error;
    } catch (e) {
      completeErr = e;
    }

    if (completeErr) {
      log("warn", "complete_failed_rolling_back", { job_id: jobId, error_category: classifyError(completeErr).category });
      try {
        await deleteStorageFile(AVATARS_BUCKET, outputPath);
        log("info", "orphan_output_deleted", { job_id: jobId });
      } catch (delErr) {
        log("error", "orphan_output_delete_failed", { job_id: jobId, error_category: classifyError(delErr).category });
      }
      throw completeErr;
    }

    const row = Array.isArray(completeResult) ? completeResult[0] : completeResult;
    const previousAvatarPath = row?.previous_avatar_path || null;

    log("info", "job_completed", {
      job_id: jobId,
      duration_ms: Date.now() - start,
      previous_avatar_path: previousAvatarPath ? "[set]" : null,
    });

    return { success: true, previousAvatarPath, outputPath, quarantinePath };
  } finally {
    clearInterval(heartbeat);
  }
}

async function failJob(jobId, error, permanent) {
  const cls = classifyError(error);
  const isPermanent = permanent ?? cls.permanent;
  try {
    const { error: rpcErr } = await getClient().rpc("fail_avatar_job", {
      p_job_id: jobId,
      p_worker_id: WORKER_ID,
      p_error: String(error?.message || error || "unknown error").slice(0, 500),
      p_permanent: isPermanent,
    });
    if (rpcErr) throw rpcErr;
    log("warn", "job_failed", {
      job_id: jobId,
      permanent: isPermanent,
      error_category: cls.category,
    });
  } catch (failErr) {
    log("error", "fail_rpc_error", {
      job_id: jobId,
      error_category: "fail_rpc",
      detail: String(failErr?.message || failErr).slice(0, 200),
    });
  }
}

async function pollAndProcess() {
  if (shuttingDown) return;

  try {
    const { data, error } = await getClient().rpc("claim_next_avatar_job", {
      p_worker_id: WORKER_ID,
    });

    if (error) throw error;
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) {
      lastPollAt = Date.now();
      writeHealth();
      return;
    }

    try {
      await processJob(job);
    } catch (err) {
      await failJob(job.id, err);
    }
    lastPollAt = Date.now();
    writeHealth();
  } catch (err) {
    log("error", "poll_error", { error_category: classifyError(err).category });
  }
}

async function processCleanupJob(job) {
  const {
    id: jobId,
    user_id: userId,
    previous_avatar_path: previousAvatarPath,
    quarantine_path: quarantinePath,
    output_path: outputPath,
  } = job;
  const start = Date.now();

  log("info", "cleanup_started", { job_id: jobId, user_id: userId });

  const heartbeat = setInterval(async () => {
    try {
      await getClient().rpc("heartbeat_avatar_cleanup_job", {
        p_job_id: jobId,
        p_cleanup_worker_id: WORKER_ID,
      });
    } catch {
      log("warn", "cleanup_heartbeat_failed", { job_id: jobId, error_category: "transient" });
    }
  }, CLEANUP_HEARTBEAT_INTERVAL_MS);

  let oldDeleted = false;
  let quarDeleted = false;

  try {
    if (previousAvatarPath) {
      try {
        const res = await deleteStorageFile(AVATARS_BUCKET, previousAvatarPath);
        oldDeleted = true;
        log("info", "old_avatar_deleted", {
          job_id: jobId,
          not_found: res.notFound,
        });
        const { error: markErr } = await getClient().rpc("mark_avatar_cleanup_progress", {
          p_job_id: jobId,
          p_cleanup_worker_id: WORKER_ID,
          p_old_deleted: true,
          p_quarantine_deleted: false,
        });
        if (markErr) throw markErr;
      } catch (err) {
        const cls = classifyError(err);
        log("warn", "old_avatar_delete_failed", {
          job_id: jobId,
          error_category: cls.category,
        });
        if (cls.permanent) {
          await failCleanupJob(jobId, `old_avatar: ${String(err).slice(0, 200)}`, true);
          return;
        } else {
          await failCleanupJob(jobId, `old_avatar: ${String(err).slice(0, 200)}`, false);
          return;
        }
      }
    } else {
      oldDeleted = true;
    }

    if (quarantinePath) {
      try {
        const res = await deleteStorageFile(QUARANTINE_BUCKET, quarantinePath);
        quarDeleted = true;
        log("info", "quarantine_deleted", {
          job_id: jobId,
          not_found: res.notFound,
        });
        const { error: markErr } = await getClient().rpc("mark_avatar_cleanup_progress", {
          p_job_id: jobId,
          p_cleanup_worker_id: WORKER_ID,
          p_old_deleted: oldDeleted,
          p_quarantine_deleted: true,
        });
        if (markErr) throw markErr;
      } catch (err) {
        const cls = classifyError(err);
        log("warn", "quarantine_delete_failed", {
          job_id: jobId,
          error_category: cls.category,
        });
        if (cls.permanent) {
          await failCleanupJob(jobId, `quarantine: ${String(err).slice(0, 200)}`, true);
          return;
        } else {
          await failCleanupJob(jobId, `quarantine: ${String(err).slice(0, 200)}`, false);
          return;
        }
      }
    } else {
      quarDeleted = true;
    }

    log("info", "cleanup_completed", {
      job_id: jobId,
      duration_ms: Date.now() - start,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

async function failCleanupJob(jobId, error, permanent) {
  try {
    const { error: rpcErr } = await getClient().rpc("fail_avatar_cleanup_job", {
      p_job_id: jobId,
      p_cleanup_worker_id: WORKER_ID,
      p_error: String(error).slice(0, 500),
      p_permanent: permanent,
    });
    if (rpcErr) throw rpcErr;
    log("warn", "cleanup_failed", { job_id: jobId, permanent, error_category: permanent ? "permanent" : "transient" });
  } catch (failErr) {
    log("error", "cleanup_fail_rpc_error", {
      job_id: jobId,
      error_category: "fail_rpc",
      detail: String(failErr?.message || failErr).slice(0, 200),
    });
  }
}

async function pollAndCleanup() {
  if (shuttingDown) return;

  try {
    const { data, error } = await getClient().rpc("claim_avatar_cleanup_job", {
      p_cleanup_worker_id: WORKER_ID,
    });
    if (error) throw error;
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) return;

    await processCleanupJob(job);
  } catch (err) {
    log("error", "cleanup_poll_error", { error_category: classifyError(err).category });
  }
}

async function reclaimJobs() {
  try {
    const { error } = await getClient().rpc("reclaim_avatar_jobs");
    if (error) throw error;
    log("info", "reclaim_done", { target: "jobs" });
  } catch (err) {
    log("warn", "reclaim_error", { target: "jobs", error_category: classifyError(err).category });
  }
}

async function reclaimCleanupJobs() {
  try {
    const { error } = await getClient().rpc("reclaim_avatar_cleanup_jobs");
    if (error) throw error;
    log("info", "reclaim_done", { target: "cleanup" });
  } catch (err) {
    log("warn", "reclaim_error", { target: "cleanup", error_category: classifyError(err).category });
  }
}

function setIntervalSafe(fn, ms, name) {
  return setInterval(async () => {
    try {
      await fn();
    } catch (err) {
      log("error", `${name}_error`, { error_category: classifyError(err).category });
    }
  }, ms);
}

let pollTimer = null;
let cleanupTimer = null;
let reclaimTimer = null;
let reclaimCleanupTimer = null;

function startWorker() {
  try {
    getClient();
  } catch (e) {
    console.error(JSON.stringify({ level: "error", event: "missing_env", error_category: "config", detail: String(e.message).slice(0, 200) }));
    process.exit(1);
  }

  pollTimer = setIntervalSafe(pollAndProcess, POLL_INTERVAL_MS, "poll");
  cleanupTimer = setIntervalSafe(pollAndCleanup, CLEANUP_POLL_INTERVAL_MS, "cleanup_poll");
  reclaimTimer = setIntervalSafe(reclaimJobs, RECLAIM_INTERVAL_MS, "reclaim");
  reclaimCleanupTimer = setIntervalSafe(reclaimCleanupJobs, CLEANUP_RECLAIM_INTERVAL_MS, "reclaim_cleanup");

  log("info", "worker_started", {
    worker_id: WORKER_ID,
    poll_interval_ms: POLL_INTERVAL_MS,
    cleanup_interval_ms: CLEANUP_POLL_INTERVAL_MS,
  });
}

const isMainModule = process.argv[1] && process.argv[1].endsWith("index.js");
if (isMainModule) {
  startWorker();
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("info", "shutdown_signal", { signal });
  if (pollTimer) clearInterval(pollTimer);
  if (cleanupTimer) clearInterval(cleanupTimer);
  if (reclaimTimer) clearInterval(reclaimTimer);
  if (reclaimCleanupTimer) clearInterval(reclaimCleanupTimer);
  setTimeout(() => process.exit(0), 2000);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

process.on("uncaughtException", (err) => {
  log("error", "uncaught_exception", { error_category: classifyError(err).category, detail: String(err?.message || err).slice(0, 200) });
  process.exit(1);
});

process.on("unhandledRejection", (err) => {
  log("error", "unhandled_rejection", { error_category: classifyError(err).category, detail: String(err?.message || err).slice(0, 200) });
  process.exit(1);
});

export {
  startWorker,
  getClient,
  processImage,
  downloadQuarantineFile,
  uploadOutput,
  deleteStorageFile,
  classifyError,
  processJob,
  processCleanupJob,
  failJob,
  failCleanupJob,
  WORKER_ID,
  log,
  POLL_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  RECLAIM_INTERVAL_MS,
  CLEANUP_POLL_INTERVAL_MS,
  CLEANUP_HEARTBEAT_INTERVAL_MS,
  CLEANUP_RECLAIM_INTERVAL_MS,
  MAX_FILE_SIZE,
  MAX_DIMENSION,
  MAX_PIXELS,
  OUTPUT_SIZE,
  OUTPUT_QUALITY,
  QUARANTINE_BUCKET,
  AVATARS_BUCKET,
};
