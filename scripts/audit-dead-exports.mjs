import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import ts from 'typescript';

const ROOT = process.cwd();
const tracked = childProcess.execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const files = tracked.filter((f) => fs.existsSync(f) && /\.(?:ts|tsx|js|jsx|mjs)$/.test(f) && (f.startsWith('src/') || f.startsWith('supabase/functions/')));
const fileSet = new Set(files);
const normalize = (p) => p.replaceAll('\\', '/');
const read = (p) => fs.readFileSync(p, 'utf8');

function resolveLocal(from, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('src/')) return null;
  let abs;
  if (spec.startsWith('@/')) abs = path.join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('src/')) abs = path.join(ROOT, spec);
  else abs = path.resolve(path.dirname(path.join(ROOT, from)), spec);
  for (const c of [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`, `${abs}.jsx`, `${abs}.mjs`, path.join(abs, 'index.ts'), path.join(abs, 'index.tsx')]) {
    const rel = normalize(path.relative(ROOT, c));
    if (fileSet.has(rel)) return rel;
  }
  return null;
}

function parse(file) {
  return ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
}
function hasExportModifier(node) {
  return !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}
function isDefault(node) {
  return !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
}
function namesFromBinding(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    for (const e of name.elements) if (ts.isBindingElement(e)) namesFromBinding(e.name, out);
  }
  return out;
}

const exportsByFile = new Map();
const directUse = new Map(); // target -> names imported/re-exported
const namespaceTargets = new Set();
const starReexports = new Map(); // barrel -> targets
const namedReexports = new Map(); // barrel -> [{target, imported, exported}]
const identifierCounts = new Map();

for (const file of files) {
  const sf = parse(file);
  const exports = [];
  const counts = new Map();
  const visitIds = (node) => {
    if (ts.isIdentifier(node)) counts.set(node.text, (counts.get(node.text) || 0) + 1);
    ts.forEachChild(node, visitIds);
  };
  visitIds(sf);
  identifierCounts.set(file, counts);

  for (const stmt of sf.statements) {
    if (hasExportModifier(stmt) && !isDefault(stmt)) {
      if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) {
        exports.push({ name: stmt.name.text, line: sf.getLineAndCharacterOfPosition(stmt.getStart(sf)).line + 1, kind: ts.SyntaxKind[stmt.kind] });
      } else if (ts.isVariableStatement(stmt)) {
        for (const d of stmt.declarationList.declarations) {
          for (const name of namesFromBinding(d.name)) {
            exports.push({ name, line: sf.getLineAndCharacterOfPosition(d.getStart(sf)).line + 1, kind: 'Variable' });
          }
        }
      }
    }

    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const target = resolveLocal(file, stmt.moduleSpecifier.text);
      if (!target || !stmt.importClause) continue;
      const bindings = stmt.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) namespaceTargets.add(target);
      if (bindings && ts.isNamedImports(bindings)) {
        if (!directUse.has(target)) directUse.set(target, new Set());
        for (const e of bindings.elements) directUse.get(target).add(e.propertyName?.text || e.name.text);
      }
    }

    if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const target = resolveLocal(file, stmt.moduleSpecifier.text);
      if (!target) continue;
      if (!stmt.exportClause) {
        if (!starReexports.has(file)) starReexports.set(file, new Set());
        starReexports.get(file).add(target);
      } else if (ts.isNamedExports(stmt.exportClause)) {
        if (!namedReexports.has(file)) namedReexports.set(file, []);
        if (!directUse.has(target)) directUse.set(target, new Set());
        for (const e of stmt.exportClause.elements) {
          const imported = e.propertyName?.text || e.name.text;
          directUse.get(target).add(imported);
          namedReexports.get(file).push({ target, imported, exported: e.name.text });
        }
      }
    }
  }
  exportsByFile.set(file, exports);
}

// Namespace ambiguity propagates through export-star barrels: if a barrel is namespace-imported,
// any symbol in every star target may be externally selected.
let changed = true;
while (changed) {
  changed = false;
  for (const barrel of [...namespaceTargets]) {
    for (const target of starReexports.get(barrel) || []) {
      if (!namespaceTargets.has(target)) { namespaceTargets.add(target); changed = true; }
    }
  }
}

// Named imports through barrels propagate backwards through explicit named reexports and star reexports.
changed = true;
while (changed) {
  changed = false;
  for (const [barrel, used] of directUse) {
    for (const item of namedReexports.get(barrel) || []) {
      if (!used.has(item.exported)) continue;
      if (!directUse.has(item.target)) directUse.set(item.target, new Set());
      const set = directUse.get(item.target);
      if (!set.has(item.imported)) { set.add(item.imported); changed = true; }
    }
    for (const target of starReexports.get(barrel) || []) {
      if (!directUse.has(target)) directUse.set(target, new Set());
      const set = directUse.get(target);
      for (const name of used) if (!set.has(name)) { set.add(name); changed = true; }
    }
  }
}

const candidates = [];
for (const [file, items] of exportsByFile) {
  if (namespaceTargets.has(file)) continue;
  const used = directUse.get(file) || new Set();
  const counts = identifierCounts.get(file) || new Map();
  for (const item of items) {
    if (used.has(item.name)) continue;
    // Declaration identifier itself counts once. More than once means local/internal use.
    if ((counts.get(item.name) || 0) > 1) continue;
    // Keep ambient/generated type contract out of deletion candidates.
    if (file.endsWith('.d.ts') || file === 'src/types/supabase.ts' || file === 'src/types/supabaseExtensions.ts') continue;
    candidates.push({ file, ...item });
  }
}

const report = {
  generated_at: new Date().toISOString(),
  analyzed_files: files.length,
  namespace_ambiguous_modules: [...namespaceTargets].sort(),
  high_confidence_dead_exports: candidates.sort((a,b) => a.file.localeCompare(b.file) || a.line-b.line),
};
fs.writeFileSync('scripts/.dead-export-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(`analyzed_files=${files.length}`);
console.log(`namespace_ambiguous_modules=${namespaceTargets.size}`);
console.log(`high_confidence_dead_exports=${candidates.length}`);
for (const c of candidates) console.log(`${c.file}:${c.line}\t${c.kind}\t${c.name}`);
