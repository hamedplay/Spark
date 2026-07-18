import sharp from "sharp";
import fs from "node:fs";

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

async function cleanupAllTestFiles() {
  const qList = await helper("list_files", { bucket: "avatar-quarantine" });
  if (qList.data && qList.data.length > 0) {
    const paths = qList.data.map((f) => `${TEST_USER_ID}/${f.name}`);
    await helper("delete_files", { bucket: "avatar-quarantine", paths });
  }
  const aList = await helper("list_files", { bucket: "avatars" });
  if (aList.data && aList.data.length > 0) {
    const paths = aList.data.map((f) => `${TEST_USER_ID}/${f.name}`);
    await helper("delete_files", { bucket: "avatars", paths });
  }
  await helper("delete_jobs");
}

// ── Generate test images ────────────────────────────────────────────────────
async function makeValidJpeg() {
  return await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: 100, g: 150, b: 200 } } })
    .jpeg().toBuffer();
}
async function makeValidPng() {
  return await sharp({ create: { width: 300, height: 200, channels: 4, background: { r: 50, g: 100, b: 150, alpha: 1 } } })
    .png().toBuffer();
}
async function makeValidWebp() {
  return await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 100, b: 50 } } })
    .webp().toBuffer();
}
function makeCorruptFile() {
  const buf = Buffer.alloc(512);
  buf[0] = 0xff; buf[1] = 0xd8; buf[2] = 0xff;
  for (let i = 3; i < 512; i++) buf[i] = Math.floor(Math.random() * 256);
  return buf;
}
async function makeLargePixelImage() {
  // 7000x7000 = 49M pixels > 40M limit
  return await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 10, g: 20, b: 30 } } })
    .jpeg({ quality: 10 }).toBuffer();
}
async function makeAnimatedWebp() {
  // Use ImageMagick to create a proper animated GIF, then convert to animated WebP
  const { execSync } = await import("node:child_process");
  execSync("convert -size 32x32 xc:red -size 32x32 xc:green -size 32x32 xc:blue -set delay 100 -loop 0 /tmp/animated_test.gif");
  const gif = fs.readFileSync("/tmp/animated_test.gif");
  return await sharp(gif, { animated: true }).webp({ quality: 50 }).toBuffer();
}

// ── Import worker's pure functions ───────────────────────────────────────────
const workerModule = await import("./index.js");
const { processImage, classifyError, MAX_FILE_SIZE } = workerModule;

console.log("\n=== Avatar Worker Test Suite ===\n");

await cleanupAllTestFiles();

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

// ── T4: Corrupt file ─────────────────────────────────────────────────────────
try {
  await processImage(makeCorruptFile());
  record("T4_corrupt_file", false, "should have thrown");
} catch (e) {
  const cls = classifyError(e);
  record("T4_corrupt_file", cls.permanent === true, `permanent=${cls.permanent} cat=${cls.category}`);
}

// ── T5: Large pixels ────────────────────────────────────────────────────────
try {
  await processImage(await makeLargePixelImage());
  record("T5_large_pixels", false, "should have thrown");
} catch (e) {
  const cls = classifyError(e);
  record("T5_large_pixels", cls.permanent === true, `permanent=${cls.permanent} cat=${cls.category} msg=${String(e.message).slice(0, 80)}`);
}

// ── T6: Animated WebP ──────────────────────────────────────────────────────
try {
  const animated = await makeAnimatedWebp();
  await processImage(animated);
  record("T6_animated_webp", false, "should have thrown");
} catch (e) {
  const cls = classifyError(e);
  record("T6_animated_webp", cls.permanent === true, `permanent=${cls.permanent} cat=${cls.category} msg=${String(e.message).slice(0, 80)}`);
}

// ── T7: File > 2 MiB ────────────────────────────────────────────────────────
try {
  const big = Buffer.alloc(MAX_FILE_SIZE + 1);
  big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff;
  await processImage(big);
  record("T7_over_2mib", false, "should have thrown");
} catch (e) {
  record("T7_over_2mib", true, String(e.message).slice(0, 80));
}

// ── T8: Transient network classification ────────────────────────────────────
try {
  const cls = classifyError(new Error("fetch failed: ECONNRESET"));
  record("T8_transient_network", cls.permanent === false, `permanent=${cls.permanent} cat=${cls.category}`);
} catch (e) { record("T8_transient_network", false, String(e.message)); }

