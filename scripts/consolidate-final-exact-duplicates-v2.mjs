import fs from 'node:fs';
import ts from 'typescript';

await import('./consolidate-final-exact-duplicates.mjs');

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.endsWith('\n') ? s : `${s}\n`);
const parse = (file, source = read(file)) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function addImport(file, line) {
  let source = read(file);
  if (source.includes(line)) return;
  const sf = parse(file, source);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
  source = source.slice(0, at) + `\n${line}` + source.slice(at);
  write(file, source);
}

const shared = 'src/shared/chat/MessageInputPrimitives.tsx';
let sharedSource = read(shared);
const sharedMarker = 'interface MessageTypeOption<K extends string>';
if (!sharedSource.includes(sharedMarker)) throw new Error('MessageInputPrimitives marker missing');
if (!sharedSource.includes('export function updateMessageBody')) {
  sharedSource = sharedSource.replace(sharedMarker, `export function updateMessageBody(value: string, setBody: (value: string) => void, pushHistory: (value: string) => void, setShowMentionMenu: (value: boolean) => void, setMentionSearch: (value: string) => void) {\n  setBody(value);\n  pushHistory(value);\n  const lastAt = value.lastIndexOf('@');\n  if (lastAt >= 0 && (lastAt === value.length - 1 || value.slice(lastAt + 1).match(/^\\w*$/))) {\n    setShowMentionMenu(true);\n    setMentionSearch(value.slice(lastAt + 1));\n  } else {\n    setShowMentionMenu(false);\n  }\n}\n\ninterface MessageTypeOption<K extends string>`);
  write(shared, sharedSource);
}

for (const inputFile of ['src/components/Chat/ChatInputBar.tsx', 'src/components/Channels/ChannelInputBar.tsx']) {
  let source = read(inputFile);
  const sf = parse(inputFile, source);
  const matches = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleBodyChange' && node.initializer && ts.isArrowFunction(node.initializer)) matches.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (matches.length !== 1) throw new Error(`${inputFile}: handleBodyChange count=${matches.length}`);
  const fn = matches[0];
  source = source.slice(0, fn.getStart(sf)) + `(val: string) => updateMessageBody(val, setBody, pushHistory, setShowMentionMenu, setMentionSearch)` + source.slice(fn.getEnd());
  write(inputFile, source);
  addImport(inputFile, `import { updateMessageBody } from '../../shared/chat/MessageInputPrimitives';`);
}

console.log('final exact duplicate consolidation v2 completed');
