import fs from 'node:fs';
import ts from 'typescript';

const read = (p) => fs.readFileSync(p, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s.endsWith('\n') ? s : `${s}\n`);
const parse = (file, source) => ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

function addImport(file, line) {
  let source = read(file);
  if (source.includes(line)) return;
  const sf = parse(file, source);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const at = imports.length ? imports[imports.length - 1].getEnd() : 0;
  source = source.slice(0, at) + `\n${line}` + source.slice(at);
  write(file, source);
}

// ── Shared MultiSelect keyboard behavior ─────────────────────────────────────
write('src/shared/ui/multiSelectKeyboard.ts', `import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';

export interface MultiSelectKeyboardItem {
  id: string;
  name: string;
}

interface MultiSelectKeyboardContext<T extends MultiSelectKeyboardItem> {
  open: boolean;
  filtered: T[];
  highlightedIndex: number;
  onAdd: (item: MultiSelectKeyboardItem) => void;
  setQuery: Dispatch<SetStateAction<string>>;
  setOpen: Dispatch<SetStateAction<boolean>>;
  setHighlightedIndex: Dispatch<SetStateAction<number>>;
}

export function handleMultiSelectKeyDown<T extends MultiSelectKeyboardItem>(
  event: KeyboardEvent,
  context: MultiSelectKeyboardContext<T>,
) {
  const { open, filtered, highlightedIndex, onAdd, setQuery, setOpen, setHighlightedIndex } = context;
  if (event.key === 'Enter') {
    event.preventDefault();
    if (open && filtered.length > 0) {
      const item = filtered[highlightedIndex] || filtered[0];
      onAdd({ id: item.id, name: item.name });
      setQuery('');
      setHighlightedIndex(0);
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault();
    setOpen(true);
    setHighlightedIndex(index => Math.min(index + 1, filtered.length - 1));
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    setHighlightedIndex(index => Math.max(index - 1, 0));
  } else if (event.key === 'Escape') {
    setOpen(false);
  }
}
`);

for (const [file, importPath] of [
  ['src/components/CalendarMeetingForm/MultiSelectField.tsx', '../../shared/ui/multiSelectKeyboard'],
  ['src/features/meetings/components/CreateMeetingForm/MultiSelectField.tsx', '../../../../shared/ui/multiSelectKeyboard'],
]) {
  let source = read(file);
  const sf = parse(file, source);
  const functions = [];
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleKeyDown' && node.initializer && ts.isArrowFunction(node.initializer)) functions.push(node.initializer);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (functions.length !== 1) throw new Error(`${file}: expected one handleKeyDown`);
  const fn = functions[0];
  const replacement = `(e: React.KeyboardEvent) => handleMultiSelectKeyDown(e, { open, filtered, highlightedIndex, onAdd, setQuery, setOpen, setHighlightedIndex })`;
  source = source.slice(0, fn.getStart(sf)) + replacement + source.slice(fn.getEnd());
  write(file, source);
  addImport(file, `import { handleMultiSelectKeyDown } from '${importPath}';`);
}

// ── Shared org-user -> selector option mapping ────────────────────────────────
write('src/lib/orgUserOptions.ts', `interface OrgAssignmentLike {
  positionTitle?: string | null;
}
interface OrgUserLike {
  user_id: string;
  full_name?: string | null;
  position_title?: string | null;
  assignments: OrgAssignmentLike[];
}
interface OrgGroupLike {
  unit_name: string;
  users: OrgUserLike[];
}

export function mapOrgGroupsToMultiSelectGroups(groups: OrgGroupLike[]) {
  return groups.map(group => ({
    label: group.unit_name,
    options: group.users.map(user => {
      const subtitles: string[] = [];
      if (user.position_title) subtitles.push(user.position_title);
      const otherAssignments = user.assignments.filter(
        assignment => assignment.positionTitle && assignment.positionTitle !== user.position_title,
      );
      if (otherAssignments.length) {
        subtitles.push(otherAssignments.map(assignment => assignment.positionTitle).join('، '));
      }
      return { id: user.user_id, name: user.full_name || '', sub: subtitles.join(' · ') };
    }),
  }));
}
`);

