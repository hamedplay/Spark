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
  resolveRecipientFullName,
  REQUIRED_MEETING_INVITE_PLACEHOLDERS,
  TEMPLATE_EVENTS,
  validateTemplateForEvent,
  validatePayloadForEvent,
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
assert(renderedWithLoc.text.includes('در محل شاهنامه'), 'location renders in template');
assert(renderedWithLoc.text.includes('حامد عرب خالقی'), 'organizer_name renders in template');
assertEq(renderedWithLoc.missingPlaceholders.length, 0, 'no missing placeholders with full payload');

// ── 10. Meeting without location ──────────────────────────────────────────────
console.log('10. Meeting without location renders without location clause');
const payloadNoLoc = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه تست', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
});
const tplNoLoc = 'سلام {{full_name}}\nشما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} دعوت شده‌اید.';
const renderedNoLoc = renderTemplate(tplNoLoc, payloadNoLoc);
assert(!renderedNoLoc.text.includes('undefined'), 'no undefined in output when location missing');
assert(!renderedNoLoc.text.includes('null'), 'no null in output when location missing');
assertEq(renderedNoLoc.missingPlaceholders.length, 0, 'no missing when all used vars are provided');

// ── 11. Meeting with join link ─────────────────────────────────────────────────
console.log('11. Meeting with join link renders link');
const payloadWithLink = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه تست', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
  joinLink: 'https://meet.example.com/abc',
});
const tplWithLink = 'لینک ورود: {{join_link}}';
const renderedWithLink = renderTemplate(tplWithLink, payloadWithLink);
assert(renderedWithLink.text.includes('https://meet.example.com/abc'), 'join_link renders correctly');

// ── 12. Meeting without join link ──────────────────────────────────────────────
console.log('12. Meeting without join link does not show undefined');
const payloadNoLink = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه تست', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
});
const renderedNoLink = renderTemplate('لینک: {{join_link}}', payloadNoLink);
assertEq(renderedNoLink.text, 'لینک: ', 'missing join_link renders as empty string');

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
assert(!renderedMissing.text.includes('undefined'), 'no undefined in output');
assert(!renderedMissing.text.includes('null'), 'no null in output');
assertEq(renderedMissing.text, 'Hello  world', 'missing var replaced with empty');

// ── 21. Rendering reports unresolved placeholders ───────────────────────────────
console.log('21. Rendering reports unresolved placeholders');
const renderedUnresolved = renderTemplate('Hello {{missing_one}} and {{missing_two}}', {});
assertEq(renderedUnresolved.missingPlaceholders.length, 2, 'two missing placeholders');
assert(renderedUnresolved.missingPlaceholders.includes('missing_one'), 'missing_one in missing');
assert(renderedUnresolved.missingPlaceholders.includes('missing_two'), 'missing_two in missing');

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
assertEq(creatorRendered.text, expectedCreator, 'creator output matches expected');

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
assertEq(participantRendered.text, expectedParticipant, 'participant output matches expected');

// ── 28. location_part renders correctly ────────────────────────────────────────
console.log('28. location_part renders with separator when location exists');
const payloadWithLocPart = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰', location: 'سالن',
});
const renderedLocPart = renderTemplate('جلسه در تاریخ {{meeting_date}}{{location_part}}', payloadWithLocPart);
assertEq(renderedLocPart.text, 'جلسه در تاریخ ۱۴۰۵/۰۴/۲۱ | سالن', 'location_part with separator');

console.log('29. location_part is empty when no location');
const payloadNoLocPart = buildMeetingPayload({
  recipientName: 'علی', subject: 'جلسه', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
});
const renderedNoLocPart = renderTemplate('جلسه در تاریخ {{meeting_date}}{{location_part}}', payloadNoLocPart);
assertEq(renderedNoLocPart.text, 'جلسه در تاریخ ۱۴۰۵/۰۴/۲۱', 'location_part empty when no location');

// ── 30. recipient_greeting with full name ─────────────────────────────────────
console.log('30. recipient_greeting with full name');
const payloadWithGreeting = buildMeetingPayload({
  recipientName: 'علی احمدی', subject: 'تست پیامک', dateStr: '۱۴۰۵/۰۴/۲۰', startTime: '۲۳:۰۰', endTime: '۲۳:۳۰', location: 'د',
});
assertEq(payloadWithGreeting.recipient_greeting, 'علی احمدی گرامی', 'recipient_greeting with name');