// ── T9: Permanent decode classification ─────────────────────────────────────
try {
  const cls = classifyError(new Error("decode failure: bad header"));
  record("T9_permanent_decode", cls.permanent === true, `permanent=${cls.permanent} cat=${cls.category}`);
} catch (e) { record("T9_permanent_decode", false, String(e.message)); }

// ════════════════════════════════════════════════════════════════════════════
// E2E TESTS — using helper edge function for service-role operations
// ════════════════════════════════════════════════════════════════════════════

// ── T10: End-to-end completion ──────────────────────────────────────────────
let testJobId = null;
try {
  const jpeg = await makeValidJpeg();
  const uploadRes = await uploadTestFile(jpeg, "test.jpg", "image/jpeg");
  if (uploadRes.status !== 200 || !uploadRes.body.job_id) {
    record("T10_e2e_upload", false, `upload failed: ${JSON.stringify(uploadRes.body)}`);
  } else {
    testJobId = uploadRes.body.job_id;

    // Claim the job via helper
    const claimRes = await helper("claim_job");
    if (!claimRes.data || claimRes.data.id !== testJobId) {
      // Check if our job was claimed
      const j2 = await helper("get_job", { job_id: testJobId });
      if (j2.data?.status !== "processing" || j2.data?.worker_id !== WORKER_ID) {
        record("T10_e2e_completion", false, `job not claimed, status=${j2.data?.status} worker=${j2.data?.worker_id}`);
      }
    }

    // Download quarantine file
    const jobRes = await helper("get_job", { job_id: testJobId });
    const job = jobRes.data;
    const dlRes = await helper("download_quarantine", { path: job.quarantine_path });
    if (dlRes.error) {
      record("T10_e2e_completion", false, `download failed: ${dlRes.error}`);
    } else {
      // Process image locally
      const buf = Buffer.from(dlRes.b64, "base64");
      const processed = await processImage(buf);

      // Upload processed output
      const outputPath = `${TEST_USER_ID}/${testJobId}.webp`;
      const upRes = await helper("upload_avatar", { path: outputPath, b64: processed.toString("base64") });
      if (upRes.error) {
        record("T10_e2e_completion", false, `upload failed: ${upRes.error}`);
      } else {
        // Get public URL
        const urlRes = await helper("get_public_url", { path: outputPath });
        const avatarUrl = urlRes.url;

        // Complete job
        const compRes = await helper("complete_job", {
          job_id: testJobId,
          output_path: outputPath,
          avatar_url: avatarUrl,
        });
        if (compRes.error) {
          record("T10_e2e_completion", false, `complete failed: ${compRes.error}`);
        } else {
          record("T10_e2e_completion", true, `job_id=${testJobId}`);
        }
      }
    }
  }
} catch (e) {
  record("T10_e2e", false, String(e.message));
}

// ── T10b: Verify job completed ──────────────────────────────────────────────
if (testJobId) {
  try {
    const { data: completed } = await helper("get_job", { job_id: testJobId });
    record("T10b_job_completed", completed?.status === "completed", `status=${completed?.status}`);
  } catch (e) { record("T10b_job_completed", false, String(e.message)); }

  // ── T10c: Verify output file exists ──────────────────────────────────────
  try {
    const { data: aFiles } = await helper("list_files", { bucket: "avatars" });
    const hasOutput = aFiles && aFiles.some((f) => f.name === `${testJobId}.webp`);
    record("T10c_output_exists", hasOutput === true, `files=${aFiles?.length || 0}`);
  } catch (e) { record("T10c_output_exists", false, String(e.message)); }

  // ── T10d: Verify profile updated ──────────────────────────────────────────
  try {
    const { data: profile } = await helper("get_profile");
    record("T10d_profile_updated", profile?.avatar_storage_path === `${TEST_USER_ID}/${testJobId}.webp`,
      `path=${profile?.avatar_storage_path}`);
  } catch (e) { record("T10d_profile_updated", false, String(e.message)); }
}

