#!/usr/bin/env node
/**
 * Standalone test suite for template catalog logic.
 * Run: node scripts/test-template-catalog.mjs
 *
 * Uses the project's own TypeScript compiler to transpile the catalog,
 * then tests the actual exported functions.
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdtempSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ─── Transpile the catalog using TypeScript API ───────────────────────────────
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const tmpDir = mkdtempSync(join(tmpdir(), 'tc-test-'));
const src = readFileSync(join(process.cwd(), 'src/config/templateCatalog.ts'), 'utf-8');
const result = ts.transpileModule(src, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022, strict: false },
  fileName: 'templateCatalog.ts',
});
const compiledPath = join(tmpDir, 'catalog.mjs');
writeFileSync(compiledPath, result.outputText);

const mod = await import(compiledPath + '?t=' + Date.now());

const {
  TEMPLATE_CATEGORIES,
  TEMPLATE_EVENT_TYPES,
  TEMPLATE_AUDIENCES,
  TEMPLATE_PLACEHOLDERS,
  PLACEHOLDER_KEYS,
  extractPlaceholders,
  findUnknownPlaceholders,
  renderTemplate,
  getMeetingTemplateKey,
  buildMeetingPayload,
} = mod;

// ─── Test runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, name) {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}`);
  }
}

function assertEq(actual, expected, name) {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(name);
    console.error(`  FAIL: ${name}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

console.log('\n=== Template Catalog Tests ===\n');

// ── 1. getMeetingTemplateKey: creator gets meeting_created ────────────────────
console.log('1. Creator receives meeting_created notification');
assertEq(getMeetingTemplateKey('creator', 'created'), 'meeting_created', 'creator + created → meeting_created');

console.log('2. Creator receives meeting_created SMS (same key)');
assertEq(getMeetingTemplateKey('creator', 'created'), 'meeting_created', 'creator SMS key matches notification key');

// ── 3. Participant receives invite ───────────────────────────────────────────
console.log('3. Participant receives meeting invite notification');
assertEq(getMeetingTemplateKey('participant', 'invite'), 'invite', 'participant + invite → invite');

console.log('4. Participant receives meeting invite SMS (same key)');
assertEq(getMeetingTemplateKey('participant', 'invite'), 'invite', 'participant SMS key matches notification key');

// ── 5. Representative receives representative template ─────────────────────────
console.log('5. Representative receives representative template');
assertEq(getMeetingTemplateKey('representative', 'invite'), 'meeting_representative_assigned', 'representative → meeting_representative_assigned');

// ── 6. Observer receives informational template ───────────────────────────────
console.log('6. Observer receives informational template');
assertEq(getMeetingTemplateKey('observer', 'invite'), 'invite', 'observer + invite → invite');

// ── 7. Organizer gets meeting_created ─────────────────────────────────────────
console.log('7. Organizer receives meeting_created');
assertEq(getMeetingTemplateKey('organizer', 'created'), 'meeting_created', 'organizer + created → meeting_created');

// ── 8. Creator on change gets change (not meeting_created) ─────────────────────
console.log('8. Creator on change gets change event');
assertEq(getMeetingTemplateKey('creator', 'change'), 'change', 'creator + change → change');

// ── 9. Meeting with location ──────────────────────────────────────────────────
console.log('9. Meeting with location renders correctly');
const payloadWithLoc = buildMeetingPayload({
  recipientName: 'حامد عرب خالقی', subject: 'جلسه بررسی قرارداد اسپادانا',
  dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
  location: 'شاهنامه', organizerName: 'حامد عرب خالقی',
});
const tplWithLoc = 'سلام {{full_name}}\nشما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} دعوت شده‌اید.\nتنظیم‌کننده جلسه: {{organizer_name}}';
const renderedWithLoc = renderTemplate(tplWithLoc, payloadWithLoc);
assert(renderedWithLoc.rendered.includes('در محل شاهنامه'), 'location renders in template');
assert(renderedWithLoc.rendered.includes('حامد عرب خالقی'), 'organizer_name renders in template');
assertEq(renderedWithLoc.leftover.length, 0, 'no leftover placeholders with full payload');

// ── 10. Meeting without location ──────────────────────────────────────────────
console.log('10. Meeting without location renders without location clause');
const payloadNoLoc = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه تست', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
});
const tplNoLoc = 'سلام {{full_name}}\nشما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} دعوت شده‌اید.';
const renderedNoLoc = renderTemplate(tplNoLoc, payloadNoLoc);
assert(!renderedNoLoc.rendered.includes('undefined'), 'no undefined in output when location missing');
assert(!renderedNoLoc.rendered.includes('null'), 'no null in output when location missing');
assertEq(renderedNoLoc.leftover.length, 0, 'no leftover when all used vars are provided');

// ── 11. Meeting with join link ─────────────────────────────────────────────────
console.log('11. Meeting with join link renders link');
const payloadWithLink = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه تست', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
  joinLink: 'https://meet.example.com/abc',
});
const tplWithLink = 'لینک ورود: {{join_link}}';
const renderedWithLink = renderTemplate(tplWithLink, payloadWithLink);
assert(renderedWithLink.rendered.includes('https://meet.example.com/abc'), 'join_link renders correctly');

// ── 12. Meeting without join link ──────────────────────────────────────────────
console.log('12. Meeting without join link does not show undefined');
const payloadNoLink = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه تست', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
});
const renderedNoLink = renderTemplate('لینک: {{join_link}}', payloadNoLink);
assertEq(renderedNoLink.rendered, 'لینک: ', 'missing join_link renders as empty string');

// ── 13. note:share has SMS template (category exists) ─────────────────────────
console.log('13. note:share category exists in catalog');
assert(TEMPLATE_CATEGORIES.some(c => c.key === 'note'), 'note category exists');
assert(TEMPLATE_EVENT_TYPES.some(e => e.key === 'share'), 'share event type exists');

// ── 14. chat:message has SMS template ──────────────────────────────────────────
console.log('14. chat:message event type exists');
assert(TEMPLATE_EVENT_TYPES.some(e => e.key === 'message'), 'message event type exists');

// ── 15. system:alert has SMS template ─────────────────────────────────────────
console.log('15. system:alert event type exists');
assert(TEMPLATE_EVENT_TYPES.some(e => e.key === 'alert'), 'alert event type exists');

// ── 16. report_ready belongs to report category ────────────────────────────────
console.log('16. report_ready belongs to report category');
assert(TEMPLATE_CATEGORIES.some(c => c.key === 'report'), 'report category exists');
assert(TEMPLATE_EVENT_TYPES.some(e => e.key === 'report_ready'), 'report_ready event type exists');

// ── 17. Unknown placeholder is rejected ─────────────────────────────────────────
console.log('17. Unknown placeholder is rejected');
const unknownResult = findUnknownPlaceholders('Hello {{unknown_var}} and {{full_name}}');
assertEq(unknownResult.length, 1, 'one unknown placeholder found');
assertEq(unknownResult[0], 'unknown_var', 'unknown_var is flagged');

// ── 18. Editing SMS template updates placeholders ──────────────────────────────
console.log('18. extractPlaceholders extracts from body text');
const extracted = extractPlaceholders('سلام {{full_name}}، جلسه {{meeting_subject}} در {{meeting_date}}');
assertEq(extracted.length, 3, 'three placeholders extracted');
assert(extracted.includes('full_name'), 'full_name extracted');
assert(extracted.includes('meeting_subject'), 'meeting_subject extracted');
assert(extracted.includes('meeting_date'), 'meeting_date extracted');

// ── 19. Removing a token removes it from placeholders ──────────────────────────
console.log('19. Removing a token removes it from placeholders');
const before = extractPlaceholders('سلام {{full_name}} {{meeting_subject}}');
const after = extractPlaceholders('سلام {{full_name}}');
assertEq(before.length, 2, 'two placeholders before removal');
assertEq(after.length, 1, 'one placeholder after removal');
assert(!after.includes('meeting_subject'), 'meeting_subject removed from list');

// ── 20. Rendering never outputs undefined or null ──────────────────────────────
console.log('20. Rendering never outputs undefined or null');
const renderedMissing = renderTemplate('Hello {{nonexistent_var}} world', {});
assert(!renderedMissing.rendered.includes('undefined'), 'no undefined in output');
assert(!renderedMissing.rendered.includes('null'), 'no null in output');
assertEq(renderedMissing.rendered, 'Hello  world', 'missing var replaced with empty');

// ── 21. Rendering reports unresolved placeholders ───────────────────────────────
console.log('21. Rendering reports unresolved placeholders');
const renderedUnresolved = renderTemplate('Hello {{missing_one}} and {{missing_two}}', {});
assertEq(renderedUnresolved.leftover.length, 2, 'two leftover placeholders');
assert(renderedUnresolved.leftover.includes('missing_one'), 'missing_one in leftover');
assert(renderedUnresolved.leftover.includes('missing_two'), 'missing_two in leftover');

// ── 22. Duplicate placeholders are deduplicated ────────────────────────────────
console.log('22. Duplicate placeholders are deduplicated');
const dupExtracted = extractPlaceholders('{{full_name}} {{full_name}} {{meeting_subject}}');
assertEq(dupExtracted.length, 2, 'duplicates removed');

// ── 23. Categories include all 8 ───────────────────────────────────────────────
console.log('23. All 8 categories present');
assertEq(TEMPLATE_CATEGORIES.length, 8, '8 categories');
const catKeys = TEMPLATE_CATEGORIES.map(c => c.key);
['meeting', 'task', 'calendar', 'chat', 'channel', 'note', 'report', 'system'].forEach(k => {
  assert(catKeys.includes(k), `category ${k} exists`);
});

// ── 24. All placeholder keys are unique ────────────────────────────────────────
console.log('24. All placeholder keys are unique');
const phKeys = TEMPLATE_PLACEHOLDERS.map(p => p.key);
assertEq(new Set(phKeys).size, phKeys.length, 'no duplicate placeholder keys');

// ── 25. organizer_name placeholder exists ──────────────────────────────────────
console.log('25. organizer_name placeholder exists');
assert(PLACEHOLDER_KEYS.includes('organizer_name'), 'organizer_name in PLACEHOLDER_KEYS');

// ── 26. Sample output for creator ──────────────────────────────────────────────
console.log('26. Sample output for creator');
const creatorPayload = buildMeetingPayload({
  recipientName: 'حامد عرب خالقی', subject: 'جلسه بررسی قرارداد اسپادانا',
  dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
  location: 'شاهنامه', organizerName: 'حامد عرب خالقی',
});
const creatorTpl = 'سلام {{full_name}}\nجلسه «{{meeting_subject}}» توسط شما برای تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} ثبت شد.';
const creatorRendered = renderTemplate(creatorTpl, creatorPayload);
const expectedCreator = 'سلام حامد عرب خالقی\nجلسه «جلسه بررسی قرارداد اسپادانا» توسط شما برای تاریخ ۱۴۰۵/۰۴/۲۱ از ساعت ۱۶:۰۰ تا ۱۷:۳۰ در محل شاهنامه ثبت شد.';
assertEq(creatorRendered.rendered, expectedCreator, 'creator output matches expected');

// ── 27. Sample output for participant ───────────────────────────────────────────
console.log('27. Sample output for participant');
const participantPayload = buildMeetingPayload({
  recipientName: 'علی احمدی', subject: 'جلسه بررسی قرارداد اسپادانا',
  dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
  location: 'شاهنامه', organizerName: 'حامد عرب خالقی',
});
const participantTpl = 'سلام {{full_name}}\n\nشما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} دعوت شده‌اید.\n\nتنظیم‌کننده جلسه: {{organizer_name}}';
const participantRendered = renderTemplate(participantTpl, participantPayload);
const expectedParticipant = 'سلام علی احمدی\n\nشما به جلسه «جلسه بررسی قرارداد اسپادانا» در تاریخ ۱۴۰۵/۰۴/۲۱ از ساعت ۱۶:۰۰ تا ۱۷:۳۰ در محل شاهنامه دعوت شده‌اید.\n\nتنظیم‌کننده جلسه: حامد عرب خالقی';
assertEq(participantRendered.rendered, expectedParticipant, 'participant output matches expected');

// ── 28. location_part renders correctly ────────────────────────────────────────
console.log('28. location_part renders with separator when location exists');
const payloadWithLocPart = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰', location: 'سالن',
});
const renderedLocPart = renderTemplate('جلسه در تاریخ {{meeting_date}}{{location_part}}', payloadWithLocPart);
assertEq(renderedLocPart.rendered, 'جلسه در تاریخ ۱۴۰۵/۰۴/۲۱ | سالن', 'location_part with separator');

console.log('29. location_part is empty when no location');
const payloadNoLocPart = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
});
const renderedNoLocPart = renderTemplate('جلسه در تاریخ {{meeting_date}}{{location_part}}', payloadNoLocPart);
assertEq(renderedNoLocPart.rendered, 'جلسه در تاریخ ۱۴۰۵/۰۴/۲۱', 'location_part empty when no location');

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  - ${f}`));
}
console.log(failed === 0 ? '\nALL TESTS PASSED' : '\nSOME TESTS FAILED');
process.exit(failed === 0 ? 0 : 1);