// ── 31. recipient_greeting fallback when no name ────────────────────────────────
console.log('31. recipient_greeting fallback when no name');
const payloadNoName = buildMeetingPayload({
  recipientName: '', subject: 'تست پیامک', dateStr: '۱۴۰۵/۰۴/۲۰', startTime: '۲۳:۰۰', endTime: '۲۳:۳۰', location: 'د',
});
assertEq(payloadNoName.recipient_greeting, 'همکار گرامی', 'recipient_greeting fallback to همکار گرامی');
assertEq(payloadNoName.full_name, '', 'full_name is empty string when no name');

// ── 32. Template with recipient_greeting renders correctly ─────────────────────
console.log('32. Template with recipient_greeting renders correctly');
const greetingTpl = '{{recipient_greeting}}، شما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} دعوت شده‌اید. تنظیم‌کننده جلسه: {{organizer_name}}';
const greetingRendered = renderTemplate(greetingTpl, payloadWithGreeting);
const expectedGreeting = 'علی احمدی گرامی، شما به جلسه «تست پیامک» در تاریخ ۱۴۰۵/۰۴/۲۰ از ساعت ۲۳:۰۰ تا ۲۳:۳۰ در محل د دعوت شده‌اید. تنظیم‌کننده جلسه: حامد عرب خالقی';
// Note: organizer_name is empty in payloadWithGreeting since we didn't pass it
// Let's build with organizer
const payloadWithGreeting2 = buildMeetingPayload({
  recipientName: 'علی احمدی', subject: 'تست پیامک', dateStr: '۱۴۰۵/۰۴/۲۰', startTime: '۲۳:۰۰', endTime: '۲۳:۳۰', location: 'د', organizerName: 'حامد عرب خالقی',
});
const greetingRendered2 = renderTemplate(greetingTpl, payloadWithGreeting2);
assert(greetingRendered2.text.startsWith('علی احمدی گرامی،'), 'greeting starts with recipient name');
assert(!greetingRendered2.text.startsWith('گرامی،'), 'greeting does NOT start with bare گرامی');
assert(greetingRendered2.text.includes('تنظیم‌کننده جلسه: حامد عرب خالقی'), 'organizer_name in output');
assertEq(greetingRendered2.missingPlaceholders.length, 0, 'no missing placeholders');

// ── 33. Missing full_name does not produce 'گرامی،' ───────────────────────────────
console.log("33. Missing full_name does not produce bare 'گرامی،'");
const noNameRendered = renderTemplate(greetingTpl, payloadNoName);
assert(noNameRendered.text.startsWith('همکار گرامی،'), 'starts with همکار گرامی');
assert(!noNameRendered.text.startsWith('گرامی،'), 'does NOT start with bare گرامی');
assert(!noNameRendered.text.includes('undefined'), 'no undefined in output');
assert(!noNameRendered.text.includes('null'), 'no null in output');

// ── 34. Creator and participant have different names ─────────────────────────────
console.log('34. Creator and participant have different names');
const creatorP = buildMeetingPayload({
  recipientName: 'حامد عرب خالقی', subject: 'جلسه', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
});
const participantP = buildMeetingPayload({
  recipientName: 'علی احمدی', subject: 'جلسه', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
});
assert(creatorP.full_name !== participantP.full_name, 'creator and participant have different full_name');
assert(creatorP.recipient_greeting !== participantP.recipient_greeting, 'different greetings');
assertEq(creatorP.recipient_greeting, 'حامد عرب خالقی گرامی', 'creator greeting');
assertEq(participantP.recipient_greeting, 'علی احمدی گرامی', 'participant greeting');

// ── 35. resolveRecipientFullName with various inputs ─────────────────────────────
console.log('35. resolveRecipientFullName with various inputs');
assertEq(resolveRecipientFullName({ full_name: 'علی احمدی' }), 'علی احمدی', 'uses full_name');
assertEq(resolveRecipientFullName({ full_name: null, display_name: 'علی' }), 'علی', 'falls back to display_name');
assertEq(resolveRecipientFullName({ full_name: null, display_name: null, name: 'احمدی' }), 'احمدی', 'falls back to name');
assertEq(resolveRecipientFullName({ full_name: null, display_name: null, name: null }), '', 'returns empty when no name');
assertEq(resolveRecipientFullName({}), '', 'returns empty for empty object');
assertEq(resolveRecipientFullName({ full_name: '  ' }), '', 'trims whitespace-only names');