for (const [file, importPath] of [
  ['src/components/CalendarMeetingForm.tsx', '../lib/orgUserOptions'],
  ['src/features/meetings/components/CreateMeetingForm.tsx', '../../../lib/orgUserOptions'],
]) {
  let source = read(file);
  const sf = parse(file, source);
  let target = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'systemUserGroups') target = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!target || !target.initializer) throw new Error(`${file}: systemUserGroups initializer not found`);
  source = source.slice(0, target.initializer.getStart(sf)) + 'mapOrgGroupsToMultiSelectGroups(orgGroups)' + source.slice(target.initializer.getEnd());
  write(file, source);
  addImport(file, `import { mapOrgGroupsToMultiSelectGroups } from '${importPath}';`);
}

// ── Shared outside-click menu dismissal ──────────────────────────────────────
write('src/shared/ui/useDismissOnOutsideClick.ts', `import { useEffect } from 'react';
import type { Dispatch, RefObject, SetStateAction } from 'react';

export function useDismissOnOutsideClick<T, E extends HTMLElement>(
  active: boolean,
  ref: RefObject<E | null>,
  setOpen: Dispatch<SetStateAction<T | null>>,
) {
  useEffect(() => {
    if (!active) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [active, ref, setOpen]);
}
`);

const outsideEffectText = `  useEffect(() => {\n    if (!menuOpen) return;\n    const h = (e: MouseEvent) => {\n      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null);\n    };\n    document.addEventListener('mousedown', h);\n    return () => document.removeEventListener('mousedown', h);\n  }, [menuOpen]);\n`;
for (const file of ['src/components/UserGroupsPanel.tsx', 'src/components/UserManagementPanel.tsx']) {
  let source = read(file);
  if (!source.includes(outsideEffectText)) throw new Error(`${file}: exact outside-click effect not found`);
  source = source.replace(outsideEffectText, `  useDismissOnOutsideClick(menuOpen !== null, menuRef, setMenuOpen);\n`);
  write(file, source);
  addImport(file, `import { useDismissOnOutsideClick } from '../shared/ui/useDismissOnOutsideClick';`);
}

// ── Meeting edit set-diff core ───────────────────────────────────────────────
{
  const file = 'src/lib/meetingEditDiff.ts';
  let source = read(file);
  const oldInterfaces = `export interface ParticipantDiff {\n  added: string[];\n  retained: string[];\n  removed: string[];\n}\n\nexport interface ObserverDiff {\n  added: string[];\n  retained: string[];\n  removed: string[];\n}\n\nexport interface ExternalDiff {\n  added: string[];\n  retained: string[];\n  removed: string[];\n}\n`;
  const newInterfaces = `export interface RecipientDiff {\n  added: string[];\n  retained: string[];\n  removed: string[];\n}\n\nexport type ParticipantDiff = RecipientDiff;\nexport type ObserverDiff = RecipientDiff;\nexport type ExternalDiff = RecipientDiff;\n`;
  if (!source.includes(oldInterfaces)) throw new Error('meetingEditDiff duplicate interfaces not found');
  source = source.replace(oldInterfaces, newInterfaces);
  const oldFunctions = `export function computeParticipantDiff(prevIds: string[], nextIds: string[]): ParticipantDiff {\n  const prev = new Set(prevIds.filter(x => !!x));\n  const next = new Set(nextIds.filter(x => !!x));\n  return {\n    added: [...next].filter(id => !prev.has(id)),\n    retained: [...next].filter(id => prev.has(id)),\n    removed: [...prev].filter(id => !next.has(id)),\n  };\n}\n\nexport function computeObserverDiff(prevIds: string[], nextIds: string[]): ObserverDiff {\n  const prev = new Set(prevIds.filter(x => !!x));\n  const next = new Set(nextIds.filter(x => !!x));\n  return {\n    added: [...next].filter(id => !prev.has(id)),\n    retained: [...next].filter(id => prev.has(id)),\n    removed: [...prev].filter(id => !next.has(id)),\n  };\n}\n`;
  const newFunctions = `function computeRecipientDiff(prevIds: string[], nextIds: string[]): RecipientDiff {\n  const prev = new Set(prevIds.filter(x => !!x));\n  const next = new Set(nextIds.filter(x => !!x));\n  return {\n    added: [...next].filter(id => !prev.has(id)),\n    retained: [...next].filter(id => prev.has(id)),\n    removed: [...prev].filter(id => !next.has(id)),\n  };\n}\n\nexport function computeParticipantDiff(prevIds: string[], nextIds: string[]): ParticipantDiff {\n  return computeRecipientDiff(prevIds, nextIds);\n}\n\nexport function computeObserverDiff(prevIds: string[], nextIds: string[]): ObserverDiff {\n  return computeRecipientDiff(prevIds, nextIds);\n}\n`;
  if (!source.includes(oldFunctions)) throw new Error('meetingEditDiff duplicate functions not found');
  write(file, source.replace(oldFunctions, newFunctions));
}

