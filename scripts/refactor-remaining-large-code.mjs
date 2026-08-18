import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.endsWith('\n') ? s : `${s}\n`);
const lines = (s) => s.split(/\r?\n/).length;
const fail = (message) => { throw new Error(message); };
const mustFind = (text, marker, label = marker) => {
  const i = text.indexOf(marker);
  if (i < 0) fail(`marker not found: ${label}`);
  return i;
};

function refactorDailyReport() {
  const indexPath = 'supabase/functions/send-daily-meetings/index.ts';
  const supportPath = 'supabase/functions/send-daily-meetings/dailyReportSupport.ts';
  const source = read(indexPath);
  const supportStartMarker = '// Daily report edge function';
  const mainMarker = '// ─── Main handler';
  const supportStart = mustFind(source, supportStartMarker, 'daily support start');
  const mainStart = mustFind(source, mainMarker, 'daily main handler');
  if (supportStart >= mainStart) fail('daily support markers out of order');

  let supportBody = source.slice(supportStart, mainStart).trimEnd();
  const exportedNames = [];
  supportBody = supportBody.replace(/^(const|function|async function)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, name) => {
    exportedNames.push(name);
    return `export ${kind} ${name}`;
  });

  const handler = source.slice(mainStart);
  const usedNames = exportedNames.filter((name) => new RegExp(`\\b${name}\\b`).test(handler));
  if (!usedNames.includes('corsHeaders') || !usedNames.includes('authorize') || !usedNames.includes('adminClient')) {
    fail(`daily support usage detection incomplete: ${usedNames.join(', ')}`);
  }

  const support = `import { createClient } from "npm:@supabase/supabase-js@2.112.3";\nimport { requireFullAuthAccess } from "../_shared/requireFullAuthAccess.ts";\n\n${supportBody}\n`;
  const index = `import "jsr:@supabase/functions-js@2.111.0/edge-runtime.d.ts";\nimport { deniedResponse } from "../_shared/requireFullAuthAccess.ts";\nimport {\n${usedNames.map((n) => `  ${n},`).join('\n')}\n} from "./dailyReportSupport.ts";\n\n${handler}`;

  write(supportPath, support);
  write(indexPath, index);
  return { indexPath, supportPath };
}

function findTopLevel(sourceFile, predicate) {
  return sourceFile.statements.find(predicate) ?? null;
}

