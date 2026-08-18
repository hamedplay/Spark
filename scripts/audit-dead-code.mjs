import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import childProcess from 'node:child_process';
import ts from 'typescript';

const ROOT = process.cwd();
const REPORT = 'scripts/.dead-code-audit.json';
const tracked = childProcess.execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/).filter(Boolean);
const sourceExt = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const codeFiles = tracked.filter((p) => sourceExt.test(p) && (p.startsWith('src/') || p.startsWith('supabase/functions/')));
const codeSet = new Set(codeFiles);

const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(configFile.config || {}, ts.sys, ROOT);
const compilerOptions = parsedConfig.options;

function read(p) { return fs.readFileSync(p, 'utf8'); }
function normalize(p) { return p.replaceAll('\\', '/'); }
function resolveLocal(fromFile, spec) {
  if (!spec || (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('src/'))) return null;
  if (spec.startsWith('@/')) spec = path.join(ROOT, 'src', spec.slice(2));
  else if (spec.startsWith('src/')) spec = path.join(ROOT, spec);
  else spec = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);

  const candidates = [spec, `${spec}.ts`, `${spec}.tsx`, `${spec}.js`, `${spec}.jsx`, `${spec}.mjs`, `${spec}.cjs`,
    path.join(spec, 'index.ts'), path.join(spec, 'index.tsx'), path.join(spec, 'index.js'), path.join(spec, 'index.jsx')];
  for (const c of candidates) {
    const rel = normalize(path.relative(ROOT, c));
    if (codeSet.has(rel)) return rel;
  }
  return null;
}

const graph = new Map(codeFiles.map((f) => [f, new Set()]));
const incoming = new Map(codeFiles.map((f) => [f, new Set()]));
const functionBodies = new Map();

for (const file of codeFiles) {
  const text = read(file);
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : ts.ScriptKind.TS);

  const addSpec = (spec) => {
    const target = resolveLocal(file, spec);
    if (target) {
      graph.get(file).add(target);
      incoming.get(target).add(file);
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) addSpec(node.moduleSpecifier.text);
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) addSpec(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) addSpec(node.arguments[0].text);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'require' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) addSpec(node.arguments[0].text);

    const isFn = ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
    if (isFn && node.body) {
      const bodyText = node.body.getText(sf).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\s+/g, ' ').trim();
      const lineCount = node.body.getText(sf).split(/\r?\n/).length;
      if (lineCount >= 8 && bodyText.length >= 160) {
        const hash = crypto.createHash('sha256').update(bodyText).digest('hex');
        const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const name = node.name && ts.isIdentifier(node.name) ? node.name.text : '(anonymous)';
        const item = { file, line: pos.line + 1, name, lines: lineCount };
        if (!functionBodies.has(hash)) functionBodies.set(hash, []);
        functionBodies.get(hash).push(item);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const productionEntries = new Set();
if (codeSet.has('src/main.tsx')) productionEntries.add('src/main.tsx');
for (const f of codeFiles) {
  if (/^supabase\/functions\/[^/]+\/index\.(?:ts|js)$/.test(f)) productionEntries.add(f);
}

function reachableFrom(entries) {
  const seen = new Set();
  const stack = [...entries];
  while (stack.length) {
    const f = stack.pop();
    if (!f || seen.has(f) || !graph.has(f)) continue;
    seen.add(f);
    for (const dep of graph.get(f)) stack.push(dep);
  }
  return seen;
}
const prodReachable = reachableFrom(productionEntries);

const textualReferences = new Map(codeFiles.map((f) => [f, []]));
const nonCodeTextFiles = tracked.filter((p) => !codeSet.has(p) && /\.(?:json|jsonc|yaml|yml|md|html|toml|sh|mjs|js|ts|tsx)$/.test(p));
for (const target of codeFiles) {
  const base = path.basename(target).replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, '');
  const relNoExt = target.replace(/\.(?:ts|tsx|js|jsx|mjs|cjs)$/, '');
  for (const f of nonCodeTextFiles) {
    let txt;
    try { txt = read(f); } catch { continue; }
    if (txt.includes(target) || txt.includes(relNoExt) || (base.length > 5 && txt.includes(base))) textualReferences.get(target).push(f);
  }
}

const unreachable = codeFiles.filter((f) => !prodReachable.has(f));
const strongDeadFileCandidates = unreachable.filter((f) => incoming.get(f).size === 0 && textualReferences.get(f).length === 0);
const unreachableWithReferences = unreachable.filter((f) => !strongDeadFileCandidates.includes(f));

const duplicateFunctions = [...functionBodies.entries()]
  .filter(([, items]) => items.length > 1)
  .map(([hash, items]) => ({ hash, items }))
  .sort((a, b) => b.items.reduce((s, i) => s + i.lines, 0) - a.items.reduce((s, i) => s + i.lines, 0));

const contentHash = new Map();
for (const file of codeFiles) {
  const text = read(file).trim();
  if (!text) continue;
  const hash = crypto.createHash('sha256').update(text).digest('hex');
  if (!contentHash.has(hash)) contentHash.set(hash, []);
  contentHash.get(hash).push(file);
}
const duplicateFiles = [...contentHash.values()].filter((v) => v.length > 1);

const result = {
  generated_at: new Date().toISOString(),
  code_files: codeFiles.length,
  production_entries: [...productionEntries].sort(),
  production_reachable: prodReachable.size,
  production_unreachable: unreachable.sort(),
  strong_dead_file_candidates: strongDeadFileCandidates.sort(),
  unreachable_with_references: unreachableWithReferences.sort().map((file) => ({
    file,
    incoming: [...incoming.get(file)].sort(),
    textual_references: textualReferences.get(file).sort(),
  })),
  duplicate_files: duplicateFiles,
  exact_duplicate_functions: duplicateFunctions.slice(0, 100),
};
fs.writeFileSync(REPORT, JSON.stringify(result, null, 2) + '\n');
console.log(`code_files=${result.code_files}`);
console.log(`production_reachable=${result.production_reachable}`);
console.log(`production_unreachable=${result.production_unreachable.length}`);
console.log(`strong_dead_file_candidates=${result.strong_dead_file_candidates.length}`);
console.log(`exact_duplicate_function_groups=${duplicateFunctions.length}`);
