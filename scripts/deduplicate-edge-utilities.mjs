import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.endsWith('\n') ? s : `${s}\n`);

const phoneModule = `export function normalizeIranPhone(value?: string | null): string {
  const digits = String(value || "").replace(/\\D/g, "");
  if (/^00989\\d{9}$/.test(digits)) return digits.slice(2);
  if (/^989\\d{9}$/.test(digits)) return digits;
  if (/^09\\d{9}$/.test(digits)) return \`98\${digits.slice(1)}\`;
  if (/^9\\d{9}$/.test(digits)) return \`98\${digits}\`;
  return "";
}
`;

const cryptoModule = `export async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const enc = new TextEncoder();
  const ba = enc.encode(a);
  const bb = enc.encode(b);
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}
`;

write('supabase/functions/_shared/phone.ts', phoneModule);
write('supabase/functions/_shared/crypto.ts', cryptoModule);

function removeTopLevelFunction(file, name) {
  const source = read(file);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const matches = sf.statements.filter((n) => ts.isFunctionDeclaration(n) && n.name?.text === name);
  if (matches.length !== 1) throw new Error(`${file}: expected exactly one ${name}, found ${matches.length}`);
  const node = matches[0];
  const next = source.slice(0, node.getFullStart()) + source.slice(node.getEnd());
  write(file, next);
}

function addNamedImport(file, specifier, names, { reexport = [] } = {}) {
  let source = read(file);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const importText = `import { ${names.join(', ')} } from "${specifier}";\n`;
  if (source.includes(importText.trim())) return;
  const insertAt = imports.length ? imports[imports.length - 1].getEnd() : 0;
  source = source.slice(0, insertAt) + `\n${importText}` + source.slice(insertAt);
  if (reexport.length) {
    const sf2 = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const imports2 = sf2.statements.filter(ts.isImportDeclaration);
    const afterImports = imports2.length ? imports2[imports2.length - 1].getEnd() : 0;
    source = source.slice(0, afterImports) + `\nexport { ${reexport.join(', ')} };` + source.slice(afterImports);
  }
  write(file, source);
}

const phoneConsumers = [
  'supabase/functions/admin-users/index.ts',
  'supabase/functions/bulk-sync-profile-phones/index.ts',
  'supabase/functions/change-user-phone/index.ts',
  'supabase/functions/sync-profile-phone-to-auth/index.ts',
  'supabase/functions/auth-send-sms-hook/index.ts',
];
for (const file of phoneConsumers) {
  removeTopLevelFunction(file, 'normalizeIranPhone');
  addNamedImport(file, '../_shared/phone.ts', ['normalizeIranPhone']);
}

const registration = 'supabase/functions/_shared/registration-security.ts';
removeTopLevelFunction(registration, 'normalizeIranPhone');
addNamedImport(registration, './phone.ts', ['normalizeIranPhone'], { reexport: ['normalizeIranPhone'] });

// Centralize HMAC while preserving public exports of shared modules.
removeTopLevelFunction(registration, 'hmacSha256Hex');
addNamedImport(registration, './crypto.ts', ['hmacSha256Hex'], { reexport: ['hmacSha256Hex'] });

const phoneOtp = 'supabase/functions/_shared/phoneOtpLoginV2.ts';
removeTopLevelFunction(phoneOtp, 'hmacSha256Hex');
addNamedImport(phoneOtp, './crypto.ts', ['hmacSha256Hex'], { reexport: ['hmacSha256Hex'] });

const passwordLogin = 'supabase/functions/password-login/index.ts';
removeTopLevelFunction(passwordLogin, 'hmacSha256Hex');
addNamedImport(passwordLogin, '../_shared/crypto.ts', ['hmacSha256Hex']);

for (const file of [
  'supabase/functions/process-decision-due-overdue/index.ts',
  'supabase/functions/process-minutes-reminders/index.ts',
  'supabase/functions/process-notification-outbox/index.ts',
]) {
  removeTopLevelFunction(file, 'timingSafeCompare');
  addNamedImport(file, '../_shared/crypto.ts', ['timingSafeCompare']);
}

// Strong postconditions: duplicate declarations must be gone from consumers.
for (const file of phoneConsumers) {
  if (/function\s+normalizeIranPhone\b/.test(read(file))) throw new Error(`local phone normalizer survived: ${file}`);
}
for (const file of [registration, phoneOtp, passwordLogin]) {
  if (/function\s+hmacSha256Hex\b/.test(read(file))) throw new Error(`local HMAC survived: ${file}`);
}
for (const file of [
  'supabase/functions/process-decision-due-overdue/index.ts',
  'supabase/functions/process-minutes-reminders/index.ts',
  'supabase/functions/process-notification-outbox/index.ts',
]) {
  if (/function\s+timingSafeCompare\b/.test(read(file))) throw new Error(`local timingSafeCompare survived: ${file}`);
}

console.log('edge utility deduplication transform completed');
