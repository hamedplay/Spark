import fs from 'node:fs';

const file = 'scripts/consolidate-final-exact-duplicates.mjs';
let source = fs.readFileSync(file, 'utf8');

const inboxBefore = "  { file: 'src/components/MeetingInboxButton.tsx', param: 'user', marker: 'handleConfirmDelegate(delegateForEntry, user.user_id)', helper: 'renderDelegateOption', type: '(typeof filteredDelegates)[number]', before: '  return (' },";
const inboxAfter = "  { file: 'src/components/MeetingInboxButton.tsx', param: 'u', marker: 'handleDelegate(delegateForEntry, u.user_id)', helper: 'renderDelegateOption', type: '(typeof filteredDelegates)[number]', before: '  return (' },";
if (source.includes(inboxBefore)) source = source.replace(inboxBefore, inboxAfter);
if (!source.includes(inboxAfter)) throw new Error('current MeetingInbox matcher not found');

const timeBefore = "  const visit = (node) => { if (ts.isCallExpression(node) && node.getText(sf).includes('Array.from({ length: 48 }') && node.getText(sf).includes('<option')) matches.push(node); ts.forEachChild(node, visit); };";
const timeAfter = "  const visit = (node) => { const text = node.getText(sf); if (ts.isCallExpression(node) && text.includes('Array.from(') && text.includes('length: 48') && text.includes('<option')) matches.push(node); ts.forEachChild(node, visit); };";
if (source.includes(timeBefore)) source = source.replace(timeBefore, timeAfter);
if (!source.includes(timeAfter)) throw new Error('current UserSettings matcher not found');

if (!source.includes('Shared message-body mention state')) {
  const marker = '\n// Shared outside-click dismissal.';
  if (!source.includes(marker)) throw new Error('outside-click marker not found');
  const block = `
// Shared message-body mention state for Chat and Channel input bars.
{
  const shared = 'src/shared/chat/MessageInputPrimitives.tsx';
  let sharedSource = read(shared);
  const sharedMarker = 'interface MessageTypeOption<K extends string>';
  if (!sharedSource.includes(sharedMarker)) throw new Error('MessageInputPrimitives marker missing');
  sharedSource = sharedSource.replace(sharedMarker, \`export function updateMessageBody(value: string, setBody: (value: string) => void, pushHistory: (value: string) => void, setShowMentionMenu: (value: boolean) => void, setMentionSearch: (value: string) => void) {\\n  setBody(value);\\n  pushHistory(value);\\n  const lastAt = value.lastIndexOf('@');\\n  if (lastAt >= 0 && (lastAt === value.length - 1 || value.slice(lastAt + 1).match(/^\\\\w*$/))) {\\n    setShowMentionMenu(true);\\n    setMentionSearch(value.slice(lastAt + 1));\\n  } else {\\n    setShowMentionMenu(false);\\n  }\\n}\\n\\ninterface MessageTypeOption<K extends string>\`);
  write(shared, sharedSource);

  for (const inputFile of ['src/components/Chat/ChatInputBar.tsx', 'src/components/Channels/ChannelInputBar.tsx']) {
    let inputSource = read(inputFile);
    const inputSf = parse(inputFile, inputSource);
    const matches = [];
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'handleBodyChange' && node.initializer && ts.isArrowFunction(node.initializer)) matches.push(node.initializer);
      ts.forEachChild(node, visit);
    };
    visit(inputSf);
    if (matches.length !== 1) throw new Error(\`${inputFile}: handleBodyChange count=\${matches.length}\`);
    const fn = matches[0];
    inputSource = inputSource.slice(0, fn.getStart(inputSf)) + \`(val: string) => updateMessageBody(val, setBody, pushHistory, setShowMentionMenu, setMentionSearch)\` + inputSource.slice(fn.getEnd());
    write(inputFile, inputSource);
    addImport(inputFile, \`import { updateMessageBody } from '../../shared/chat/MessageInputPrimitives';\`);
  }
}
`;
  source = source.replace(marker, `\n${block}\n// Shared outside-click dismissal.`);
}

fs.writeFileSync(file, source);
