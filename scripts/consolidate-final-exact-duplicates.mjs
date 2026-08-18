import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

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

function removeNamedImport(file, moduleName, name) {
  let source = read(file);
  const sf = parse(file, source);
  const imp = sf.statements.find((s) => ts.isImportDeclaration(s) && ts.isStringLiteral(s.moduleSpecifier) && s.moduleSpecifier.text === moduleName);
  if (!imp || !ts.isImportDeclaration(imp) || !imp.importClause?.namedBindings || !ts.isNamedImports(imp.importClause.namedBindings)) return;
  const kept = imp.importClause.namedBindings.elements.filter((e) => e.name.text !== name);
  if (kept.length === imp.importClause.namedBindings.elements.length) return;
  const parts = kept.map((e) => e.getText(sf));
  const next = `import { ${parts.join(', ')} } from '${moduleName}';`;
  source = source.slice(0, imp.getStart(sf)) + next + source.slice(imp.getEnd());
  write(file, source);
}

function findVariableArrow(file, name) {
  const source = read(file);
  const sf = parse(file, source);
  const matches = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name && node.initializer && ts.isArrowFunction(node.initializer)) matches.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return { source, sf, matches };
}

// Shared keyboard behavior for both MultiSelect implementations.
write('src/shared/ui/multiSelectKeyboard.ts', `import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';\n\nexport interface MultiSelectKeyboardItem {\n  id: string;\n  name: string;\n}\n\ninterface MultiSelectKeyboardContext<T extends MultiSelectKeyboardItem> {\n  open: boolean;\n  filtered: T[];\n  highlightedIndex: number;\n  onAdd: (item: MultiSelectKeyboardItem) => void;\n  setQuery: Dispatch<SetStateAction<string>>;\n  setOpen: Dispatch<SetStateAction<boolean>>;\n  setHighlightedIndex: Dispatch<SetStateAction<number>>;\n}\n\nexport function handleMultiSelectKeyDown<T extends MultiSelectKeyboardItem>(event: KeyboardEvent, context: MultiSelectKeyboardContext<T>) {\n  const { open, filtered, highlightedIndex, onAdd, setQuery, setOpen, setHighlightedIndex } = context;\n  if (event.key === 'Enter') {\n    event.preventDefault();\n    if (open && filtered.length > 0) {\n      const item = filtered[highlightedIndex] || filtered[0];\n      onAdd({ id: item.id, name: item.name });\n      setQuery('');\n      setHighlightedIndex(0);\n    }\n  } else if (event.key === 'ArrowDown') {\n    event.preventDefault();\n    setOpen(true);\n    setHighlightedIndex(index => Math.min(index + 1, filtered.length - 1));\n  } else if (event.key === 'ArrowUp') {\n    event.preventDefault();\n    setHighlightedIndex(index => Math.max(index - 1, 0));\n  } else if (event.key === 'Escape') {\n    setOpen(false);\n  }\n}\n`);
for (const [file, importPath] of [
  ['src/components/CalendarMeetingForm/MultiSelectField.tsx', '../../shared/ui/multiSelectKeyboard'],
  ['src/features/meetings/components/CreateMeetingForm/MultiSelectField.tsx', '../../../../shared/ui/multiSelectKeyboard'],
]) {
  const { source, sf, matches } = findVariableArrow(file, 'handleKeyDown');
  if (matches.length !== 1) throw new Error(`${file}: expected one handleKeyDown, found ${matches.length}`);
  const fn = matches[0];
  const replacement = `(e: React.KeyboardEvent) => handleMultiSelectKeyDown(e, { open, filtered, highlightedIndex, onAdd, setQuery, setOpen, setHighlightedIndex })`;
  write(file, source.slice(0, fn.getStart(sf)) + replacement + source.slice(fn.getEnd()));
  addImport(file, `import { handleMultiSelectKeyDown } from '${importPath}';`);
}

