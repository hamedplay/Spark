// one-time execution trigger
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import ts from 'typescript';

const ROOT = process.cwd();
const deadFiles = [
  'src/components/PortalConfig/MfaPanel.tsx',
  'src/components/PortalConfig/PasswordRecoveryCard.tsx',
  'src/components/PortalConfig/PhoneLoginToggleCard.tsx',
  'src/features/auth/services/healthCheckService.ts',
  'src/features/auth/types/healthCheck.ts',
  'src/features/auth/types/recovery.ts',
  'src/features/security-administration/components/AccountLifecycleActionDialog.tsx',
  'src/features/security-administration/components/AccountLifecycleHistory.tsx',
  'src/features/security-administration/components/AccountLifecycleManagement.tsx',
  'src/features/security-administration/components/HealthCheckPanel.tsx',
  'src/features/security-administration/components/SecurityAdminHistory.tsx',
  'src/features/security-administration/components/SecurityAdminManagement.tsx',
  'src/features/security-administration/components/SecurityAdminRoleDialog.tsx',
  'src/features/security-administration/components/SecurityAuditConsole.tsx',
  'src/features/security-administration/components/SecurityAuditDetails.tsx',
  'src/features/security-administration/components/SecurityControlCenter.tsx',
  'src/features/security-administration/index.ts',
  'src/features/security-administration/services/accountLifecycleService.ts',
  'src/features/security-administration/services/securityAdministrationService.ts',
  'src/features/security-administration/types/accountLifecycle.ts',
  'src/features/security-administration/types/securityAdministration.ts',
  'src/features/security-administration/utils/securityAdministrationValidation.ts',
  'src/features/security-administration/utils/securityAuditLabels.ts',
  'src/features/security-administration/utils/tehranDateRange.ts',
];
const deadSet = new Set(deadFiles);
const deadFragments = deadFiles.map((f) => f.replaceAll('\\', '/'));

for (const file of deadFiles) {
  if (!fs.existsSync(file)) throw new Error(`dead-island candidate missing: ${file}`);
}

const trackedTests = childProcess.execFileSync('git', ['ls-files', 'tests'], { encoding: 'utf8' })
  .split(/\r?\n/).filter((f) => f && /\.(?:ts|tsx|mjs|js)$/.test(f) && fs.existsSync(f));

