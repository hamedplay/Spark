import fs from 'node:fs';
import childProcess from 'node:child_process';
import ts from 'typescript';

const REPORT = 'scripts/.dead-export-audit.json';
if (!fs.existsSync(REPORT)) throw new Error('dead-export audit report is missing');
const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
const candidates = report.high_confidence_dead_exports || [];
const ignored = new Set([
  REPORT,
  'scripts/audit-dead-exports.mjs',
  'scripts/remove-single-reference-dead-symbols.mjs',
  '.github/workflows/dead-export-audit.yml',
  '.github/workflows/remove-single-reference-dead-symbols.yml',
]);
const tracked = childProcess.execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean);
const textFiles = tracked.filter((f) => fs.existsSync(f) && !ignored.has(f));

function wordOccurrences(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (text.match(new RegExp(`\\b${escaped}\\b`, 'g')) || []).length;
}
function parse(file, source) {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : file.endsWith('.jsx') ? ts.ScriptKind.JSX : file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
}
function declarationName(node) {
  if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) return node.name.text;
  if (ts.isVariableStatement(node) && node.declarationList.declarations.length === 1) {
    const d = node.declarationList.declarations[0];
    if (ts.isIdentifier(d.name)) return d.name.text;
  }
  return null;
}

const removable = [];
for (const c of candidates) {
  if (!c?.file || !c?.name || !fs.existsSync(c.file)) continue;
  if (!c.file.startsWith('src/') && !c.file.startsWith('supabase/functions/')) continue;
  if (c.file.endsWith('.d.ts') || c.file === 'src/types/supabase.ts' || c.file === 'src/types/supabaseExtensions.ts') continue;
  let count = 0;
  const locations = [];
  for (const f of textFiles) {
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const n = wordOccurrences(text, c.name);
    if (n) { count += n; locations.push([f, n]); }
    if (count > 1) break;
  }
  if (count === 1 && locations.length === 1 && locations[0][0] === c.file) removable.push(c);
}

const byFile = new Map();
for (const c of removable) {
  if (!byFile.has(c.file)) byFile.set(c.file, []);
  byFile.get(c.file).push(c.name);
}

const removed = [];
for (const [file, names] of byFile) {
  let source = fs.readFileSync(file, 'utf8');
  const sf = parse(file, source);
  const ranges = [];
  for (const name of names) {
    const matches = sf.statements.filter((stmt) => declarationName(stmt) === name);
    if (matches.length !== 1) {
      console.log(`skip ambiguous declaration ${file}:${name} matches=${matches.length}`);
      continue;
    }
    const stmt = matches[0];
    // Only delete named exported top-level declarations identified by the audit.
    const isExported = !!stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (!isExported) {
      console.log(`skip non-export declaration ${file}:${name}`);
      continue;
    }
    ranges.push({ start: stmt.getFullStart(), end: stmt.getEnd(), name });
  }
  ranges.sort((a,b)=>b.start-a.start);
  for (const r of ranges) {
    source = source.slice(0,r.start) + source.slice(r.end);
    removed.push({ file, name: r.name });
  }
  if (ranges.length) fs.writeFileSync(file, source.endsWith('\n') ? source : `${source}\n`);
}

fs.writeFileSync('/tmp/dead-symbol-removals.json', JSON.stringify(removed, null, 2));
console.log(`single_reference_dead_symbols=${removable.length}`);
console.log(`removed=${removed.length}`);
for (const x of removed) console.log(`${x.file}\t${x.name}`);
