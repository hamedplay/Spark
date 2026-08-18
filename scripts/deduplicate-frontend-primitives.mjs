// one-time execution trigger
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import ts from 'typescript';

const ROOT = process.cwd();
const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.endsWith('\n') ? s : `${s}\n`);
const normalize = (p) => p.replaceAll('\\', '/');

const configToggle = `export interface ConfigToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  color?: string;
}

function ToggleBase({ value, onChange, color }: Required<ConfigToggleProps>) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={\`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 \${value ? color : 'bg-gray-200 dark:bg-gray-600'}\`}
    >
      <span className={\`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform \${value ? 'translate-x-5' : 'translate-x-0.5'}\`} />
    </button>
  );
}

function createConfigToggle(defaultColor: string) {
  return function ConfigToggle({ value, onChange, color = defaultColor }: ConfigToggleProps) {
    return <ToggleBase value={value} onChange={onChange} color={color} />;
  };
}

export const NotificationToggle = createConfigToggle('bg-amber-500');
export const SmsToggle = createConfigToggle('bg-green-500');
`;

const spinner = `export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </svg>
  );
}
`;

write('src/components/ConfigToggle.tsx', configToggle);
write('src/components/Spinner.tsx', spinner);

const trackedSrc = childProcess.execFileSync('git', ['ls-files', 'src'], { encoding: 'utf8' })
  .split(/\r?\n/).filter((f) => f && /\.(?:ts|tsx|js|jsx)$/.test(f) && fs.existsSync(f));
const targetNotif = 'src/components/NotificationsConfig/Toggle.tsx';
const targetSms = 'src/components/SmsConfig/Toggle.tsx';
const targetOrgSpinner = 'src/components/OrgStructure/Spinner.tsx';

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('.')) return null;
  const abs = path.resolve(path.dirname(path.join(ROOT, fromFile)), spec);
  const candidates = [abs, `${abs}.ts`, `${abs}.tsx`, `${abs}.js`, `${abs}.jsx`, path.join(abs, 'index.ts'), path.join(abs, 'index.tsx')];
  for (const c of candidates) {
    const rel = normalize(path.relative(ROOT, c));
    if ([targetNotif, targetSms, targetOrgSpinner].includes(rel)) return rel;
  }
  return null;
}
function relSpec(fromFile, targetFile) {
  let rel = normalize(path.relative(path.dirname(fromFile), targetFile.replace(/\.(?:ts|tsx)$/, '')));
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

let notifImporters = 0;
let smsImporters = 0;
let spinnerImporters = 0;
for (const file of trackedSrc) {
  if ([targetNotif, targetSms, targetOrgSpinner].includes(file)) continue;
  let source = read(file);
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const replacements = [];
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const target = resolveImport(file, stmt.moduleSpecifier.text);
    if (!target) continue;
    const clause = stmt.importClause;
    if (!clause?.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.name) {
      throw new Error(`unsupported import shape for ${target} in ${file}`);
    }
    const elements = clause.namedBindings.elements;
    if (elements.length !== 1 || elements[0].name.text !== 'Toggle' && target !== targetOrgSpinner) {
      throw new Error(`unexpected Toggle import shape in ${file}`);
    }
    if (target === targetNotif) {
      const spec = relSpec(file, 'src/components/ConfigToggle.tsx');
      replacements.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: `import { NotificationToggle as Toggle } from '${spec}';` });
      notifImporters++;
    } else if (target === targetSms) {
      const spec = relSpec(file, 'src/components/ConfigToggle.tsx');
      replacements.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: `import { SmsToggle as Toggle } from '${spec}';` });
      smsImporters++;
    } else {
      const names = elements.map((e) => e.name.text);
      if (elements.length !== 1 || names[0] !== 'Spinner') throw new Error(`unexpected Spinner import shape in ${file}`);
      const spec = relSpec(file, 'src/components/Spinner.tsx');
      replacements.push({ start: stmt.getStart(sf), end: stmt.getEnd(), text: `import { Spinner } from '${spec}';` });
      spinnerImporters++;
    }
  }
  replacements.sort((a, b) => b.start - a.start);
  for (const r of replacements) source = source.slice(0, r.start) + r.text + source.slice(r.end);
  if (replacements.length) write(file, source);
}

if (notifImporters === 0) throw new Error('no Notifications Toggle importers found');
if (smsImporters === 0) throw new Error('no SMS Toggle importers found');

const sparkConstants = 'src/components/SparkConfig/constants.tsx';
{
  let source = read(sparkConstants);
  const sf = ts.createSourceFile(sparkConstants, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nodes = sf.statements.filter((n) => ts.isFunctionDeclaration(n) && n.name?.text === 'Spinner');
  if (nodes.length !== 1) throw new Error(`expected one SparkConfig Spinner, found ${nodes.length}`);
  const node = nodes[0];
  source = source.slice(0, node.getFullStart()) + source.slice(node.getEnd());
  source += `\nexport { Spinner } from '../Spinner';\n`;
  write(sparkConstants, source);
}

for (const f of [targetNotif, targetSms, targetOrgSpinner]) fs.unlinkSync(f);

console.log(`notification_toggle_importers=${notifImporters}`);
console.log(`sms_toggle_importers=${smsImporters}`);
console.log(`org_spinner_importers=${spinnerImporters}`);
console.log('frontend primitive deduplication completed');
