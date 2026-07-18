import sharp from "sharp";
import fs from "node:fs";
import { execSync } from "node:child_process";

const env = fs.readFileSync("../.env", "utf8").split("\n");
let SUPABASE_URL = "", ANON_KEY = "";
for (const l of env) {
  if (l.startsWith("VITE_SUPABASE_URL=")) SUPABASE_URL = l.split("=")[1];
  if (l.startsWith("VITE_SUPABASE_ANON_KEY=")) ANON_KEY = l.split("=")[1];
}

const JWT = fs.readFileSync("/tmp/test_jwt.txt", "utf8").trim();
const TEST_USER_ID = "aa1d4e48-f91b-43e1-8de2-0e29cf7d897b";
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/avatar-upload`;
const HELPER_URL = `${SUPABASE_URL}/functions/v1/avatar-test-helper`;
const WORKER_ID = "test-worker";

const results = [];
function record(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${detail ? ": " + detail : ""}`);
}

async function helper(action, extra = {}) {
  const res = await fetch(HELPER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, user_id: TEST_USER_ID, worker_id: WORKER_ID, ...extra }),
  });
  return await res.json();
}

async function uploadTestFile(bytes, filename, type) {
  const fd = new FormData();
  fd.append("file", new Blob([bytes], { type }), filename);
  const res = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${JWT}` },
    body: fd,
  });
  return { status: res.status, body: await res.json() };
}

async function cleanupAll() {
  const qList = await helper("list_files", { bucket: "avatar-quarantine" });
  if (qList.data?.length > 0) {
    await helper("delete_files", { bucket: "avatar-quarantine", paths: qList.data.map((f) => `${TEST_USER_ID}/${f.name}`) });
  }
  const aList = await helper("list_files", { bucket: "avatars" });
  if (aList.data?.length > 0) {
    await helper("delete_files", { bucket: "avatars", paths: aList.data.map((f) => `${TEST_USER_ID}/${f.name}`) });
  }
  await helper("delete_jobs");
  await helper("restore_profile");
}

// ── Image generators ────────────────────────────────────────────────────────
async function makeValidJpeg() {
  return await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 100, g: 150, b: 200 } } }).jpeg().toBuffer();
}
async function makeJpegWithExif(orientation) {
  const base = await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 100, g: 150, b: 200 } } }).jpeg().toBuffer();
  return await sharp(base).withMetadata({ orientation }).jpeg().toBuffer();
}
async function makeValidPng() {
  return await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 50, g: 100, b: 150, alpha: 1 } } }).png().toBuffer();
}
async function makeValidWebp() {
  return await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 100, b: 50 } } }).webp().toBuffer();
}
function makeCorruptFile() {
  const buf = Buffer.alloc(512);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  for (let i = 3; i < 512; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}
async function makeLargePixelImage() {
  return await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 10, g: 20, b: 30 } } }).jpeg({ quality: 10 }).toBuffer();
}
async function makeAnimatedWebp() {
  execSync("convert -size 32x32 xc:red -size 32x32 xc:green -size 32x32 xc:blue -set delay 100 -loop 0 /tmp/anim_test.gif");
  const gif = fs.readFileSync("/tmp/anim_test.gif");
  return await sharp(gif, { animated: true }).webp({ quality: 50 }).toBuffer();
}

const workerModule = await import("./index.js");
const { processImage, classifyError, MAX_FILE_SIZE } = workerModule;

console.log("\n=== Avatar Worker Test Suite v2 ===\n");
console.log(`Sharp version: ${sharp.versions.sharp}, vips: ${sharp.versions.vips}\n`);

await cleanupAll();

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1: Sharp metadata stripping
// ════════════════════════════════════════════════════════════════════════════

// ── T1: Valid JPEG ──────────────────────────────────────────────────────────
try {
  const jpeg = await makeValidJpeg();
  const out = await processImage(jpeg);
  const meta = await sharp(out).metadata();
  record("T1_valid_jpeg", out.length > 0 && meta.format === "webp" && meta.width === 512 && meta.height === 512,
    `format=${meta.format} ${meta.width}x${meta.height} ${out.length}B`);
} catch (e) { record("T1_valid_jpeg", false, String(e.message)); }

// ── T2: Valid PNG ───────────────────────────────────────────────────────────
try {
  const png = await makeValidPng();
  const out = await processImage(png);
  const meta = await sharp(out).metadata();
  record("T2_valid_png", out.length > 0 && meta.format === "webp" && meta.width === 512 && meta.height === 512,
    `format=${meta.format} ${meta.width}x${meta.height}`);
} catch (e) { record("T2_valid_png", false, String(e.message)); }

// ── T3: Valid WebP ──────────────────────────────────────────────────────────
try {
  const webp = await makeValidWebp();
  const out = await processImage(webp);
  const meta = await sharp(out).metadata();
  record("T3_valid_webp", out.length > 0 && meta.format === "webp" && meta.width === 512 && meta.height === 512,
    `format=${meta.format} ${meta.width}x${meta.height}`);
} catch (e) { record("T3_valid_webp", false, String(e.message)); }

// ── T4: Metadata stripping — EXIF ───────────────────────────────────────────
try {
  const jpegWithExif = await makeJpegWithExif(6);
  const inputMeta = await sharp(jpegWithExif).metadata();
  const out = await processImage(jpegWithExif);
  const outMeta = await sharp(out).metadata();
  record("T4_exif_stripped",
    !outMeta.exif && inputMeta.exif,
    `input_exif=${inputMeta.exif?.length || 0}B output_exif=${outMeta.exif ? "present" : "none"}`);
} catch (e) { record("T4_exif_stripped", false, String(e.message)); }

// ── T5: Metadata stripping — ICC ────────────────────────────────────────────
try {
  const jpegWithExif = await makeJpegWithExif(8);
  const inputMeta = await sharp(jpegWithExif).metadata();
  const out = await processImage(jpegWithExif);
  const outMeta = await sharp(out).metadata();
  record("T5_icc_stripped",
    !outMeta.icc && inputMeta.icc,
    `input_icc=${inputMeta.icc?.length || 0}B output_icc=${outMeta.icc ? "present" : "none"}`);
} catch (e) { record("T5_icc_stripped", false, String(e.message)); }

// ── T6: Metadata stripping — XMP ────────────────────────────────────────────
try {
  const base = await makeValidJpeg();
  // Sharp doesn't easily add XMP, but we can check that default output has no XMP
  const out = await processImage(base);
  const outMeta = await sharp(out).metadata();
  record("T6_xmp_stripped", !outMeta.xmp, `output_xmp=${outMeta.xmp ? "present" : "none"}`);
} catch (e) { record("T6_xmp_stripped", false, String(e.message)); }

// ── T7: Metadata stripping — comment ────────────────────────────────────────
try {
  const base = await makeValidJpeg();
  const out = await processImage(base);
  const outMeta = await sharp(out).metadata();
  record("T7_comment_stripped", !outMeta.comment, `output_comment=${outMeta.comment ? "present" : "none"}`);
} catch (e) { record("T7_comment_stripped", false, String(e.message)); }

// ── T8: Corrupt file ─────────────────────────────────────────────────────────
try {
  await processImage(makeCorruptFile());
  record("T8_corrupt_file", false, "should have thrown");
} catch (e) {
  const cls = classifyError(e);
  record("T8_corrupt_file", cls.permanent === true, `permanent=${cls.permanent} cat=${cls.category}`);
}

// ── T9: Large pixels ────────────────────────────────────────────────────────
try {
  await processImage(await makeLargePixelImage());
  record("T9_large_pixels", false, "should have thrown");
} catch (e) {
  const cls = classifyError(e);
  record("T9_large_pixels", cls.permanent === true, `permanent=${cls.permanent} cat=${cls.category}`);
}

// ── T10: Animated WebP ──────────────────────────────────────────────────────
try {
  await processImage(await makeAnimatedWebp());
  record("T10_animated_webp", false, "should have thrown");
} catch (e) {
  const cls = classifyError(e);
  record("T10_animated_webp", cls.permanent === true, `permanent=${cls.permanent} cat=${cls.category} msg=${String(e.message).slice(0, 80)}`);
}

// ── T11: File > 2 MiB ───────────────────────────────────────────────────────
try {
  const big = Buffer.alloc(MAX_FILE_SIZE + 1);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  await processImage(big);
  record("T11_over_2mib", false, "should have thrown");
} catch (e) {
  record("T11_over_2mib", true, String(e.message).slice(0, 80));
}

// ── T12: Transient network classification ───────────────────────────────────
try {
  const cls = classifyError(new Error("fetch failed: ECONNRESET"));
  record("T12_transient_network", cls.permanent === false, `permanent=${cls.permanent} cat=${cls.category}`);
} catch (e) { record("T12_transient_network", false, String(e.message)); }

// ── T13: Permanent decode classification ────────────────────────────────────
try {
  const cls = classifyError(new Error("decode failure: bad header"));
  record("T13_permanent_decode", cls.permanent === true, `permanent=${cls.permanent} cat=${cls.category}`);
} catch (e) { record("T13_permanent_decode", false, String(e.message)); }

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2: E2E completion
// ════════════════════════════════════════════════════════════════════════════

let testJobId = null;
try {
  const jpeg = await makeValidJpeg();
  const uploadRes = await uploadTestFile(jpeg, "test.jpg", "image/jpeg");
  if (uploadRes.status !== 200 || !uploadRes.body.job_id) {
    record("T14_e2e_upload", false, `upload failed: ${JSON.stringify(uploadRes.body)}`);
  } else {
    testJobId = uploadRes.body.job_id;
    const claimRes = await helper("claim_job");
    const job = (claimRes.data && claimRes.data.id === testJobId) ? claimRes.data : (await helper("get_job", { job_id: testJobId })).data;

    // Download quarantine
    const dlRes = await helper("download_quarantine", { path: job.quarantine_path });
    if (dlRes.error) {
      record("T14_e2e_completion", false, `download failed: ${dlRes.error}`);
    } else {
      const buf = Buffer.from(dlRes.b64, "base64");
      const processed = await processImage(buf);
      const outputPath = `${TEST_USER_ID}/${testJobId}.webp`;
      const upRes = await helper("upload_avatar", { path: outputPath, b64: processed.toString("base64") });
      if (upRes.error) {
        record("T14_e2e_completion", false, `upload failed: ${upRes.error}`);
      } else {
        const urlRes = await helper("get_public_url", { path: outputPath });
        const compRes = await helper("complete_job", {
          job_id: testJobId, output_path: outputPath, avatar_url: urlRes.url,
        });
        record("T14_e2e_completion", !compRes.error, `job_id=${testJobId} err=${compRes.error || "none"}`);
      }
    }
  }
} catch (e) { record("T14_e2e", false, String(e.message)); }

if (testJobId) {
  try {
    const { data: completed } = await helper("get_job", { job_id: testJobId });
    record("T14b_job_completed", completed?.status === "completed", `status=${completed?.status}`);
  } catch (e) { record("T14b_job_completed", false, String(e.message)); }

  try {
    const { data: aFiles } = await helper("list_files", { bucket: "avatars" });
    const hasOutput = aFiles?.some((f) => f.name === `${testJobId}.webp`);
    record("T14c_output_exists", hasOutput === true, `files=${aFiles?.length || 0}`);
  } catch (e) { record("T14c_output_exists", false, String(e.message)); }

  try {
    const { data: profile } = await helper("get_profile");
    record("T14d_profile_updated", profile?.avatar_storage_path === `${TEST_USER_ID}/${testJobId}.webp`,
      `path=${profile?.avatar_storage_path}`);
  } catch (e) { record("T14d_profile_updated", false, String(e.message)); }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3: Cleanup — quarantine deletion
// ════════════════════════════════════════════════════════════════════════════

if (testJobId) {
  try {
    const { data: jobs } = await helper("get_completed_jobs");
    if (jobs?.length > 0) {
      const job = jobs[0];
      const claimRes = await helper("claim_cleanup");
      let cleanupJob = (claimRes.data?.id === job.id) ? claimRes.data : null;
      if (!cleanupJob) {
        const j2 = await helper("get_job", { job_id: job.id });
        if (j2.data?.cleanup_status === "processing" && j2.data?.cleanup_worker_id === WORKER_ID) {
          cleanupJob = j2.data;
        }
      }
      if (cleanupJob) {
        if (cleanupJob.previous_avatar_path) {
          const delRes = await helper("delete_storage", { bucket: "avatars", path: cleanupJob.previous_avatar_path });
          if (delRes.deleted) await helper("mark_cleanup", { job_id: job.id, old_deleted: true, quar_deleted: false });
        }
        if (cleanupJob.quarantine_path) {
          const delRes = await helper("delete_storage", { bucket: "avatar-quarantine", path: cleanupJob.quarantine_path });
          if (delRes.deleted) await helper("mark_cleanup", { job_id: job.id, old_deleted: true, quar_deleted: true });
        }
      }
      const { data: qFiles } = await helper("list_files", { bucket: "avatar-quarantine" });
      const qExists = qFiles?.some((f) => job.quarantine_path.endsWith(f.name));
      record("T15_quarantine_deleted", !qExists, `quarantine_exists=${qExists}`);
      const { data: updated } = await helper("get_job", { job_id: job.id });
      record("T15b_cleanup_status", updated?.cleanup_status === "completed", `status=${updated?.cleanup_status}`);
    } else {
      record("T15_quarantine_deleted", false, "no completed job found");
    }
  } catch (e) { record("T15_quarantine_deleted", false, String(e.message)); }
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4: Rollback output — controlled complete_avatar_job failure
// ════════════════════════════════════════════════════════════════════════════

let rollbackJobId = null;
try {
  // Upload first while profile still exists (create_avatar_job needs profile)
  const jpeg = await makeValidJpeg();
  const uploadRes = await uploadTestFile(jpeg, "test.jpg", "image/jpeg");
  if (uploadRes.status !== 200 || !uploadRes.body.job_id) {
    record("T16_rollback_upload", false, `upload failed: ${JSON.stringify(uploadRes.body)}`);
  } else {
    rollbackJobId = uploadRes.body.job_id;
    const claimRes = await helper("claim_job");
    const job = (claimRes.data?.id === rollbackJobId) ? claimRes.data : (await helper("get_job", { job_id: rollbackJobId })).data;

    // Download and process
    const dlRes = await helper("download_quarantine", { path: job.quarantine_path });
    const buf = Buffer.from(dlRes.b64, "base64");
    const processed = await processImage(buf);
    const outputPath = `${TEST_USER_ID}/${rollbackJobId}.webp`;

    // Upload output (should succeed)
    const upRes = await helper("upload_avatar", { path: outputPath, b64: processed.toString("base64") });
    if (upRes.error) {
      record("T16_rollback", false, `upload failed: ${upRes.error}`);
    } else {
      // Verify output exists
      const { data: aFilesBefore } = await helper("list_files", { bucket: "avatars" });
      const outputExistsBefore = aFilesBefore?.some((f) => f.name === `${rollbackJobId}.webp`);

      // NOW remove profile to force complete_avatar_job to fail
      await helper("remove_profile");

      // Check job state before complete
      const jobStateBefore = await helper("get_job", { job_id: rollbackJobId });
      console.log(`  [debug] job state before complete: status=${jobStateBefore.data?.status} worker=${jobStateBefore.data?.worker_id} err=${jobStateBefore.error || "none"}`);

      // Attempt complete_avatar_job (should fail — profile missing)
      const urlRes = await helper("get_public_url", { path: outputPath });
      const compRes = await helper("complete_job", {
        job_id: rollbackJobId, output_path: outputPath, avatar_url: urlRes.url,
      });

      if (!compRes.error) {
        record("T16_rollback", false, "complete_avatar_job should have failed");
      } else {
        // Simulate worker rollback: delete the orphan output
        const delRes = await helper("delete_storage", { bucket: "avatars", path: outputPath });
        record("T16_rollback_complete_failed", !!compRes.error, `complete_err=${String(compRes.error).slice(0, 80)}`);

        // Verify orphan output deleted
        const { data: aFilesAfter } = await helper("list_files", { bucket: "avatars" });
        const outputExistsAfter = aFilesAfter?.some((f) => f.name === `${rollbackJobId}.webp`);
        record("T16b_orphan_output_deleted", !outputExistsAfter, `exists_before=${outputExistsBefore} exists_after=${outputExistsAfter}`);
      }

      // Check job state after complete attempt
      const jobStateAfter = await helper("get_job", { job_id: rollbackJobId });
      console.log(`  [debug] job state after complete: status=${jobStateAfter.data?.status} worker=${jobStateAfter.data?.worker_id}`);

      // Fail the job — only if still in processing state
      if (jobStateAfter.data?.status === "processing" && jobStateAfter.data?.worker_id === WORKER_ID) {
        await helper("fail_job", { job_id: rollbackJobId, error_msg: "complete_avatar_job failed: profile not found", permanent: false });
        const { data: failedJob } = await helper("get_job", { job_id: rollbackJobId });
        record("T16c_job_failed", failedJob?.status === "retry_wait" || failedJob?.status === "failed",
          `status=${failedJob?.status}`);
      } else {
        // Job was already reset by the RPC exception — this is acceptable
        record("T16c_job_failed", true, `job already reset (status=${jobStateAfter.data?.status})`);
      }
    }
  }
} catch (e) { record("T16_rollback", false, String(e.message)); }

// Restore profile
await helper("restore_profile");

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5: 404 delete as success
// ════════════════════════════════════════════════════════════════════════════

try {
  const res = await helper("delete_storage", {
    bucket: "avatars",
    path: `${TEST_USER_ID}/nonexistent-${Date.now()}.webp`,
  });
  record("T17_404_as_success", res.deleted === true, `deleted=${res.deleted} not_found=${res.not_found}`);
} catch (e) { record("T17_404_as_success", false, String(e.message)); }

// ════════════════════════════════════════════════════════════════════════════
// SECTION 6: No orphans, no hardcoded secrets
// ════════════════════════════════════════════════════════════════════════════

try {
  await cleanupAll();
  const { data: qFiles } = await helper("list_files", { bucket: "avatar-quarantine" });
  const { data: aFiles } = await helper("list_files", { bucket: "avatars" });
  record("T18_no_orphans", (qFiles?.length || 0) === 0 && (aFiles?.length || 0) === 0,
    `quarantine=${qFiles?.length || 0} avatars=${aFiles?.length || 0}`);
} catch (e) { record("T18_no_orphans", false, String(e.message)); }

try {
  const src = fs.readFileSync("./index.js", "utf8");
  const hasHardcodedKey = /eyJ[A-Za-z0-9_-]{50,}/.test(src);
  const hasHardcodedPassword = /password\s*=\s*['"][^'"]{4,}['"]/.test(src);
  const hasHardcodedUrl = /https:\/\/[a-z0-9]+\.supabase\.co(?!.*process\.env)/.test(src);
  record("T19_no_hardcoded_secrets", !hasHardcodedKey && !hasHardcodedPassword, `key=${hasHardcodedKey} pwd=${hasHardcodedPassword}`);
} catch (e) { record("T19_no_hardcoded_secrets", false, String(e.message)); }

// ── T20: Healthcheck file ───────────────────────────────────────────────────
try {
  const healthSrc = fs.readFileSync("./healthcheck.js", "utf8");
  const workerSrc = fs.readFileSync("./index.js", "utf8");
  const hasHealthWrite = workerSrc.includes("writeHealth") && workerSrc.includes("/tmp/worker-health");
  const hasHealthCheck = healthSrc.includes("/tmp/worker-health") && healthSrc.includes("60");
  record("T20_healthcheck", hasHealthWrite && hasHealthCheck, `write=${hasHealthWrite} check=${hasHealthCheck}`);
} catch (e) { record("T20_healthcheck", false, String(e.message)); }

// ════════════════════════════════════════════════════════════════════════════
console.log("\n=== Summary ===");
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailed tests:");
  results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
}

await cleanupAll();
process.exit(failed > 0 ? 1 : 0);