function findIfByExpression(root, sourceFile, expressionText) {
  let found = null;
  const normalizedTarget = expressionText.replace(/\s+/g, '');
  const visit = (node) => {
    if (found) return;
    if (ts.isIfStatement(node)) {
      const text = node.expression.getText(sourceFile).replace(/\s+/g, '');
      if (text === normalizedTarget) {
        found = node;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function refactorSendSms() {
  const indexPath = 'supabase/functions/send-sms/index.ts';
  const modesPath = 'supabase/functions/send-sms/requestModes.ts';
  const phonePath = 'supabase/functions/send-sms/phone.ts';
  const source = read(indexPath);
  const sf = ts.createSourceFile(indexPath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const phoneReNode = findTopLevel(sf, (n) => ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === 'PHONE_RE'));
  const normalizeNode = findTopLevel(sf, (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'normalizePhone');
  const validNode = findTopLevel(sf, (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'isValidPhone');
  if (!phoneReNode || !normalizeNode || !validNode) fail('send-sms phone helpers not found');

  const dispatchIf = findIfByExpression(sf, sf, 'mode === "dispatch"');
  const externalIf = findIfByExpression(sf, sf, 'mode === "external"');
  if (!dispatchIf || !externalIf || !ts.isBlock(dispatchIf.thenStatement) || !ts.isBlock(externalIf.thenStatement)) {
    fail('send-sms mode blocks not found');
  }

  const blockInterior = (b) => source.slice(b.getStart(sf) + 1, b.getEnd() - 1);
  const dispatchBody = blockInterior(dispatchIf.thenStatement);
  const externalBody = blockInterior(externalIf.thenStatement);

  const phoneConstText = source.slice(phoneReNode.getStart(sf), phoneReNode.getEnd());
  const normalizeText = source.slice(normalizeNode.getStart(sf), normalizeNode.getEnd());
  const validText = source.slice(validNode.getStart(sf), validNode.getEnd());
  const phone = `${phoneConstText}\n\nexport ${normalizeText}\n\nexport ${validText}\n`;

  const modes = `import { createClient } from "npm:@supabase/supabase-js@2.112.3";\nimport { isValidPhone, normalizePhone } from "./phone.ts";\n\ntype SmsClient = ReturnType<typeof createClient>;\ntype Caller = { userId: string; isAdmin: boolean };\ntype JsonResponder = (data: unknown, status?: number) => Response;\ntype ModeContext = {\n  supabase: SmsClient;\n  body: Record<string, any>;\n  caller: Caller;\n  json: JsonResponder;\n};\n\nexport async function handleDispatchMode({ supabase, body, caller, json }: ModeContext): Promise<Response> {${dispatchBody}\n}\n\nexport async function handleExternalMode({ supabase, body, caller, json, isAuthOtp }: ModeContext & { isAuthOtp: boolean }): Promise<Response> {${externalBody}\n}\n`;

  const replacements = [
    { start: dispatchIf.getStart(sf), end: dispatchIf.getEnd(), text: 'if (mode === "dispatch") {\n      return await handleDispatchMode({ supabase, body, caller, json });\n    }' },
    { start: externalIf.getStart(sf), end: externalIf.getEnd(), text: 'if (mode === "external") {\n      return await handleExternalMode({ supabase, body, caller, json, isAuthOtp });\n    }' },
    { start: phoneReNode.getFullStart(), end: phoneReNode.getEnd(), text: '' },
    { start: normalizeNode.getFullStart(), end: normalizeNode.getEnd(), text: '' },
    { start: validNode.getFullStart(), end: validNode.getEnd(), text: '' },
  ].sort((a, b) => b.start - a.start);

  let next = source;
  for (const r of replacements) next = next.slice(0, r.start) + r.text + next.slice(r.end);

  const sf2 = ts.createSourceFile(indexPath, next, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = sf2.statements.filter(ts.isImportDeclaration);
  if (!imports.length) fail('send-sms imports not found after transform');
  const insertAt = imports[imports.length - 1].getEnd();
  const addedImports = `\nimport { normalizePhone } from "./phone.ts";\nimport { handleDispatchMode, handleExternalMode } from "./requestModes.ts";`;
  next = next.slice(0, insertAt) + addedImports + next.slice(insertAt);

  write(phonePath, phone);
  write(modesPath, modes);
  write(indexPath, next);
  return { indexPath, modesPath, phonePath };
}

function splitPhase3cTest() {
  const originalPath = 'tests/phase3/phase3cSecurity.test.ts';
  const servicePath = 'tests/phase3/phase3cSecurityService.test.ts';
  const packagePath = 'package.json';
  const source = read(originalPath);
  const migrationMarker = '// ═══ Migration Tests';
  const serviceMarker = '// ═══ Service Layer Tests';
  const migrationStart = mustFind(source, migrationMarker, 'phase3c migration tests marker');
  const serviceStart = mustFind(source, serviceMarker, 'phase3c service tests marker');
  if (migrationStart >= serviceStart) fail('phase3c split markers out of order');

  const prefix = source.slice(0, migrationStart);
  const first = prefix + source.slice(migrationStart, serviceStart).trimEnd() + '\n';
  const second = prefix + source.slice(serviceStart);
  write(originalPath, first);
  write(servicePath, second);

  const pkg = read(packagePath);
  const oldCommand = 'node --import tsx --test tests/phase3/phase3cSecurity.test.ts';
  const newCommand = 'node --import tsx --test tests/phase3/phase3cSecurity.test.ts tests/phase3/phase3cSecurityService.test.ts';
  const occurrences = pkg.split(oldCommand).length - 1;
  if (occurrences !== 1) fail(`expected exactly one phase3c package command, found ${occurrences}`);
  write(packagePath, pkg.replace(oldCommand, newCommand));
  return { originalPath, servicePath, packagePath };
}

const daily = refactorDailyReport();
const sms = refactorSendSms();
const phase3c = splitPhase3cTest();

const targets = [
  daily.indexPath, daily.supportPath,
  sms.indexPath, sms.modesPath, sms.phonePath,
  phase3c.originalPath, phase3c.servicePath,
];

for (const path of targets) {
  const count = lines(read(path));
  if (count > 1000) fail(`${path} still exceeds 1000 lines: ${count}`);
}

const report = targets.map((path) => `${lines(read(path))}\t${path}`).join('\n');
write('scripts/.remaining-large-refactor-status.txt', `TRANSFORM_OK\n${report}\n`);
console.log(report);
