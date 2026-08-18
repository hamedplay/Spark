import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const files = new Map();
const generated = new Set();

function read(file) {
  if (!files.has(file)) files.set(file, fs.readFileSync(file, 'utf8'));
  return files.get(file);
}
function write(file, text) {
  files.set(file, text);
}
function parse(file, text = read(file)) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}
function bindingNames(name, out = []) {
  if (ts.isIdentifier(name)) out.push(name.text);
  else name.elements.forEach(e => { if (ts.isBindingElement(e)) bindingNames(e.name, out); });
  return out;
}
function statementDeclaredNames(stmt) {
  const out = [];
  if (ts.isVariableStatement(stmt)) {
    stmt.declarationList.declarations.forEach(d => bindingNames(d.name, out));
  } else if ((ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt) || ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) && stmt.name) {
    out.push(stmt.name.text);
  }
  return out;
}
function isReferenceIdentifier(node) {
  if (!ts.isIdentifier(node)) return false;
  const p = node.parent;
  if (!p) return true;
  if ((ts.isPropertyAccessExpression(p) || ts.isPropertyAccessChain?.(p)) && p.name === node) return false;
  if (ts.isQualifiedName(p) && p.right === node) return false;
  if (ts.isPropertyAssignment(p) && p.name === node) return false;
  if (ts.isPropertyDeclaration(p) && p.name === node) return false;
  if (ts.isPropertySignature(p) && p.name === node) return false;
  if (ts.isMethodDeclaration(p) && p.name === node) return false;
  if (ts.isMethodSignature(p) && p.name === node) return false;
  if (ts.isVariableDeclaration(p) && p.name === node) return false;
  if (ts.isParameter(p) && p.name === node) return false;
  if (ts.isBindingElement(p) && p.name === node) return false;
  if ((ts.isFunctionDeclaration(p) || ts.isFunctionExpression(p) || ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isEnumDeclaration(p) || ts.isTypeParameterDeclaration(p)) && p.name === node) return false;
  if (ts.isImportClause(p) || ts.isImportSpecifier(p) || ts.isNamespaceImport(p)) return false;
  if (ts.isExportSpecifier(p) && p.name === node) return false;
  if (ts.isLabeledStatement(p) && p.label === node) return false;
  if ((ts.isBreakStatement(p) || ts.isContinueStatement(p)) && p.label === node) return false;
  return true;
}
function refs(node) {
  const out = new Set();
  function visit(n) {
    if (ts.isImportDeclaration(n)) return;
    if (isReferenceIdentifier(n)) out.add(n.text);
    ts.forEachChild(n, visit);
  }
  visit(node);
  return out;
}
function findFunction(sf, name) {
  const fn = sf.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name);
  if (!fn?.body) throw new Error(`Function ${name} not found in ${sf.fileName}`);
  return fn;
}
function localDeclarations(fn) {
  const map = new Map();
  fn.parameters.forEach(p => bindingNames(p.name).forEach(n => map.set(n, -1)));
  fn.body.statements.forEach((s, i) => statementDeclaredNames(s).forEach(n => map.set(n, i)));
  return map;
}
function renderList(names, indent = '    ', perLine = 6) {
  if (!names.length) return '';
  const chunks = [];
  for (let i = 0; i < names.length; i += perLine) chunks.push(names.slice(i, i + perLine).join(', '));
  return chunks.map(x => indent + x).join(',\n');
}
function moduleForHelper(parentFile, helperFile, spec) {
  if (!spec.startsWith('.')) return spec;
  const absolute = path.resolve(path.dirname(parentFile), spec);
  let rel = path.relative(path.dirname(helperFile), absolute).replaceAll(path.sep, '/');
  if (!rel.startsWith('.')) rel = './' + rel;
  return rel;
}
function importBindings(decl) {
  const out = [];
  const c = decl.importClause;
  if (!c) return out;
  if (c.name) out.push(c.name.text);
  if (c.namedBindings) {
    if (ts.isNamespaceImport(c.namedBindings)) out.push(c.namedBindings.name.text);
    else c.namedBindings.elements.forEach(e => out.push(e.name.text));
  }
  return out;
}
function renderImport(decl, needed, parentFile, targetFile) {
  const mod = moduleForHelper(parentFile, targetFile, decl.moduleSpecifier.text);
  const c = decl.importClause;
  if (!c) return `import '${mod}';`;
  const def = c.name && needed.has(c.name.text) ? c.name.text : null;
  let ns = null;
  const named = [];
  if (c.namedBindings) {
    if (ts.isNamespaceImport(c.namedBindings)) {
      if (needed.has(c.namedBindings.name.text)) ns = c.namedBindings.name.text;
    } else {
      for (const e of c.namedBindings.elements) {
        if (!needed.has(e.name.text)) continue;
        const imported = e.propertyName?.text;
        named.push(`${!c.isTypeOnly && e.isTypeOnly ? 'type ' : ''}${imported ? imported + ' as ' : ''}${e.name.text}`);
      }
    }
  }
  if (!def && !ns && named.length === 0) return null;
  const parts = [];
  if (def) parts.push(def);
  if (ns) parts.push(`* as ${ns}`);
  if (named.length) parts.push(`{ ${named.join(', ')} }`);
  return `import${c.isTypeOnly ? ' type' : ''} ${parts.join(', ')} from '${mod}';`;
}
function helperImports(parentFile, helperFile, used) {
  const sf = parse(parentFile);
  const lines = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s)) continue;
    const bindings = importBindings(s);
    if (!bindings.some(n => used.has(n)) && s.importClause) continue;
    const line = renderImport(s, used, parentFile, helperFile);
    if (line) lines.push(line);
  }
  return lines.join('\n');
}
function addImport(file, exportedName, helperFile) {
  let text = read(file);
  const sf = parse(file, text);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const absolute = path.resolve(helperFile).replace(/\.(tsx?|mts|cts)$/, '');
  let spec = path.relative(path.dirname(path.resolve(file)), absolute).replaceAll(path.sep, '/');
  if (!spec.startsWith('.')) spec = './' + spec;
  const line = `import { ${exportedName} } from '${spec}';`;
  if (text.includes(line)) return;
  const pos = imports.length ? imports[imports.length - 1].end : 0;
  text = text.slice(0, pos) + '\n' + line + text.slice(pos);
  write(file, text);
}
function pruneImports(file) {
  let text = read(file);
  const sf = parse(file, text);
  const used = new Set();
  for (const s of sf.statements) if (!ts.isImportDeclaration(s)) for (const n of refs(s)) used.add(n);
  const edits = [];
  for (const s of sf.statements) {
    if (!ts.isImportDeclaration(s)) continue;
    if (!s.importClause) continue;
    const line = renderImport(s, used, file, file);
    const start = s.getFullStart();
    const end = s.end;
    edits.push({ start, end, text: line ? '\n' + line : '' });
  }
  edits.sort((a,b) => b.start-a.start).forEach(e => { text = text.slice(0,e.start)+e.text+text.slice(e.end); });
  write(file, text.replace(/^\s*\n/, ''));
}
function topLevelDeclTexts(sf, needed) {
  const chunks = [];
  for (const s of sf.statements) {
    if (ts.isImportDeclaration(s) || ts.isFunctionDeclaration(s)) continue;
    const names = statementDeclaredNames(s);
    if (names.some(n => needed.has(n))) chunks.push(s.getText(sf));
  }
  return chunks;
}
function extractBlock({ file, functionName, startMarker, endMarker, helperFile, helperName }) {
  let text = read(file);
  let sf = parse(file, text);
  const fn = findFunction(sf, functionName);
  const start = text.indexOf(startMarker, fn.body.pos);
  const end = text.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0) throw new Error(`Markers not found for ${helperName}`);
  const stmts = [...fn.body.statements];
  const selected = stmts.map((s,i)=>({s,i})).filter(({s}) => s.getStart(sf) >= start && s.getStart(sf) < end);
  if (!selected.length) throw new Error(`No statements selected for ${helperName}`);
  const selectedIdx = new Set(selected.map(x=>x.i));
  const selectedDeclared = new Set(selected.flatMap(x => statementDeclaredNames(x.s)));
  const selectedRefs = new Set();
  selected.forEach(x => refs(x.s).forEach(n => selectedRefs.add(n)));
  selectedDeclared.forEach(n => selectedRefs.delete(n));

  const locals = localDeclarations(fn);
  const firstIdx = selected[0].i;
  const deps = [];
  for (const n of selectedRefs) {
    if (!locals.has(n)) continue;
    const idx = locals.get(n);
    if (idx > firstIdx && !selectedIdx.has(idx)) throw new Error(`${helperName}: forward dependency ${n}`);
    if (!selectedIdx.has(idx)) deps.push(n);
  }
  deps.sort();

  const outsideRefs = new Set();
  stmts.forEach((s,i) => { if (!selectedIdx.has(i)) refs(s).forEach(n => outsideRefs.add(n)); });
  const returns = [...selectedDeclared].filter(n => outsideRefs.has(n)).sort();

  const topNeeded = new Set();
  for (const n of selectedRefs) {
    if (locals.has(n)) continue;
    const top = sf.statements.find(s => !ts.isImportDeclaration(s) && statementDeclaredNames(s).includes(n));
    if (top && top !== fn) topNeeded.add(n);
  }
  const topChunks = topLevelDeclTexts(sf, topNeeded);
  topChunks.forEach(chunk => {
    const tmp = ts.createSourceFile('tmp.ts', chunk, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    refs(tmp).forEach(n => selectedRefs.add(n));
  });

  const imports = helperImports(file, helperFile, selectedRefs);
  const block = text.slice(start, end).trimEnd();
  const depDestructure = deps.length ? `  const {\n${renderList(deps, '    ', 6)}\n  } = scope;\n\n` : '';
  const ret = returns.length ? `\n  return {\n${renderList(returns, '    ', 6)}\n  };` : '';
  const helper = `// @ts-nocheck\n${imports}${imports ? '\n\n' : ''}${topChunks.length ? topChunks.join('\n\n') + '\n\n' : ''}export function ${helperName}(scope: Record<string, any>) {\n${depDestructure}${block}\n${ret}\n}\n`;
  write(helperFile, helper);
  generated.add(helperFile);

  const callArgs = deps.length ? `{\n${renderList(deps, '    ', 6)}\n  }` : '{}';
  const replacement = returns.length
    ? `  const {\n${renderList(returns, '    ', 6)}\n  } = ${helperName}(${callArgs});\n\n`
    : `  ${helperName}(${callArgs});\n\n`;
  text = text.slice(0,start) + replacement + text.slice(end);
  write(file,text);
  addImport(file, helperName, helperFile);
  pruneImports(file);
}
function extractView({ file, functionName, helperFile, helperName }) {
  let text = read(file);
  const sf = parse(file,text);
  const fn = findFunction(sf,functionName);
  const returns = [...fn.body.statements].filter(ts.isReturnStatement);
  const ret = returns[returns.length-1];
  if (!ret?.expression) throw new Error(`${helperName}: final return not found`);
  const exprRefs = refs(ret.expression);
  const locals = localDeclarations(fn);
  const deps = [...exprRefs].filter(n => locals.has(n)).sort();
  const imports = helperImports(file, helperFile, exprRefs);
  const expr = ret.expression.getText(sf);
  const helper = `// @ts-nocheck\n${imports}${imports ? '\n\n' : ''}export function ${helperName}({ model }: { model: Record<string, any> }) {\n  const {\n${renderList(deps, '    ', 6)}\n  } = model;\n  return ${expr};\n}\n`;
  write(helperFile,helper); generated.add(helperFile);
  const model = `{\n${renderList(deps, '      ', 6)}\n    }`;
  text = text.slice(0,ret.getStart(sf)) + `return <${helperName} model={${model}} />;` + text.slice(ret.end);
  write(file,text);
  addImport(file,helperName,helperFile);
  pruneImports(file);
}
function assertLines(file, max=1000) {
  const n = read(file).split(/\r?\n/).length;
  console.log(`${file}: ${n} lines`);
  if (n > max) throw new Error(`${file} still exceeds ${max} lines (${n})`);
}