// ── Daily report timing-safe comparison uses shared crypto helper ────────────
{
  const file = 'supabase/functions/send-daily-meetings/dailyReportSupport.ts';
  let source = read(file);
  const sf = parse(file, source);
  const fn = sf.statements.find((s) => ts.isFunctionDeclaration(s) && s.name?.text === 'timingSafeCompare');
  if (!fn) throw new Error('daily timingSafeCompare not found');
  source = source.slice(0, fn.getFullStart()) + source.slice(fn.getEnd());
  write(file, source);
  addImport(file, `import { timingSafeCompare } from '../_shared/crypto.ts';`);
}

// ── User settings half-hour options generated once ──────────────────────────
{
  const file = 'src/app/layout/components/UserSettingsModal.tsx';
  let source = read(file);
  const sf = parse(file, source);
  const matches = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'Array' && node.expression.name.text === 'from') {
      const text = node.getText(sf);
      if (text.includes('length: 48') && text.includes('<option')) matches.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (matches.length !== 2) throw new Error(`UserSettings half-hour generators expected 2, found ${matches.length}`);
  const generatorText = matches[0].getText(sf);
  if (matches[1].getText(sf).replace(/\s+/g, '') !== generatorText.replace(/\s+/g, '')) throw new Error('half-hour option generators differ');
  matches.sort((a,b) => b.getStart(sf)-a.getStart(sf));
  for (const node of matches) source = source.slice(0,node.getStart(sf)) + 'HALF_HOUR_OPTION_ELEMENTS' + source.slice(node.getEnd());
  const sf2 = parse(file, source);
  const firstNonImport = sf2.statements.find((s) => !ts.isImportDeclaration(s));
  const at = firstNonImport ? firstNonImport.getFullStart() : source.length;
  source = source.slice(0, at) + `const HALF_HOUR_OPTION_ELEMENTS = ${generatorText};\n\n` + source.slice(at);
  write(file, source);
}

