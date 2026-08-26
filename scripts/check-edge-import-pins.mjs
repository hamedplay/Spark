import { readdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';

const ROOT = 'supabase/functions';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);
const exactSemver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (SOURCE_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
  return files;
}

function parseVersion(spec) {
  const withoutScheme = spec.replace(/^(npm|jsr):/, '');
  const packageAndVersion = withoutScheme.startsWith('@')
    ? withoutScheme.match(/^(@[^/]+\/[^@/]+)@([^/]+)(?:\/.*)?$/)
    : withoutScheme.match(/^([^@/]+)@([^/]+)(?:\/.*)?$/);
  return packageAndVersion?.[2] ?? null;
}

const problems = [];
for (const file of await walk(ROOT)) {
  const text = await readFile(file, 'utf8');
  const specs = text.match(/(?:npm|jsr):[^'"\s)]+/g) ?? [];
  for (const spec of specs) {
    const version = parseVersion(spec);
    if (!version || !exactSemver.test(version)) {
      problems.push(`${file}: ${spec}`);
    }
  }
}

if (problems.length) {
  console.error('Floating or non-exact Edge Function dependencies found:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('All npm:/jsr: Edge Function imports use exact semantic versions.');
