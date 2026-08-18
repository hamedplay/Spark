import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import ts from 'typescript';

const ROOT = process.cwd();
const tracked = childProcess.execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const codeFiles = tracked.filter((p) => fs.existsSync(p) && /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(p) && (p.startsWith('src/') || p.startsWith('supabase/functions/')));
const codeSet = new Set(codeFiles);
const normalize = (p) => p.replaceAll('\\', '/');

function resolveLocal(fromFile, spec) {
  if (!spec || (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('src/'))) return null;
  let abs;
  if (spec.startsWith('@/')) abs = path.join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('src/')) abs = path.join(ROOT, spec);
  else abs = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  for (const c of [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`, `${abs}.jsx`, `${abs}.mjs`, `${abs}.cjs`, path.join(abs, 'index.ts'), path.join(abs, 'index.tsx')]) {
    const rel = normalize(path.relative(ROOT, c));
    if (codeSet.has(rel)) return rel;
  }
  return null;
}

const graph = new Map(codeFiles.map((f) => [f, new Set()]));
const bodies = new Map();
for (const file of codeFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS);
  const add = (spec) => { const target = resolveLocal(file, spec); if (target) graph.get(file).add(target); };
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) add(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) add(node.arguments[0].text);
    const isFn = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
    if (isFn && node.body) {
      const raw = node.body.getText(sf);
      const lines = raw.split(/\r?\n/).length;
      const normalizedBody = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
      if (lines >= 8 && normalizedBody.length >= 160) {
        const hash = crypto.createHash('sha256').update(normalizedBody).digest('hex');
        const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const item = { file, line: pos.line + 1, name: node.name && ts.isIdentifier(node.name) ? node.name.text : '(anonymous)', lines };
        if (!bodies.has(hash)) bodies.set(hash, []);
        bodies.get(hash).push(item);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const entries = new Set(codeSet.has('src/main.tsx') ? ['src/main.tsx'] : []);
for (const f of codeFiles) if (/^supabase\/functions\/[^/]+\/index\.(?:ts|js)$/.test(f)) entries.add(f);
const reachable = new Set();
const stack = [...entries];
while (stack.length) {
  const f = stack.pop();
  if (!f || reachable.has(f)) continue;
  reachable.add(f);
  for (const dep of graph.get(f) || []) stack.push(dep);
}

const duplicateGroups = [...bodies.entries()]
  .filter(([, items]) => items.length > 1)
  .map(([hash, items]) => ({ hash, total_lines: items.reduce((n, x) => n + x.lines, 0), items }))
  .sort((a, b) => b.total_lines - a.total_lines);
const report = {
  generated_at: new Date().toISOString(),
  code_files: codeFiles.length,
  reachable_files: reachable.size,
  production_unreachable: codeFiles.filter((f) => !reachable.has(f)).sort(),
  exact_duplicate_function_groups: duplicateGroups,
};
fs.writeFileSync('scripts/.final-dead-code-audit.json', JSON.stringify(report, null, 2) + '\n');
console.log(`code_files=${report.code_files}`);
console.log(`reachable_files=${report.reachable_files}`);
console.log(`production_unreachable=${report.production_unreachable.length}`);
console.log(`exact_duplicate_function_groups=${duplicateGroups.length}`);