// Shared action-filter option rendering for Chat and Channels panels.
write('src/shared/ui/ActionFilterOptions.tsx', `import { Check } from 'lucide-react';\n\ninterface FilterOption<K extends string> { key: K; label: string }\n\nexport function MultiToggleFilterOption<K extends string>({ option, selected, onToggle }: { option: FilterOption<K>; selected: boolean; onToggle: (key: K) => void }) {\n  return (\n    <button type="button" onClick={() => onToggle(option.key)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg text-sm text-gray-700 dark:text-gray-200">\n      {option.label}\n      {selected && <Check className="w-4 h-4 text-teal-600" />}\n    </button>\n  );\n}\n\nexport function SingleSelectFilterOption<K extends string>({ option, selected, customKey, onSelect, onClose }: { option: FilterOption<K>; selected: boolean; customKey: K; onSelect: (key: K) => void; onClose: () => void }) {\n  return (\n    <button type="button" onClick={() => { onSelect(option.key); if (option.key !== customKey) onClose(); }} className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg text-sm text-gray-700 dark:text-gray-200">\n      {option.label}\n      {selected && <Check className="w-4 h-4 text-teal-600" />}\n    </button>\n  );\n}\n`);
for (const file of ['src/components/Chat/ChatActionsPanel.tsx', 'src/components/Channels/ChannelActionsPanel.tsx']) {
  let source = read(file);
  let sf = parse(file, source);
  const replacements = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' && ts.isIdentifier(node.expression.expression)) {
      const base = node.expression.expression.text;
      if (base === 'TYPE_OPTIONS') replacements.push({ node, text: `TYPE_OPTIONS.map(opt => <MultiToggleFilterOption key={opt.key} option={opt} selected={typeFilters.has(opt.key)} onToggle={toggleTypeFilter} />)` });
      if (base === 'DATE_OPTIONS') replacements.push({ node, text: `DATE_OPTIONS.map(opt => <SingleSelectFilterOption key={opt.key} option={opt} selected={dateFilter === opt.key} customKey="custom" onSelect={setDateFilter} onClose={() => setActiveDropdown(null)} />)` });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (replacements.length !== 2) throw new Error(`${file}: expected TYPE/DATE map callbacks, found ${replacements.length}`);
  replacements.sort((a,b)=>b.node.getStart(sf)-a.node.getStart(sf));
  for (const r of replacements) source = source.slice(0,r.node.getStart(sf)) + r.text + source.slice(r.node.getEnd());
  write(file, source);
  addImport(file, `import { MultiToggleFilterOption, SingleSelectFilterOption } from '../../shared/ui/ActionFilterOptions';`);
  removeNamedImport(file, 'lucide-react', 'Check');
}

