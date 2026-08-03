import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  TEMPLATE_EVENTS,
  TEMPLATE_PLACEHOLDERS,
  TEMPLATE_AUDIENCES,
} from '../../src/config/templateCatalog';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Event type registry tests ─────────────────────────────────────────────────

test('meeting_invitation_delegate_assigned event exists with correct category', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'meeting_invitation_delegate_assigned');
  assert.ok(evt, 'meeting_invitation_delegate_assigned should be in TEMPLATE_EVENTS');
  assert.equal(evt!.category, 'meeting');
  assert.ok(evt!.audiences.includes('representatives'));
  assert.ok(evt!.supportedChannels.includes('sms'), 'delegate assigned should support SMS');
});

test('meeting_invitation_delegate_assigned requires correct placeholders', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'meeting_invitation_delegate_assigned');
  assert.ok(evt);
  assert.ok(evt!.requiredPlaceholders.includes('meeting_subject'));
  assert.ok(evt!.requiredPlaceholders.includes('meeting_date'));
  assert.ok(evt!.requiredPlaceholders.includes('start_time'));
  assert.ok(evt!.requiredPlaceholders.includes('end_time'));
  assert.ok(evt!.requiredPlaceholders.includes('represented_person_name'));
});

test('meeting_invitation_delegate_selected event exists with correct category', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'meeting_invitation_delegate_selected');
  assert.ok(evt, 'meeting_invitation_delegate_selected should be in TEMPLATE_EVENTS');
  assert.equal(evt!.category, 'meeting');
  assert.ok(evt!.audiences.includes('participants'));
  assert.ok(evt!.audiences.includes('observers'));
  assert.ok(evt!.audiences.includes('organizer'));
});

test('meeting_invitation_delegate_selected requires correct placeholders', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'meeting_invitation_delegate_selected');
  assert.ok(evt);
  assert.ok(evt!.requiredPlaceholders.includes('meeting_subject'));
  assert.ok(evt!.requiredPlaceholders.includes('represented_person_name'));
  assert.ok(evt!.requiredPlaceholders.includes('representative_name'));
});

test('meeting_invitation_delegation_confirmed event exists with correct category', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'meeting_invitation_delegation_confirmed');
  assert.ok(evt, 'meeting_invitation_delegation_confirmed should be in TEMPLATE_EVENTS');
  assert.equal(evt!.category, 'meeting');
  assert.ok(evt!.audiences.includes('delegators'));
});

test('meeting_invitation_delegation_confirmed requires correct placeholders', () => {
  const evt = TEMPLATE_EVENTS.find(e => e.key === 'meeting_invitation_delegation_confirmed');
  assert.ok(evt);
  assert.ok(evt!.requiredPlaceholders.includes('meeting_subject'));
  assert.ok(evt!.requiredPlaceholders.includes('representative_name'));
});

test('delegate events do NOT use minutes category or minutes event type', () => {
  const meetingDelegateEvents = TEMPLATE_EVENTS.filter(
    e => e.key.startsWith('meeting_invitation_delegate') || e.key === 'meeting_invitation_delegation_confirmed'
  );
  for (const evt of meetingDelegateEvents) {
    assert.equal(evt!.category, 'meeting', `${evt!.key} should be category meeting`);
    assert.ok(!evt!.key.includes('minute'), `${evt!.key} should not be a minutes event`);
  }
});

test('meeting delegation events are distinct from minutes delegation events', () => {
  const meetingEvents = TEMPLATE_EVENTS.filter(e => e.key.startsWith('meeting_invitation'));
  const minutesEvents = TEMPLATE_EVENTS.filter(e => e.key.startsWith('minute_approval') || e.key.startsWith('minute_approver'));
  assert.ok(meetingEvents.length >= 3, 'should have at least 3 meeting delegation events');
  assert.ok(minutesEvents.length >= 2, 'should have at least 2 minutes delegation events');
  // No overlap
  for (const m of meetingEvents) {
    for (const n of minutesEvents) {
      assert.notEqual(m.key, n.key, 'meeting and minutes events should not overlap');
    }
  }
});

// ── Audience tests ───────────────────────────────────────────────────────────

test('representatives audience exists in catalog', () => {
  assert.ok(TEMPLATE_AUDIENCES.some(a => a.key === 'representatives'));
});

test('delegators audience exists in catalog', () => {
  assert.ok(TEMPLATE_AUDIENCES.some(a => a.key === 'delegators'));
});

test('organizer audience exists in catalog', () => {
  assert.ok(TEMPLATE_AUDIENCES.some(a => a.key === 'organizer'));
});

// ── Placeholder tests ─────────────────────────────────────────────────────────

test('represented_person_name placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'represented_person_name'));
});

test('representative_name placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'representative_name'));
});

test('meeting_subject placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'meeting_subject'));
});

test('meeting_date placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'meeting_date'));
});

test('start_time placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'start_time'));
});

test('end_time placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'end_time'));
});

test('location placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'location'));
});

test('meeting_link placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'meeting_link'));
});

test('organizer_name placeholder exists in catalog', () => {
  assert.ok(TEMPLATE_PLACEHOLDERS.some(p => p.key === 'organizer_name'));
});

