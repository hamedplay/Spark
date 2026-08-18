import fs from 'node:fs';

const file = 'scripts/consolidate-final-exact-duplicates.mjs';
let source = fs.readFileSync(file, 'utf8');
const before = "  { file: 'src/components/MeetingInboxButton.tsx', param: 'user', marker: 'handleConfirmDelegate(delegateForEntry, user.user_id)', helper: 'renderDelegateOption', type: '(typeof filteredDelegates)[number]', before: '  return (' },";
const after = "  { file: 'src/components/MeetingInboxButton.tsx', param: 'u', marker: 'handleDelegate(delegateForEntry, u.user_id)', helper: 'renderDelegateOption', type: '(typeof filteredDelegates)[number]', before: '  return (' },";
if (!source.includes(before)) throw new Error('outdated MeetingInbox matcher not found');
source = source.replace(before, after);
fs.writeFileSync(file, source);