// Shared input-bar history and message-type option rendering.
write('src/shared/chat/MessageInputPrimitives.tsx', `import type { ReactNode } from 'react';\n\ninterface MutableCurrent<T> { current: T }\nexport function pushEditorHistory(historyRef: MutableCurrent<string[]>, historyIndexRef: MutableCurrent<number>, value: string) {\n  const history = historyRef.current.slice(0, historyIndexRef.current + 1);\n  if (history[history.length - 1] !== value) {\n    history.push(value);\n    if (history.length > 50) history.shift();\n    historyRef.current = history;\n    historyIndexRef.current = history.length - 1;\n  }\n}\n\ninterface MessageTypeOption<K extends string> { key: K; label: string; icon: ReactNode; color: string; desc: string }\nexport function MessageTypeOptionButton<K extends string>({ option, selected, onSelect, onClose }: { option: MessageTypeOption<K>; selected: K; onSelect: (key: K) => void; onClose: () => void }) {\n  return (\n    <button type="button" key={option.key} onClick={() => { onSelect(option.key); onClose(); }} className={\`w-full flex items-start gap-2.5 px-3 py-2.5 text-right hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors \${selected === option.key ? 'bg-gray-50 dark:bg-gray-700/30' : ''}\`}>\n      <span className={\`mt-0.5 \${option.color}\`}>{option.icon}</span>\n      <span>\n        <span className="block text-sm text-gray-800 dark:text-gray-200">{option.label}</span>\n        {option.desc && <span className="block text-[10px] text-gray-400 mt-0.5">{option.desc}</span>}\n      </span>\n    </button>\n  );\n}\n`);
for (const file of ['src/components/Chat/ChatInputBar.tsx', 'src/components/Channels/ChannelInputBar.tsx']) {
  let source = read(file);
  let sf = parse(file, source);
  const arrows = [];
  const visitHistory = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'pushHistory' && node.initializer && ts.isArrowFunction(node.initializer)) arrows.push(node.initializer);
    ts.forEachChild(node, visitHistory);
  };
  visitHistory(sf);
  if (arrows.length !== 1) throw new Error(`${file}: pushHistory count=${arrows.length}`);
  source = source.slice(0,arrows[0].getStart(sf)) + `(val: string) => pushEditorHistory(historyRef, historyIndexRef, val)` + source.slice(arrows[0].getEnd());
  write(file, source);
  addImport(file, `import { MessageTypeOptionButton, pushEditorHistory } from '../../shared/chat/MessageInputPrimitives';`);
  source = read(file); sf = parse(file, source);
  const messageCallbacks = [];
  const visitTypes = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' && node.arguments[0] && ts.isArrowFunction(node.arguments[0])) {
      const text = node.arguments[0].getText(sf);
      if (text.includes('setMessageType(t.key)') && text.includes('setShowTypeMenu(false)')) messageCallbacks.push(node.arguments[0]);
    }
    ts.forEachChild(node, visitTypes);
  };
  visitTypes(sf);
  if (messageCallbacks.length !== 1) throw new Error(`${file}: message type callback count=${messageCallbacks.length}`);
  const cb = messageCallbacks[0];
  source = source.slice(0,cb.getStart(sf)) + `t => <MessageTypeOptionButton key={t.key} option={t} selected={messageType} onSelect={setMessageType} onClose={() => setShowTypeMenu(false)} />` + source.slice(cb.getEnd());
  write(file, source);
}

// Shared outside-click dismissal.
write('src/shared/ui/useDismissOnOutsideClick.ts', `import { useEffect } from 'react';\nimport type { Dispatch, RefObject, SetStateAction } from 'react';\n\nexport function useDismissOnOutsideClick<T, E extends HTMLElement>(active: boolean, ref: RefObject<E | null>, setOpen: Dispatch<SetStateAction<T | null>>) {\n  useEffect(() => {\n    if (!active) return;\n    const handleMouseDown = (event: MouseEvent) => {\n      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(null);\n    };\n    document.addEventListener('mousedown', handleMouseDown);\n    return () => document.removeEventListener('mousedown', handleMouseDown);\n  }, [active, ref, setOpen]);\n}\n`);
for (const file of ['src/components/UserGroupsPanel.tsx', 'src/components/UserManagementPanel.tsx']) {
  let source = read(file); const sf = parse(file, source); const effects = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'useEffect' && node.getText(sf).includes('menuRef.current') && node.getText(sf).includes("document.addEventListener('mousedown'")) effects.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (effects.length !== 1) throw new Error(`${file}: outside click effect count=${effects.length}`);
  const call = effects[0];
  source = source.slice(0,call.getStart(sf)) + `useDismissOnOutsideClick(menuOpen !== null, menuRef, setMenuOpen)` + source.slice(call.getEnd());
  write(file, source);
  addImport(file, `import { useDismissOnOutsideClick } from '../shared/ui/useDismissOnOutsideClick';`);
}