// ── Org permissions: remove branch whose two sides are byte-equivalent ──────
{
  const file = 'src/components/OrgStructure/OrgPermissionsPanel.tsx';
  let source = read(file);
  const sf = parse(file, source);
  let declaration = null;
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleToggleAllInGroup') declaration = node;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (!declaration?.initializer || !ts.isArrowFunction(declaration.initializer)) throw new Error('handleToggleAllInGroup not found');
  const replacement = `(groupKeys: string[], enable: boolean) => {\n    setPerms(prev => {\n      const updated = { ...prev };\n      groupKeys.forEach(k => { updated[k] = enable; });\n      return updated;\n    });\n    if (mode === 'position') {\n      setOverrides(prev => {\n        const updated = { ...prev };\n        groupKeys.forEach(k => {\n          const baseValue = levelPerms[k] ?? false;\n          if (enable === baseValue) delete updated[k];\n          else updated[k] = enable;\n        });\n        return updated;\n      });\n    }\n  }`;
  source = source.slice(0, declaration.initializer.getStart(sf)) + replacement + source.slice(declaration.initializer.getEnd());
  const sf2 = parse(file, source);
  const calls = [];
  const visitCalls = (node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'handleToggleAllInGroup') calls.push(node);
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(sf2);
  if (!calls.length) throw new Error('handleToggleAllInGroup calls not found');
  calls.sort((a,b)=>b.getStart(sf2)-a.getStart(sf2));
  for (const call of calls) {
    if (call.arguments.length !== 3) throw new Error('unexpected handleToggleAllInGroup arity');
    const text = `handleToggleAllInGroup(${call.arguments[1].getText(sf2)}, ${call.arguments[2].getText(sf2)})`;
    source = source.slice(0, call.getStart(sf2)) + text + source.slice(call.getEnd());
  }
  write(file, source);
}

// ── User selector row renderer ───────────────────────────────────────────────
{
  const file = 'src/features/meetings/components/MeetingCard/UserSelectorModal.tsx';
  let source = read(file);
  const sf = parse(file, source);
  const arrows = [];
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map' && node.arguments[0] && ts.isArrowFunction(node.arguments[0])) {
      const text = node.arguments[0].getText(sf);
      if (text.includes('<UserRow') && text.includes('sendingToUserId')) arrows.push(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (arrows.length !== 2) throw new Error(`UserSelector UserRow callbacks expected 2, found ${arrows.length}`);
  arrows.sort((a,b)=>b.getStart(sf)-a.getStart(sf));
  for (const arrow of arrows) source = source.slice(0,arrow.getStart(sf)) + 'renderUserRow' + source.slice(arrow.getEnd());
  const marker = '  return (\n';
  const at = source.lastIndexOf(marker);
  if (at < 0) throw new Error('UserSelector final return marker not found');
  const renderer = `  const renderUserRow = (u: (typeof filteredAll)[number]) => (\n    <UserRow\n      key={u.user_id}\n      userId={u.user_id}\n      name={u.full_name || ''}\n      assignments={u.assignments}\n      sending={sendingToUserId === u.user_id}\n      disabled={loading}\n      onSend={handleSendToUser}\n    />\n  );\n\n`;
  source = source.slice(0,at) + renderer + source.slice(at);
  write(file, source);
}

// ── VideoArea promotion callback defined once ────────────────────────────────
{
  const file = 'src/components/VideoConference/Room/VideoArea.tsx';
  let source = read(file);
  const body = `peerId => setTileOrder(prev => {\n          const ids = orderedTiles.map(x => x.peerId);\n          const si = ids.indexOf(peerId);\n          if (si <= 0) return prev;\n          const next = [...ids];\n          next.splice(si, 1);\n          next.unshift(peerId);\n          return next;\n        })`;
  const count = source.split(body).length - 1;
  if (count !== 2) throw new Error(`VideoArea promote callback expected twice, found ${count}`);
  source = source.replaceAll(body, 'promoteTile');
  const marker = '  // ── Gallery';
  const at = source.indexOf(marker);
  if (at < 0) throw new Error('VideoArea gallery marker not found');
  const helper = `  const promoteTile = (peerId: string) => setTileOrder(prev => {\n    const ids = orderedTiles.map(tile => tile.peerId);\n    const index = ids.indexOf(peerId);\n    if (index <= 0) return prev;\n    const next = [...ids];\n    next.splice(index, 1);\n    next.unshift(peerId);\n    return next;\n  });\n\n`;
  source = source.slice(0,at) + helper + source.slice(at);
  write(file, source);
}

console.log('deterministic duplicate cleanup completed');