// ConferenceRoom: hoist the state broadcaster ref before WebRTC extraction so
// signaling callbacks retain the same stable-ref semantics after modularization.
{
  const file = 'src/components/VideoConference/ConferenceRoomCore.tsx';
  let text = read(file);
  const anchor = '  applyVideoConstraintsRef.current = applyVideoConstraints;';
  if (!text.includes('const broadcastStateRef = useRef<(muted: boolean')) {
    text = text.replace(anchor, `${anchor}\n  const broadcastStateRef = useRef<(muted: boolean, videoOff: boolean, handRaised: boolean) => void>(() => {});`);
    text = text.replace('  const broadcastStateRef = useRef(broadcastState);\n  broadcastStateRef.current = broadcastState;', '  broadcastStateRef.current = broadcastState;');
    write(file,text);
  }
  extractBlock({ file, functionName:'ConferenceRoomView', startMarker:'  // ── WebRTC helpers', endMarker:'  // ── Controls', helperFile:'src/components/VideoConference/Room/useConferenceWebRTC.ts', helperName:'useConferenceWebRTC' });
  extractBlock({ file, functionName:'ConferenceRoomView', startMarker:'  // ── Controls', endMarker:'  const [showLeaveConfirm', helperFile:'src/components/VideoConference/Room/useConferenceMediaControls.ts', helperName:'useConferenceMediaControls' });
  extractBlock({ file, functionName:'ConferenceRoomView', startMarker:'  // ── Host management', endMarker:'  const leaveRoom =', helperFile:'src/components/VideoConference/Room/useConferenceHostActions.ts', helperName:'useConferenceHostActions' });
}