// Shared org-user selector option mapping.
write('src/lib/orgUserOptions.ts', `import type { OrgUnitGroup } from './useOrgUsers';\n\nexport function mapOrgGroupsToMultiSelectGroups(groups: OrgUnitGroup[]) {\n  return groups.map(group => ({\n    label: group.unit_name,\n    options: group.users.map(user => {\n      const subtitles: string[] = [];\n      if (user.position_title) subtitles.push(user.position_title);\n      const otherAssignments = user.assignments.filter(assignment => assignment.positionTitle && assignment.positionTitle !== user.position_title);\n      if (otherAssignments.length) subtitles.push(otherAssignments.map(assignment => assignment.positionTitle).join('، '));\n      return { id: user.user_id, name: user.full_name || '', sub: subtitles.join(' · ') };\n    }),\n  }));\n}\n`);
for (const [file, importPath] of [
  ['src/components/CalendarMeetingForm.tsx', '../lib/orgUserOptions'],
  ['src/features/meetings/components/CreateMeetingForm.tsx', '../../../lib/orgUserOptions'],
]) {
  let source = read(file); const sf = parse(file, source); let target = null;
  const visit = (node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'systemUserGroups') target = node; ts.forEachChild(node, visit); };
  visit(sf);
  if (!target?.initializer) throw new Error(`${file}: systemUserGroups missing`);
  source = source.slice(0,target.initializer.getStart(sf)) + `mapOrgGroupsToMultiSelectGroups(orgGroups)` + source.slice(target.initializer.getEnd());
  write(file, source); addImport(file, `import { mapOrgGroupsToMultiSelectGroups } from '${importPath}';`);
}