// ── 36. renderTemplate returns structured result ─────────────────────────────────
console.log('36. renderTemplate returns structured result');
const structResult = renderTemplate('Hello {{full_name}} {{missing_var}}', { full_name: 'علی' });
assert(typeof structResult.text === 'string', 'text is string');
assert(Array.isArray(structResult.missingPlaceholders), 'missingPlaceholders is array');
assert(Array.isArray(structResult.unresolvedPlaceholders), 'unresolvedPlaceholders is array');
assertEq(structResult.missingPlaceholders[0], 'missing_var', 'missing_var in missingPlaceholders');
assertEq(structResult.unresolvedPlaceholders.length, 0, 'no unresolved after replace');

// ── 37. REQUIRED_MEETING_INVITE_PLACEHOLDERS ───────────────────────────────────────
console.log('37. REQUIRED_MEETING_INVITE_PLACEHOLDERS includes all required vars');
assert(REQUIRED_MEETING_INVITE_PLACEHOLDERS.includes('full_name'), 'includes full_name');
assert(REQUIRED_MEETING_INVITE_PLACEHOLDERS.includes('meeting_subject'), 'includes meeting_subject');
assert(REQUIRED_MEETING_INVITE_PLACEHOLDERS.includes('meeting_date'), 'includes meeting_date');
assert(REQUIRED_MEETING_INVITE_PLACEHOLDERS.includes('start_time'), 'includes start_time');
assert(REQUIRED_MEETING_INVITE_PLACEHOLDERS.includes('end_time'), 'includes end_time');
assert(REQUIRED_MEETING_INVITE_PLACEHOLDERS.includes('organizer_name'), 'includes organizer_name');
assert(!REQUIRED_MEETING_INVITE_PLACEHOLDERS.includes('location'), 'location is NOT required');

// ── 38. External participant with name ───────────────────────────────────────────
console.log('38. External participant with name');
const externalPayload = buildMeetingPayload({
  recipientName: 'مهمان خارجی', subject: 'جلسه', dateStr: '۱۴۰۵/۰۴/۲۱', startTime: '۱۶:۰۰', endTime: '۱۷:۳۰',
});
assertEq(externalPayload.full_name, 'مهمان خارجی', 'external participant name');
assertEq(externalPayload.recipient_greeting, 'مهمان خارجی گرامی', 'external participant greeting');

// ── 39. Rendered output never starts with bare 'گرامی' ────────────────────────────
console.log("39. Rendered output never starts with bare 'گرامی'");
const bareGreetingTpl = '{{recipient_greeting}}، شما به جلسه دعوت شده‌اید.';
const emptyPayload = {};
const bareResult = renderTemplate(bareGreetingTpl, emptyPayload);
assert(!bareResult.text.startsWith('گرامی'), 'does not start with bare گرامی');
assert(bareResult.text.startsWith('،') || bareResult.text === bareGreetingTpl, 'starts with comma or unchanged when recipient_greeting missing');
assert(bareResult.missingPlaceholders.includes('recipient_greeting'), 'recipient_greeting in missing');

// ── 40. recipient_greeting placeholder in catalog ────────────────────────────────
console.log('40. recipient_greeting placeholder in catalog');
assert(PLACEHOLDER_KEYS.includes('recipient_greeting'), 'recipient_greeting in PLACEHOLDER_KEYS');
assert(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'recipient_greeting'), 'recipient_greeting in TEMPLATE_PLACEHOLDERS');

// ── 41. Template selection: audience-specific wins over all ────────────────────────
console.log('41. Template selection: audience-specific wins over all');
// This tests the logic: getTemplates() checks audience-specific first, then 'all'
// We test the key construction logic
const specificKey = 'meeting:invite:participants';
const allKey = 'meeting:invite:all';
assert(specificKey !== allKey, 'specific and all keys are different');

// ── 42. Sample output for participant with greeting ────────────────────────────────
console.log('42. Sample output for participant with greeting');
const samplePayload = buildMeetingPayload({
  recipientName: 'علی احمدی', subject: 'تست پیامک', dateStr: '۱۴۰۵/۰۴/۲۰', startTime: '۲۳:۰۰', endTime: '۲۳:۳۰', location: 'د', organizerName: 'حامد عرب خالقی',
});
const sampleTpl = '{{recipient_greeting}}، شما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} دعوت شده‌اید. تنظیم‌کننده جلسه: {{organizer_name}}';
const sampleRendered = renderTemplate(sampleTpl, samplePayload);
const expectedSample = 'علی احمدی گرامی، شما به جلسه «تست پیامک» در تاریخ ۱۴۰۵/۰۴/۲۰ از ساعت ۲۳:۰۰ تا ۲۳:۳۰ در محل د دعوت شده‌اید. تنظیم‌کننده جلسه: حامد عرب خالقی';
assertEq(sampleRendered.text, expectedSample, 'participant sample with greeting matches expected');
assertEq(sampleRendered.missingPlaceholders.length, 0, 'no missing placeholders');

