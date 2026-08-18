// one-time execution trigger 2
import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.endsWith('\n') ? s : `${s}\n`);
const parse = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const retiredHandler = `import { createServiceRoleClient } from "./runtimeHttp.ts";

const baseHeaders: Record<string, string> = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
  "Vary": "Origin",
};

function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = { ...baseHeaders };
  if (allowedOrigin) headers["Access-Control-Allow-Origin"] = allowedOrigin;
  return headers;
}

async function getConfig(): Promise<{ origins: string[] }> {
  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("get_phone_auth_config");
  if (error || !data) throw new Error("CONFIG_UNAVAILABLE");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("CONFIG_UNAVAILABLE");
  const allowedOrigins: string[] = Array.isArray(row?.allowed_origins) ? row.allowed_origins : [];
  return { origins: allowedOrigins };
}

export async function retiredPhoneLoginRoute(req: Request): Promise<Response> {
  let allowedOrigin: string | null = null;

  try {
    const config = await getConfig();
    const origin = req.headers.get("Origin");
    if (origin && config.origins.includes(origin)) allowedOrigin = origin;
  } catch {
    return new Response(JSON.stringify({ error: "LOGIN_UNAVAILABLE" }), {
      status: 503,
      headers: { ...corsHeaders(null), "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders(allowedOrigin) });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "METHOD_NOT_ALLOWED" }), {
      status: 405,
      headers: { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ error: "LOGIN_ROUTE_REPLACED" }), {
    status: 410,
    headers: { ...corsHeaders(allowedOrigin), "Content-Type": "application/json" },
  });
}
`;
write('supabase/functions/_shared/retiredPhoneLoginRoute.ts', retiredHandler);

const legacyEntrypoint = `import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";
import { retiredPhoneLoginRoute } from "../_shared/retiredPhoneLoginRoute.ts";

Deno.serve(retiredPhoneLoginRoute);
`;
const legacyFiles = [
  'supabase/functions/request-phone-login-otp/index.ts',
  'supabase/functions/verify-phone-login-otp/index.ts',
];
const legacyOriginals = legacyFiles.map(read);
if (legacyOriginals[0] !== legacyOriginals[1]) throw new Error('legacy route files are no longer exact duplicates');
if (!legacyOriginals[0].includes('LOGIN_ROUTE_REPLACED') || !legacyOriginals[0].includes('status: 410')) {
  throw new Error('legacy route contract changed; refusing shared-handler rewrite');
}
for (const file of legacyFiles) write(file, legacyEntrypoint);

function removeTopLevelDeclarations(file, names) {
  let source = read(file);
  const sf = parse(file, source);
  const targets = [];
  for (const stmt of sf.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && names.includes(stmt.name.text)) targets.push(stmt);
    if (ts.isInterfaceDeclaration(stmt) && names.includes(stmt.name.text)) targets.push(stmt);
    if (ts.isVariableStatement(stmt)) {
      const declared = stmt.declarationList.declarations
        .filter((d) => ts.isIdentifier(d.name))
        .map((d) => d.name.text);
      if (declared.some((name) => names.includes(name))) targets.push(stmt);
    }
  }
  for (const name of names) {
    const found = targets.some((stmt) => {
      if ((ts.isFunctionDeclaration(stmt) || ts.isInterfaceDeclaration(stmt)) && stmt.name) return stmt.name.text === name;
      return ts.isVariableStatement(stmt) && stmt.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name);
    });
    if (!found) throw new Error(`${file}: expected declaration ${name}`);
  }
  targets.sort((a, b) => b.getFullStart() - a.getFullStart());
  for (const node of targets) source = source.slice(0, node.getFullStart()) + source.slice(node.getEnd());
  write(file, source);
}

function addToSharedPhoneOtp() {
  const file = 'supabase/functions/_shared/phoneOtpLoginV2.ts';
  let source = read(file);
  for (const name of ['PHONE_OTP_MAX_BODY_BYTES', 'PHONE_OTP_MAX_RAW_PHONE_LEN', 'getPhoneAuthConfig']) {
    if (source.includes(name)) throw new Error(`shared module already defines ${name}`);
  }
  source += `
export const PHONE_OTP_MAX_BODY_BYTES = 2048;
export const PHONE_OTP_MAX_RAW_PHONE_LEN = 32;

export interface PhoneAuthConfig {
  origins: string[];
  pepper: string;
}

export async function getPhoneAuthConfig(): Promise<PhoneAuthConfig> {
  const admin = adminClient();
  const { data, error } = await admin.rpc("get_phone_auth_config");
  if (error || !data) throw new Error("CONFIG_UNAVAILABLE");
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("CONFIG_UNAVAILABLE");
  const allowedOrigins: string[] = Array.isArray(row?.allowed_origins) ? row.allowed_origins : [];
  const pepper: string = typeof row?.pepper === "string" ? row.pepper : "";
  return { origins: allowedOrigins, pepper };
}
`;
  write(file, source);
}
addToSharedPhoneOtp();

function augmentSharedImport(file) {
  let source = read(file);
  const sf = parse(file, source);
  const target = sf.statements.find((stmt) =>
    ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier) && stmt.moduleSpecifier.text === '../_shared/phoneOtpLoginV2.ts'
  );
  if (!target || !ts.isImportDeclaration(target) || !target.importClause?.namedBindings || !ts.isNamedImports(target.importClause.namedBindings)) {
    throw new Error(`${file}: shared phoneOtpLoginV2 named import not found`);
  }
  const existing = target.importClause.namedBindings.elements.map((e) => e.getText(sf));
  const additions = [
    'PHONE_OTP_MAX_BODY_BYTES as MAX_BODY_BYTES',
    'PHONE_OTP_MAX_RAW_PHONE_LEN as MAX_RAW_PHONE_LEN',
    'type PhoneAuthConfig',
    'getPhoneAuthConfig',
  ];
  const replacement = `import {\n  ${[...existing, ...additions].join(',\n  ')},\n} from "../_shared/phoneOtpLoginV2.ts";`;
  source = source.slice(0, target.getStart(sf)) + replacement + source.slice(target.getEnd());
  write(file, source);
}

for (const file of [
  'supabase/functions/request-phone-login-otp-v2/index.ts',
  'supabase/functions/verify-phone-login-otp-v2/index.ts',
]) {
  removeTopLevelDeclarations(file, ['MAX_BODY_BYTES', 'MAX_RAW_PHONE_LEN', 'PhoneAuthConfig', 'getPhoneAuthConfig']);
  augmentSharedImport(file);
  const source = read(file);
  if (/async function getPhoneAuthConfig\b/.test(source)) throw new Error(`local getPhoneAuthConfig survived: ${file}`);
}

console.log('phone login route/config deduplication completed');
