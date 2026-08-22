import fs from "node:fs";

try {
  const cmdline = fs.readFileSync("/proc/1/cmdline", "utf8").replace(/\0/g, " ");
  if (!cmdline.includes("node") || !cmdline.includes("index.js")) {
    console.error(`unexpected pid1: ${cmdline}`);
    process.exit(1);
  }
  process.exit(0);
} catch (err) {
  console.error(`healthcheck failed: ${err?.message || err}`);
  process.exit(1);
}