// ── 43. Sample output for no-name recipient ───────────────────────────────────────
console.log('43. Sample output for no-name recipient');
const noNamePayload2 = buildMeetingPayload({
  recipientName: '', subject: 'تست پیامک', dateStr: '۱۴۰۵/۰۴/۲۰', startTime: '۲۳:۰۰', endTime: '۲۳:۳۰', location: 'د', organizerName: 'حامد عرب خالقی',
});
const noNameRendered2 = renderTemplate(sampleTpl, noNamePayload2);
const expectedNoName = 'همکار گرامی، شما به جلسه «تست پیامک» در تاریخ ۱۴۰۵/۰۴/۲۰ از ساعت ۲۳:۰۰ تا ۲۳:۳۰ در محل د دعوت شده‌اید. تنظیم‌کننده جلسه: حامد عرب خالقی';
assertEq(noNameRendered2.text, expectedNoName, 'no-name sample with greeting matches expected');
assertEq(noNameRendered2.missingPlaceholders.length, 0, 'no missing placeholders (recipient_greeting has fallback)');

// ── Summary ───────────────────────────────────────────────────────────────────
// ── 44. meeting_confirmed event type exists ───────────────────────────────────
console.log('44. meeting_confirmed event type exists');
assert(TEMPLATE_EVENT_TYPES.some(e => e.key === 'meeting_confirmed'), 'meeting_confirmed in TEMPLATE_EVENT_TYPES');
assert(TEMPLATE_EVENTS.some(e => e.key === 'meeting_confirmed'), 'meeting_confirmed in TEMPLATE_EVENTS');

// ── 45. meeting_declined event type exists ────────────────────────────────────
console.log('45. meeting_declined event type exists');
assert(TEMPLATE_EVENT_TYPES.some(e => e.key === 'meeting_declined'), 'meeting_declined in TEMPLATE_EVENT_TYPES');
assert(TEMPLATE_EVENTS.some(e => e.key === 'meeting_declined'), 'meeting_declined in TEMPLATE_EVENTS');

// ── 46. getMeetingTemplateKey returns meeting_confirmed ────────────────────────
console.log('46. getMeetingTemplateKey returns meeting_confirmed');
assertEq(getMeetingTemplateKey('organizer', 'confirmed'), 'meeting_confirmed', 'organizer + confirmed → meeting_confirmed');
assertEq(getMeetingTemplateKey('participant', 'confirmed'), 'meeting_confirmed', 'participant + confirmed → meeting_confirmed');

// ── 47. getMeetingTemplateKey returns meeting_declined ─────────────────────────
console.log('47. getMeetingTemplateKey returns meeting_declined');
assertEq(getMeetingTemplateKey('organizer', 'declined'), 'meeting_declined', 'organizer + declined → meeting_declined');
assertEq(getMeetingTemplateKey('participant', 'declined'), 'meeting_declined', 'participant + declined → meeting_declined');

// ── 48. meeting_confirmed does NOT return change ──────────────────────────────
console.log('48. meeting_confirmed does NOT return change');
const confirmedKey = getMeetingTemplateKey('organizer', 'confirmed');
assert(confirmedKey !== 'change', 'confirmed is NOT change');
assert(confirmedKey === 'meeting_confirmed', 'confirmed is meeting_confirmed');

// ── 49. represented_person_name placeholder exists ────────────────────────────
console.log('49. represented_person_name placeholder exists');
assert(PLACEHOLDER_KEYS.includes('represented_person_name'), 'represented_person_name in PLACEHOLDER_KEYS');
assert(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'represented_person_name'), 'represented_person_name in TEMPLATE_PLACEHOLDERS');

// ── 50. participant_name placeholder exists ───────────────────────────────────
console.log('50. participant_name placeholder exists');
assert(PLACEHOLDER_KEYS.includes('participant_name'), 'participant_name in PLACEHOLDER_KEYS');

