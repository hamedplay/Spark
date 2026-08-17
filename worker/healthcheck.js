import fs from "node:fs";

const HEALTH_FILE = "/tmp/worker-health";
const MAX_AGE_MS = 60 * 1000;

try {
  if (!fs.existsSync(HEALTH_FILE)) {
    console.error("health file missing");
    process.exit(1);
  }
  const ts = parseInt(fs.readFileSync(HEALTH_FILE, "utf8").trim(), 10);
  if (Number.isNaN(ts)) {
    console.error("health file invalid");
    process.exit(1);
  }
  const age = Date.now() - ts;
  if (age > MAX_AGE_MS) {
    console.error(`health file stale: ${age}ms old`);
    process.exit(1);
  }
  process.exit(0);
} catch {
  console.error("healthcheck failed");
  process.exit(1);
}