function normalize(p) { return p.replaceAll('\\', '/'); }
function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const abs = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  const candidates = [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`, `${abs}.mjs`, path.join(abs, 'index.ts'), path.join(abs, 'index.tsx')];
  for (const c of candidates) {
    const rel = normalize(path.relative(ROOT, c));
    if (deadSet.has(rel)) return rel;
  }
  return null;
}
function bindingNames(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const el of name.elements) if (ts.isBindingElement(el)) bindingNames(el.name, out);
  }
  return out;
}
function statementDeclaredNames(stmt) {
  const names = [];
  if (ts.isVariableStatement(stmt)) {
    for (const d of stmt.declarationList.declarations) bindingNames(d.name, names);
  } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) && stmt.name) {
    names.push(stmt.name.text);
  }
  return names;
}
function importedNames(node) {
  const names = [];
  const c = node.importClause;
  if (!c) return names;
  if (c.name) names.push(c.name.text);
  if (c.namedBindings) {
    if (ts.isNamespaceImport(c.namedBindings)) names.push(c.namedBindings.name.text);
    else for (const e of c.namedBindings.elements) names.push(e.name.text);
  }
  return names;
}
function identifiersIn(node) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isIdentifier(n)) names.add(n.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}
function containsDeadPath(text) {
  const normalized = normalize(text);
  return deadFragments.some((f) => normalized.includes(f));
}
function isTestStatement(stmt) {
  return ts.isExpressionStatement(stmt) && ts.isCallExpression(stmt.expression) &&
    ts.isIdentifier(stmt.expression.expression) && ['test', 'it'].includes(stmt.expression.expression.text);
}
function testTitle(stmt, sf) {
  if (!isTestStatement(stmt)) return null;
  const arg = stmt.expression.arguments[0];
  return arg && (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) ? arg.text : stmt.getText(sf).slice(0, 120);
}
function applyRemovals(source, ranges) {
  const sorted = ranges.sort((a, b) => b.start - a.start);
  let out = source;
  for (const r of sorted) out = out.slice(0, r.start) + out.slice(r.end);
  return out;
}
function parse(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
}
function pruneUnusedTopLevel(file, source) {
  let current = source;
  for (let round = 0; round < 8; round++) {
    const sf = parse(file, current);
    const counts = new Map();
    const visit = (n) => {
      if (ts.isIdentifier(n)) counts.set(n.text, (counts.get(n.text) || 0) + 1);
      ts.forEachChild(n, visit);
    };
    visit(sf);
    const ranges = [];
    for (const stmt of sf.statements) {
      if (ts.isImportDeclaration(stmt)) {
        const names = importedNames(stmt);
        if (names.length && names.every((n) => (counts.get(n) || 0) <= 1)) {
          ranges.push({ start: stmt.getFullStart(), end: stmt.getEnd() });
        }
        continue;
      }
      if (isTestStatement(stmt)) continue;
      const names = statementDeclaredNames(stmt);
      if (names.length && names.every((n) => (counts.get(n) || 0) <= 1)) {
        ranges.push({ start: stmt.getFullStart(), end: stmt.getEnd() });
      }
    }
    if (!ranges.length) return current;
    current = applyRemovals(current, ranges);
  }
  return current;
}

const removedTests = [];
const touchedTests = [];
for (const file of trackedTests) {
  let source = fs.readFileSync(file, 'utf8');
  const sf = parse(file, source);
  const deadIdentifiers = new Set();
  const remove = new Set();

  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      if (resolveImport(file, stmt.moduleSpecifier.text)) {
        for (const n of importedNames(stmt)) deadIdentifiers.add(n);
        remove.add(stmt);
      }
    } else if (containsDeadPath(stmt.getText(sf))) {
      if (!isTestStatement(stmt)) {
        for (const n of statementDeclaredNames(stmt)) deadIdentifiers.add(n);
        if (statementDeclaredNames(stmt).length) remove.add(stmt);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const stmt of sf.statements) {
      if (remove.has(stmt) || isTestStatement(stmt) || ts.isImportDeclaration(stmt)) continue;
      const declared = statementDeclaredNames(stmt);
      if (!declared.length) continue;
      const ids = identifiersIn(stmt);
      if ([...deadIdentifiers].some((n) => ids.has(n))) {
        remove.add(stmt);
        for (const n of declared) if (!deadIdentifiers.has(n)) { deadIdentifiers.add(n); changed = true; }
      }
    }
  }

  for (const stmt of sf.statements) {
    if (!isTestStatement(stmt)) continue;
    const ids = identifiersIn(stmt);
    if (containsDeadPath(stmt.getText(sf)) || [...deadIdentifiers].some((n) => ids.has(n))) {
      remove.add(stmt);
      removedTests.push({ file, title: testTitle(stmt, sf) });
    }
  }

  if (remove.size) {
    const ranges = [...remove].map((stmt) => ({ start: stmt.getFullStart(), end: stmt.getEnd() }));
    source = applyRemovals(source, ranges);
    source = pruneUnusedTopLevel(file, source);
    source = source.replace(/^.*(?:MfaPanel|security-administration|SecurityControlCenter|SecurityAdmin|AccountLifecycle|HealthCheckPanel).*$\n?/gm, (line) => line.trimStart().startsWith('//') ? '' : line);
    fs.writeFileSync(file, source.endsWith('\n') ? source : `${source}\n`);
    touchedTests.push(file);
  }
}

for (const file of trackedTests) {
  const text = fs.readFileSync(file, 'utf8');
  if (containsDeadPath(text)) throw new Error(`test still references dead source path: ${file}`);
}

for (const file of deadFiles) fs.unlinkSync(file);

fs.writeFileSync('/tmp/dead-island-transform.json', JSON.stringify({ deadFiles, touchedTests, removedTests }, null, 2));
console.log(`dead_files_removed=${deadFiles.length}`);
console.log(`test_files_updated=${touchedTests.length}`);
console.log(`obsolete_tests_removed=${removedTests.length}`);
for (const item of removedTests) console.log(`removed_test\t${item.file}\t${item.title}`);