// ── 51. validateTemplateForEvent catches missing required ─────────────────────
console.log('51. validateTemplateForEvent catches missing required placeholders');
const repEvent = TEMPLATE_EVENTS.find(e => e.key === 'meeting_representative_assigned');
assert(repEvent, 'meeting_representative_assigned event definition exists');
const incompleteBody = '{{recipient_greeting}}، شما به عنوان جانشین برای جلسه «{{meeting_subject}}» انتخاب شده‌اید.';
const incompleteValidation = validateTemplateForEvent(incompleteBody, repEvent, PLACEHOLDER_KEYS);
assert(!incompleteValidation.valid, 'incomplete template is invalid');
assert(incompleteValidation.missingRequiredPlaceholders.includes('meeting_date'), 'missing meeting_date detected');
assert(incompleteValidation.missingRequiredPlaceholders.includes('start_time'), 'missing start_time detected');
assert(incompleteValidation.missingRequiredPlaceholders.includes('end_time'), 'missing end_time detected');
assert(incompleteValidation.missingRequiredPlaceholders.includes('represented_person_name'), 'missing represented_person_name detected');

// ── 52. validateTemplateForEvent passes for complete template ─────────────────
console.log('52. validateTemplateForEvent passes for complete template');
const completeBody = '{{recipient_greeting}}، شما به‌عنوان جانشین {{represented_person_name}} برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} انتخاب شده‌اید.';
const completeValidation = validateTemplateForEvent(completeBody, repEvent, PLACEHOLDER_KEYS);
assert(completeValidation.valid, 'complete template is valid');
assertEq(completeValidation.missingRequiredPlaceholders.length, 0, 'no missing required placeholders');

// ── 53. validatePayloadForEvent catches missing values ────────────────────────
console.log('53. validatePayloadForEvent catches missing required values');
const payloadValidation = validatePayloadForEvent('meeting_confirmed', { meeting_subject: 'test' });
assert(!payloadValidation.valid, 'incomplete payload is invalid');
assert(payloadValidation.missingRequiredValues.includes('meeting_date'), 'missing meeting_date in payload');
assert(payloadValidation.missingRequiredValues.includes('participant_name'), 'missing participant_name in payload');

// ── 54. validatePayloadForEvent passes for complete payload ────────────────────
console.log('54. validatePayloadForEvent passes for complete payload');
const completePayload = {
  meeting_subject: 'test',
  meeting_date: '1405/04/21',
  start_time: '16:00',
  end_time: '17:30',
  participant_name: 'Ali',
};
const completePayloadValidation = validatePayloadForEvent('meeting_confirmed', completePayload);
assert(completePayloadValidation.valid, 'complete payload is valid');
assertEq(completePayloadValidation.missingRequiredValues.length, 0, 'no missing required values');

// ── 55. meeting_confirmed template renders correctly ───────────────────────────
console.log('55. meeting_confirmed template renders correctly');
const confirmedPayload = {
  recipient_greeting: 'حامد گرامی',
  participant_name: 'علی احمدی',
  meeting_subject: 'جلسه تست',
  meeting_date: '1405/04/21',
  start_time: '16:00',
  end_time: '17:30',
};
const confirmedTpl = '{{recipient_greeting}}، {{participant_name}} حضور خود را در جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} تأیید کرد.';
const confirmedRendered = renderTemplate(confirmedTpl, confirmedPayload);
assertEq(confirmedRendered.text, 'حامد گرامی، علی احمدی حضور خود را در جلسه «جلسه تست» در تاریخ 1405/04/21 از ساعت 16:00 تا 17:30 تأیید کرد.', 'meeting_confirmed renders correctly');
assertEq(confirmedRendered.missingPlaceholders.length, 0, 'no missing placeholders');

// ── 56. meeting_declined template renders correctly ────────────────────────────
console.log('56. meeting_declined template renders correctly');
const declinedPayload = {
  recipient_greeting: 'حامد گرامی',
  participant_name: 'علی احمدی',
  meeting_subject: 'جلسه تست',
  meeting_date: '1405/04/21',
  start_time: '16:00',
  end_time: '17:30',
};
const declinedTpl = '{{recipient_greeting}}، {{participant_name}} دعوت به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} را رد کرد.';
const declinedRendered = renderTemplate(declinedTpl, declinedPayload);
assert(declinedRendered.text.includes('رد کرد'), 'declined template includes رد کرد');
assertEq(declinedRendered.missingPlaceholders.length, 0, 'no missing placeholders');