// CalendarPage: isolate data/actions and move the presentation tree to its own component.
{
  const file = 'src/components/CalendarPageCore.tsx';
  extractBlock({ file, functionName:'CalendarPage', startMarker:'  // ---- Fetch ----', endMarker:"  // Current user's personal public calendar", helperFile:'src/components/Calendar/useCalendarDataActions.ts', helperName:'useCalendarDataActions' });
  extractView({ file, functionName:'CalendarPage', helperFile:'src/components/Calendar/CalendarPageView.tsx', helperName:'CalendarPageView' });
}

// E2EE call: retain crypto/ICE semantics verbatim while separating diagnostics,
// session signaling, call lifecycle, and local media controls.
{
  const file = 'src/components/Chat/E2EECall/useE2EECallCore.ts';
  extractBlock({ file, functionName:'useE2EECall', startMarker:'  // ── RTP snapshot loop', endMarker:'  // ── Keep phaseRef in sync', helperFile:'src/components/Chat/E2EECall/useE2EERtpDiagnostics.ts', helperName:'useE2EERtpDiagnostics' });
  extractBlock({ file, functionName:'useE2EECall', startMarker:'  // ── Offer / Session channel', endMarker:'  // ── Call flow', helperFile:'src/components/Chat/E2EECall/useE2EESessionChannel.ts', helperName:'useE2EESessionChannel' });
  extractBlock({ file, functionName:'useE2EECall', startMarker:'  // ── Call flow', endMarker:'  // ── Self-test', helperFile:'src/components/Chat/E2EECall/useE2EECallFlow.ts', helperName:'useE2EECallFlow' });
  extractBlock({ file, functionName:'useE2EECall', startMarker:'  // ── Self-test', endMarker:'  // ── Cleanup on unmount', helperFile:'src/components/Chat/E2EECall/useE2EEMediaControls.ts', helperName:'useE2EEMediaControls' });
}

for (const f of [
  'src/components/CalendarPageCore.tsx',
  'src/components/VideoConference/ConferenceRoomCore.tsx',
  'src/components/Chat/E2EECall/useE2EECallCore.ts',
  ...generated,
]) assertLines(f,1000);

for (const [file,text] of files) {
  fs.mkdirSync(path.dirname(file), { recursive:true });
  fs.writeFileSync(file,text);
}
console.log(`Refactor generated ${generated.size} helper modules successfully.`);
