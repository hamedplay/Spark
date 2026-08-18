// one-time execution trigger
import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.endsWith('\n') ? s : `${s}\n`);
const parse = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const shared = `export interface JwtClaims {
  session_id?: string;
  aal?: string;
  [key: string]: unknown;
}

export function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const encoded = token.split(".")[1]?.replace(/-/g, "+").replace(/_/g, "/");
    if (!encoded) return null;
    const padded = encoded.padEnd(encoded.length + ((4 - encoded.length % 4) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
`;
write('supabase/functions/_shared/securityPrimitives.ts', shared);

function removeFunction(file, name) {
  let source = read(file);
  const sf = parse(file, source);
  const matches = sf.statements.filter((s) => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (matches.length !== 1) throw new Error(`${file}: expected exactly one ${name}, found ${matches.length}`);
  const n = matches[0];
  source = source.slice(0, n.getFullStart()) + source.slice(n.getEnd());
  write(file, source);
}
function addImport(file, bindings) {
  let source = read(file);
  const sf = parse(file, source);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
  source = source.slice(0, at) + `\nimport { ${bindings.join(', ')} } from "../_shared/securityPrimitives.ts";` + source.slice(at);
  write(file, source);
}

for (const file of [
  'supabase/functions/admin-delete-user/index.ts',
  'supabase/functions/admin-user-lifecycle/index.ts',
]) {
  removeFunction(file, 'tokenClaims');
  removeFunction(file, 'isUuid');
  addImport(file, ['decodeJwtClaims as tokenClaims', 'isUuid']);
}

for (const file of [
  'supabase/functions/bulk-sync-profile-phones/index.ts',
  'supabase/functions/auth-health-check/index.ts',
]) {
  removeFunction(file, 'tokenClaims');
  addImport(file, ['decodeJwtClaims as tokenClaims']);
}

{
  const file = 'supabase/functions/admin-retire-user/index.ts';
  removeFunction(file, 'isUuid');
  addImport(file, ['isUuid']);
}

for (const file of [
  'supabase/functions/admin-delete-user/index.ts',
  'supabase/functions/admin-user-lifecycle/index.ts',
  'supabase/functions/bulk-sync-profile-phones/index.ts',
  'supabase/functions/auth-health-check/index.ts',
]) {
  if (/function\s+tokenClaims\b/.test(read(file))) throw new Error(`local JWT decoder survived: ${file}`);
}
for (const file of [
  'supabase/functions/admin-delete-user/index.ts',
  'supabase/functions/admin-user-lifecycle/index.ts',
  'supabase/functions/admin-retire-user/index.ts',
]) {
  if (/function\s+isUuid\b/.test(read(file))) throw new Error(`local UUID validator survived: ${file}`);
}
console.log('Edge security primitive deduplication completed');