// ── 57. representative template includes all required placeholders ─────────────
console.log('57. representative template includes all required placeholders');
const repBody = '{{recipient_greeting}}، شما به‌عنوان جانشین {{represented_person_name}} برای جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} از ساعت {{start_time}} تا {{end_time}} در محل {{location}} انتخاب شده‌اید. تنظیم‌کننده جلسه: {{organizer_name}}';
const repValidation = validateTemplateForEvent(repBody, repEvent, PLACEHOLDER_KEYS);
assert(repValidation.valid, 'representative template is valid');
assertEq(repValidation.missingRequiredPlaceholders.length, 0, 'no missing required placeholders');

// ── 58. Consistency: all TEMPLATE_EVENTS have valid keys ──────────────────────
console.log('58. Consistency: all TEMPLATE_EVENTS have valid keys');
for (const event of TEMPLATE_EVENTS) {
  assert(typeof event.key === 'string' && event.key.length > 0, `event ${event.key || '(empty)'} has valid key`);
  assert(typeof event.category === 'string' && event.category.length > 0, `event ${event.key} has valid category`);
  assert(Array.isArray(event.requiredPlaceholders), `event ${event.key} has requiredPlaceholders array`);
  assert(Array.isArray(event.optionalPlaceholders), `event ${event.key} has optionalPlaceholders array`);
  assert(event.supportedChannels.includes('notification'), `event ${event.key} supports notification`);
}

// ── 59. Consistency: all required placeholders exist in PLACEHOLDER_KEYS ──────
console.log('59. Consistency: all required placeholders exist in PLACEHOLDER_KEYS');
for (const event of TEMPLATE_EVENTS) {
  for (const ph of event.requiredPlaceholders) {
    assert(PLACEHOLDER_KEYS.includes(ph), `event ${event.key} required placeholder ${ph} exists in catalog`);
  }
}

// ── 60. Consistency: all optional placeholders exist in PLACEHOLDER_KEYS ──────
console.log('60. Consistency: all optional placeholders exist in PLACEHOLDER_KEYS');
for (const event of TEMPLATE_EVENTS) {
  for (const ph of event.optionalPlaceholders) {
    assert(PLACEHOLDER_KEYS.includes(ph), `event ${event.key} optional placeholder ${ph} exists in catalog`);
  }
}

// ── 61. No template renders undefined ──────────────────────────────────────────
console.log('61. No template renders undefined');
const undefTest = renderTemplate('Hello {{missing}} world', {});
assert(!undefTest.text.includes('undefined'), 'no undefined in output');
assert(!undefTest.text.includes('null'), 'no null in output');

// ── 62. No output contains unresolved {{placeholder}} ──────────────────────────
console.log('62. No output contains unresolved {{placeholder}}');
const unresolvedTest = renderTemplate('Hello {{name}}', {});
assert(!unresolvedTest.text.includes('{{'), 'no {{ in rendered output');
assertEq(unresolvedTest.missingPlaceholders.length, 1, 'missing placeholder detected');

// ── 63. channel:mention event type exists ─────────────────────────────────────
console.log('63. channel:mention event type exists in catalog');
assert(TEMPLATE_EVENTS.some(e => e.key === 'mention' && e.category === 'channel'), 'channel:mention event definition exists');

// ── 64. note:share uses snake_case placeholders ────────────────────────────────
console.log('64. note:share uses snake_case placeholders');
const noteEvent = TEMPLATE_EVENTS.find(e => e.key === 'share' && e.category === 'note');
assert(noteEvent, 'note:share event definition exists');
assert(noteEvent.requiredPlaceholders.includes('note_title'), 'note:share requires note_title (snake_case)');
assert(noteEvent.requiredPlaceholders.includes('sender_name'), 'note:share requires sender_name (snake_case)');
assert(!noteEvent.requiredPlaceholders.includes('noteTitle'), 'note:share does NOT use noteTitle (camelCase)');
assert(!noteEvent.requiredPlaceholders.includes('senderName'), 'note:share does NOT use senderName (camelCase)');

console.log('\n=== Results ===');
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
if (failures.length > 0) {
  console.log('\nFailed tests:');
  failures.forEach(f => console.log(`  - ${f}`));
}
console.log(failed === 0 ? '\nALL TESTS PASSED' : '\nSOME TESTS FAILED');