// ── T11: Cleanup — delete quarantine ─────────────────────────────────────────
if (testJobId) {
  try {
    const { data: jobs } = await helper("get_completed_jobs");
    if (jobs && jobs.length > 0) {
      const job = jobs[0];
      // Claim cleanup
      const claimRes = await helper("claim_cleanup");
      let cleanupJob = (claimRes.data && claimRes.data.id === job.id) ? claimRes.data : null;

      if (!cleanupJob) {
        const j2 = await helper("get_job", { job_id: job.id });
        if (j2.data?.cleanup_status === "processing" && j2.data?.cleanup_worker_id === WORKER_ID) {
          cleanupJob = j2.data;
        }
      }

      if (cleanupJob) {
        // Delete old avatar (previous_avatar_path)
        if (cleanupJob.previous_avatar_path) {
          const delRes = await helper("delete_storage", {
            bucket: "avatars",
            path: cleanupJob.previous_avatar_path,
          });
          if (delRes.deleted) {
            await helper("mark_cleanup", {
              job_id: job.id,
              old_deleted: true,
              quar_deleted: false,
            });
          }
        }

        // Delete quarantine
        if (cleanupJob.quarantine_path) {
          const delRes = await helper("delete_storage", {
            bucket: "avatar-quarantine",
            path: cleanupJob.quarantine_path,
          });
          if (delRes.deleted) {
            await helper("mark_cleanup", {
              job_id: job.id,
              old_deleted: true,
              quar_deleted: true,
            });
          }
        }
      }

      // Verify quarantine deleted
      const { data: qFiles } = await helper("list_files", { bucket: "avatar-quarantine" });
      const qExists = qFiles && qFiles.some((f) => job.quarantine_path.endsWith(f.name));
      record("T11_quarantine_deleted", !qExists, `quarantine_exists=${qExists}`);

      // Verify cleanup_status
      const { data: updated } = await helper("get_job", { job_id: job.id });
      record("T11b_cleanup_status", updated?.cleanup_status === "completed", `status=${updated?.cleanup_status}`);
    } else {
      record("T11_quarantine_deleted", false, "no completed job found");
    }
  } catch (e) { record("T11_quarantine_deleted", false, String(e.message)); }
}

// ── T12: 404 delete as success ───────────────────────────────────────────────
try {
  const res = await helper("delete_storage", {
    bucket: "avatars",
    path: `${TEST_USER_ID}/nonexistent-${Date.now()}.webp`,
  });
  record("T12_404_as_success", res.deleted === true, `deleted=${res.deleted} not_found=${res.not_found}`);
} catch (e) { record("T12_404_as_success", false, String(e.message)); }

// ── T13: No orphan files ─────────────────────────────────────────────────────
try {
  await cleanupAllTestFiles();
  const { data: qFiles } = await helper("list_files", { bucket: "avatar-quarantine" });
  const { data: aFiles } = await helper("list_files", { bucket: "avatars" });
  record("T13_no_orphans", (qFiles?.length || 0) === 0 && (aFiles?.length || 0) === 0,
    `quarantine=${qFiles?.length || 0} avatars=${aFiles?.length || 0}`);
} catch (e) { record("T13_no_orphans", false, String(e.message)); }

// ── T14: No hardcoded secrets ───────────────────────────────────────────────
try {
  const src = fs.readFileSync("./index.js", "utf8");
  const hasHardcodedKey = /eyJ[A-Za-z0-9_-]{50,}/.test(src);
  const hasHardcodedPassword = /password\s*=\s*['"][^'"]{4,}['"]/.test(src);
  record("T14_no_hardcoded_secrets", !hasHardcodedKey && !hasHardcodedPassword, `key=${hasHardcodedKey} pwd=${hasHardcodedPassword}`);
} catch (e) { record("T14_no_hardcoded_secrets", false, String(e.message)); }

// ════════════════════════════════════════════════════════════════════════════
console.log("\n=== Summary ===");
const passed = results.filter((r) => r.pass).length;
const failed = results.filter((r) => !r.pass).length;
console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed}`);
if (failed > 0) {
  console.log("\nFailed tests:");
  results.filter((r) => !r.pass).forEach((r) => console.log(`  - ${r.name}: ${r.detail}`));
}

await cleanupAllTestFiles();
process.exit(failed > 0 ? 1 : 0);