// ── Frontend wiring tests ─────────────────────────────────────────────────────

test('MeetingInboxButton calls RPC instead of edge function for delegation', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/MeetingInboxButton.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('assign_meeting_invitation_delegate'), 'should call the RPC');
  assert.ok(!source.includes('delegate-meeting'), 'should not call the edge function directly');
});

test('MeetingInboxButton does not use slice(11,16) for time extraction', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/MeetingInboxButton.tsx'),
    'utf-8',
  );
  // The delegation handler should not slice time fields
  assert.ok(!source.includes('slice(11, 16)'), 'should not use slice(11,16) for time');
});

test('MeetingInboxButton does not send eventType change for delegation', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/MeetingInboxButton.tsx'),
    'utf-8',
  );
  // The handleDelegate function should not contain eventType: 'change'
  // and should not call insertNotification (notifications are sent by the RPC)
  const delegateStart = source.indexOf('const handleDelegate');
  // handleDelegate is the last handler — use the component return or end of function
  const delegateEnd = source.indexOf('return (', delegateStart);
  assert.ok(delegateStart > -1, 'should find handleDelegate');
  assert.ok(delegateEnd > delegateStart, 'should find return after handleDelegate');
  const delegateSection = source.substring(delegateStart, delegateEnd);
  assert.ok(!delegateSection.includes("'change'"), 'delegation should not send eventType change');
  assert.ok(!delegateSection.includes('insertNotification'), 'delegation should not call insertNotification directly');
});

test('MeetingInboxButton handles delegate RPC error codes', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/MeetingInboxButton.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('CANNOT_DELEGATE_TO_SELF'), 'should handle self-delegation error');
  assert.ok(source.includes('DELEGATE_ALREADY_ASSIGNED'), 'should handle already-assigned error');
  assert.ok(source.includes('DELEGATE_ALREADY_PARTICIPANT'), 'should handle already-participant error');
  assert.ok(source.includes('DELEGATE_PROFILE_INVALID'), 'should handle invalid profile error');
  assert.ok(source.includes('DELEGATE_DIFFERENT_ORG'), 'should handle different org error');
  assert.ok(source.includes('INBOX_VERSION_CONFLICT'), 'should handle version conflict error');
  assert.ok(source.includes('DELEGATE_IS_ORGANIZER'), 'should handle organizer error');
  assert.ok(source.includes('DELEGATE_ALREADY_INVITED'), 'should handle already-invited error');
});

test('MeetingInboxButton passes optimistic concurrency timestamp to RPC', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/MeetingInboxButton.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('p_expected_updated_at'), 'should pass p_expected_updated_at to RPC');
  assert.ok(source.includes('updated_at'), 'should fetch updated_at before RPC call');
});

// ── Edge function tests ──────────────────────────────────────────────────────

test('edge function is a thin wrapper that calls the RPC', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/delegate-meeting/index.ts'),
    'utf-8',
  );
  assert.ok(source.includes('assign_meeting_invitation_delegate'), 'should call the RPC');
  assert.ok(!source.includes('service_role'), 'should not use service role key');
  assert.ok(source.includes('auth.getUser'), 'should verify user identity');
  assert.ok(source.includes('Authorization'), 'should preserve user JWT');
});

test('edge function does not directly manipulate meeting_inbox or meetings tables', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/delegate-meeting/index.ts'),
    'utf-8',
  );
  // The edge function should only read meeting_inbox for updated_at, not update it
  assert.ok(!source.includes('.update('), 'should not directly update tables');
  assert.ok(!source.includes('.delete('), 'should not directly delete from tables');
  assert.ok(!source.includes('.insert('), 'should not directly insert into tables');
});

test('edge function rejects self-delegation', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/delegate-meeting/index.ts'),
    'utf-8',
  );
  assert.ok(source.includes('Cannot delegate to yourself'), 'should reject self-delegation');
});

test('edge function has CORS headers', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../supabase/functions/delegate-meeting/index.ts'),
    'utf-8',
  );
  assert.ok(source.includes('Access-Control-Allow-Origin'), 'should have CORS headers');
  assert.ok(source.includes('OPTIONS'), 'should handle OPTIONS preflight');
});

// ── Independence from minutes delegation ─────────────────────────────────────

test('meeting delegation events do not share event keys with minutes delegation', () => {
  const meetingEvents = TEMPLATE_EVENTS.filter(e => e.key.startsWith('meeting_invitation'));
  const minutesEvents = TEMPLATE_EVENTS.filter(e => e.key.startsWith('minute_approval') || e.key.startsWith('minute_approver'));
  for (const m of meetingEvents) {
    for (const n of minutesEvents) {
      assert.notEqual(m.key, n.key);
      assert.notEqual(m.category, n.category, 'meeting and minutes events should have different categories');
    }
  }
});

test('meeting delegation uses meeting_inbox not minutes_approvals', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../src/components/MeetingInboxButton.tsx'),
    'utf-8',
  );
  assert.ok(source.includes('meeting_inbox'), 'should reference meeting_inbox');
  assert.ok(!source.includes('minutes_approvals'), 'should not reference minutes_approvals');
});
