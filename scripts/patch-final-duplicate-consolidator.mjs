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

fs.writeFileSync(file, source);