// Consolidate repeated delegate/user row callbacks inside their components by reusing the exact first JSX body.
for (const config of [
  { file: 'src/components/MeetingInboxButton.tsx', param: 'u', marker: 'handleDelegate(delegateForEntry, u.user_id)', helper: 'renderDelegateOption', type: '(typeof filteredDelegates)[number]', before: '  return (' },
  { file: 'src/features/meetings/components/MeetingCard/UserSelectorModal.tsx', param: 'u', marker: 'sending={sendingToUserId === u.user_id}', helper: 'renderUserRow', type: 'OrgUserProfile', before: '  return (' },
]) {
  let source = read(config.file); const sf = parse(config.file, source); const callbacks = [];
  const visit = (node) => {
    if (ts.isArrowFunction(node) && node.parameters.length === 1 && ts.isIdentifier(node.parameters[0].name) && node.parameters[0].name.text === config.param) {
      const text = node.getText(sf);
      if (text.includes(config.marker) && text.trim().startsWith(`${config.param} => (`)) callbacks.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (callbacks.length !== 2) throw new Error(`${config.file}: row callback count=${callbacks.length}`);
  const bodyText = callbacks[0].body.getText(sf);
  callbacks.sort((a,b)=>b.getStart(sf)-a.getStart(sf));
  for (const cb of callbacks) source = source.slice(0,cb.getStart(sf)) + config.helper + source.slice(cb.getEnd());
  const at = source.lastIndexOf(config.before);
  if (at < 0) throw new Error(`${config.file}: final return marker missing`);
  source = source.slice(0,at) + `  const ${config.helper} = (${config.param}: ${config.type}) => ${bodyText};\n\n` + source.slice(at);
  write(config.file, source);
}

// Consolidate placeholder insertion in SMS template editor.
{
  const file = 'src/components/SmsConfig/TemplatesTab.tsx';
  let source = read(file); const sf = parse(file, source); const callbacks = [];
  const visit = (node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'insertPlaceholder' && node.initializer && ts.isArrowFunction(node.initializer)) callbacks.push(node.initializer); ts.forEachChild(node, visit); };
  visit(sf);
  if (callbacks.length !== 2) throw new Error(`TemplatesTab insertPlaceholder count=${callbacks.length}`);
  callbacks.sort((a,b)=>b.getStart(sf)-a.getStart(sf));
  for (const cb of callbacks) source = source.slice(0,cb.getStart(sf)) + `(ph: string) => insertTemplatePlaceholder(ph, textareaRef.current, form.body, body => setForm(f => ({ ...f, body })))` + source.slice(cb.getEnd());
  const sf2 = parse(file, source); const imports = sf2.statements.filter(ts.isImportDeclaration); const at = imports.length ? imports[imports.length-1].getEnd() : 0;
  const helper = `\n\nfunction insertTemplatePlaceholder(ph: string, textarea: HTMLTextAreaElement | null, body: string, applyBody: (body: string) => void) {\n  const pos = textarea?.selectionStart ?? body.length;\n  const newBody = body.slice(0, pos) + ph + body.slice(pos);\n  applyBody(newBody);\n  requestAnimationFrame(() => {\n    if (textarea) { textarea.focus(); textarea.selectionStart = textarea.selectionEnd = pos + ph.length; }\n  });\n}`;
  source = source.slice(0,at) + helper + source.slice(at);
  write(file, source);
}

// Reuse half-hour option elements in UserSettingsModal.
{
  const file = 'src/app/layout/components/UserSettingsModal.tsx';
  let source = read(file); const sf = parse(file, source); const matches = [];
  const visit = (node) => { const text = node.getText(sf); if (ts.isCallExpression(node) && text.includes('Array.from(') && text.includes('length: 48') && text.includes('<option')) matches.push(node); ts.forEachChild(node, visit); };
  visit(sf);
  const unique = matches.filter((m) => !matches.some((other) => other !== m && other.pos <= m.pos && other.end >= m.end));
  if (unique.length !== 2) throw new Error(`UserSettings half-hour call count=${unique.length}`);
  const expression = unique[0].getText(sf);
  unique.sort((a,b)=>b.getStart(sf)-a.getStart(sf));
  for (const node of unique) source = source.slice(0,node.getStart(sf)) + 'HALF_HOUR_OPTION_ELEMENTS' + source.slice(node.getEnd());
  const sf2 = parse(file, source); const imports = sf2.statements.filter(ts.isImportDeclaration); const at = imports.length ? imports[imports.length-1].getEnd() : 0;
  source = source.slice(0,at) + `\n\nconst HALF_HOUR_OPTION_ELEMENTS = ${expression};` + source.slice(at);
  write(file, source);
}

// Simplify identical branches in OrgPermissionsPanel.
{
  const file='src/components/OrgStructure/OrgPermissionsPanel.tsx'; let source=read(file); let sf=parse(file,source); let target=null;
  const visit=(node)=>{ if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.name.text==='handleToggleAllInGroup') target=node; ts.forEachChild(node,visit);}; visit(sf);
  if(!target?.initializer) throw new Error('OrgPermissions handler missing');
  const replacement=`(groupKeys: string[], enable: boolean) => {\n    setPerms(prev => { const updated = { ...prev }; groupKeys.forEach(k => { updated[k] = enable; }); return updated; });\n    if (mode === 'position') {\n      setOverrides(prev => {\n        const updated = { ...prev };\n        groupKeys.forEach(k => { const baseValue = levelPerms[k] ?? false; if (enable === baseValue) delete updated[k]; else updated[k] = enable; });\n        return updated;\n      });\n    }\n  }`;
  source=source.slice(0,target.initializer.getStart(sf))+replacement+source.slice(target.initializer.getEnd()); write(file,source);
  source=read(file); sf=parse(file,source); const calls=[]; const vc=(node)=>{if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='handleToggleAllInGroup') calls.push(node); ts.forEachChild(node,vc);}; vc(sf);
  calls.sort((a,b)=>b.getStart(sf)-a.getStart(sf));
  for(const call of calls){ if(call.arguments.length!==3) throw new Error('OrgPermissions call arity'); source=source.slice(0,call.getStart(sf))+`handleToggleAllInGroup(${call.arguments[1].getText(sf)}, ${call.arguments[2].getText(sf)})`+source.slice(call.getEnd()); }
  write(file,source);
}

