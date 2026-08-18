import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.endsWith('\n') ? s : `${s}\n`);

const shared = `import { createClient } from "npm:@supabase/supabase-js@2.112.3";

export const postJsonCorsBaseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

export function createServiceRoleClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

export async function getPhoneAuthAllowedOrigins(): Promise<string[]> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.rpc("get_phone_auth_config");
  if (error || !data) return [];
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !Array.isArray(row.allowed_origins)) return [];
  return Array.from(new Set(
    row.allowed_origins
      .filter((value: unknown): value is string => typeof value === "string")
      .map((value: string) => value.trim())
      .filter(Boolean),
  ));
}

export function createJsonResponseHeaders(baseCorsHeaders: Record<string, string>) {
  return (origin: string | null): Record<string, string> => ({
    ...baseCorsHeaders,
    ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Pragma": "no-cache",
    "Vary": "Origin",
  });
}
`;
write('supabase/functions/_shared/runtimeHttp.ts', shared);

function parse(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}
function removeDeclarations(file, names) {
  let source = read(file);
  const sf = parse(file, source);
  const targets = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && names.includes(stmt.name.text)) {
      targets.push(stmt);
    } else if (ts.isVariableStatement(stmt)) {
      const declared = stmt.declarationList.declarations
        .filter((d) => ts.isIdentifier(d.name))
        .map((d) => d.name.text);
      if (declared.some((n) => names.includes(n))) targets.push(stmt);
    }
  }
  for (const name of names) {
    const count = targets.filter((stmt) => {
      if (ts.isFunctionDeclaration(stmt)) return stmt.name?.text === name;
      return stmt.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name);
    }).length;
    if (count !== 1) throw new Error(`${file}: expected exactly one declaration for ${name}, found ${count}`);
  }
  targets.sort((a, b) => b.getFullStart() - a.getFullStart());
  for (const node of targets) source = source.slice(0, node.getFullStart()) + source.slice(node.getEnd());
  write(file, source);
}
function addRuntimeImport(file, imported) {
  let source = read(file);
  const sf = parse(file, source);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const insertAt = imports.length ? imports[imports.length - 1].getEnd() : 0;
  const line = `import { ${imported.join(', ')} } from "../_shared/runtimeHttp.ts";`;
  source = source.slice(0, insertAt) + `\n${line}` + source.slice(insertAt);
  write(file, source);
}
function addResponseFactory(file) {
  let source = read(file);
  const sf = parse(file, source);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const insertAt = imports.length ? imports[imports.length - 1].getEnd() : 0;
  source = source.slice(0, insertAt) + `\n\nconst responseHeaders = createJsonResponseHeaders(baseCorsHeaders);` + source.slice(insertAt);
  write(file, source);
}

for (const file of [
  'supabase/functions/admin-delete-user/index.ts',
  'supabase/functions/admin-retire-user/index.ts',
  'supabase/functions/admin-user-lifecycle/index.ts',
]) {
  removeDeclarations(file, ['baseCorsHeaders', 'adminClient', 'getAllowedOrigins', 'responseHeaders']);
  addRuntimeImport(file, [
    'postJsonCorsBaseHeaders as baseCorsHeaders',
    'createServiceRoleClient as adminClient',
    'getPhoneAuthAllowedOrigins as getAllowedOrigins',
    'createJsonResponseHeaders',
  ]);
  addResponseFactory(file);
}

{
  const file = 'supabase/functions/bulk-sync-profile-phones/index.ts';
  removeDeclarations(file, ['baseCorsHeaders', 'getAllowedOrigins', 'responseHeaders']);
  addRuntimeImport(file, [
    'postJsonCorsBaseHeaders as baseCorsHeaders',
    'getPhoneAuthAllowedOrigins as getAllowedOrigins',
    'createJsonResponseHeaders',
  ]);
  addResponseFactory(file);
}

{
  const file = 'supabase/functions/auth-health-check/index.ts';
  removeDeclarations(file, ['adminClient', 'responseHeaders']);
  addRuntimeImport(file, ['createServiceRoleClient as adminClient', 'createJsonResponseHeaders']);
  addResponseFactory(file);
}

for (const file of [
  'supabase/functions/admin-delete-user/index.ts',
  'supabase/functions/admin-retire-user/index.ts',
  'supabase/functions/admin-user-lifecycle/index.ts',
  'supabase/functions/bulk-sync-profile-phones/index.ts',
  'supabase/functions/auth-health-check/index.ts',
]) {
  const source = read(file);
  if (/function\s+responseHeaders\b/.test(source)) throw new Error(`local responseHeaders survived: ${file}`);
}
for (const file of [
  'supabase/functions/admin-delete-user/index.ts',
  'supabase/functions/admin-retire-user/index.ts',
  'supabase/functions/admin-user-lifecycle/index.ts',
]) {
  const source = read(file);
  if (/function\s+getAllowedOrigins\b/.test(source)) throw new Error(`local getAllowedOrigins survived: ${file}`);
}

console.log('Edge runtime HTTP deduplication completed');