// Common set-diff implementation in meetingEditDiff.
{
  const file='src/lib/meetingEditDiff.ts'; let source=read(file);
  source=source.replace(`export interface ParticipantDiff {\n  added: string[];\n  retained: string[];\n  removed: string[];\n}\n\nexport interface ObserverDiff {\n  added: string[];\n  retained: string[];\n  removed: string[];\n}\n\nexport interface ExternalDiff {\n  added: string[];\n  retained: string[];\n  removed: string[];\n}\n`,`export interface RecipientDiff {\n  added: string[];\n  retained: string[];\n  removed: string[];\n}\n\nexport type ParticipantDiff = RecipientDiff;\nexport type ObserverDiff = RecipientDiff;\nexport type ExternalDiff = RecipientDiff;\n`);
  const sf=parse(file,source); const fns=sf.statements.filter((s)=>ts.isFunctionDeclaration(s)&&['computeParticipantDiff','computeObserverDiff'].includes(s.name?.text||''));
  if(fns.length!==2) throw new Error('meetingEditDiff functions missing');
  const body=fns[0].body?.getText(sf); if(!body||fns[1].body?.getText(sf).replace(/\s+/g,'')!==body.replace(/\s+/g,'')) throw new Error('meetingEditDiff bodies differ');
  const helper=`function computeRecipientDiff(prevIds: string[], nextIds: string[]): RecipientDiff ${body}\n\n`;
  fns.sort((a,b)=>b.getStart(sf)-a.getStart(sf));
  for(const fn of fns){ const name=fn.name.text; const ret=name==='computeParticipantDiff'?'ParticipantDiff':'ObserverDiff'; source=source.slice(0,fn.getStart(sf))+`export function ${name}(prevIds: string[], nextIds: string[]): ${ret} {\n  return computeRecipientDiff(prevIds, nextIds);\n}`+source.slice(fn.getEnd()); }
  const firstFn=source.indexOf('export function computeParticipantDiff'); source=source.slice(0,firstFn)+helper+source.slice(firstFn); write(file,source);
}

// Use shared timingSafeCompare in daily report support.
{
  const file='supabase/functions/send-daily-meetings/dailyReportSupport.ts'; let source=read(file); const sf=parse(file,source); const fn=sf.statements.find((s)=>ts.isFunctionDeclaration(s)&&s.name?.text==='timingSafeCompare');
  if(!fn) throw new Error('daily timingSafeCompare missing'); source=source.slice(0,fn.getFullStart())+source.slice(fn.getEnd()); write(file,source); addImport(file, `import { timingSafeCompare } from '../_shared/crypto.ts';`);
}

// Consolidate the two VideoArea promotion callbacks using their exact existing body.
{
  const file='src/components/VideoConference/Room/VideoArea.tsx'; let source=read(file); const sf=parse(file,source); const targets=[];
  const visit=(node)=>{ if(ts.isJsxAttribute(node)&&ts.isIdentifier(node.name)&&['onPromoteThumbnail','onPromoteSidebar'].includes(node.name.text)){const expr=node.initializer&&ts.isJsxExpression(node.initializer)?node.initializer.expression:null;if(expr&&ts.isArrowFunction(expr))targets.push(expr);} ts.forEachChild(node,visit);}; visit(sf);
  if(targets.length!==2) throw new Error(`VideoArea callbacks=${targets.length}`); const b0=targets[0].body.getText(sf).replace(/\s+/g,''); const b1=targets[1].body.getText(sf).replace(/\s+/g,''); if(b0!==b1) throw new Error('VideoArea bodies differ'); const body=targets[0].body.getText(sf);
  targets.sort((a,b)=>b.getStart(sf)-a.getStart(sf)); for(const fn of targets) source=source.slice(0,fn.getStart(sf))+'promoteTile'+source.slice(fn.getEnd()); const marker='  // ── Gallery'; const at=source.indexOf(marker); if(at<0) throw new Error('VideoArea marker missing'); source=source.slice(0,at)+`  const promoteTile = (peerId: string) => ${body};\n\n`+source.slice(at); write(file,source);
}

console.log('final exact duplicate consolidation completed');
