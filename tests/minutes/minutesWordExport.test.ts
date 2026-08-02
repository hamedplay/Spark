import assert from 'node:assert/strict';
import test from 'node:test';

import { sanitizeFilename, buildFilename } from '../../src/lib/minutesWordExport';
import { toDocData } from '../../src/components/Minutes/minutesToDocData';
import type { MinutesLayoutConfig } from '../../src/components/Minutes/MinutesDocumentData';

// ── sanitizeFilename ──────────────────────────────────────────────────────────

test('sanitizeFilename: removes invalid characters', () => {
  assert.equal(sanitizeFilename('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
});

test('sanitizeFilename: collapses spaces to dashes', () => {
  assert.equal(sanitizeFilename('hello   world'), 'hello-world');
});

test('sanitizeFilename: collapses consecutive dashes', () => {
  assert.equal(sanitizeFilename('a---b'), 'a-b');
});

test('sanitizeFilename: trims leading/trailing dots, spaces, dashes', () => {
  assert.equal(sanitizeFilename('.test.'), 'test');
  assert.equal(sanitizeFilename('  test  '), 'test');
  assert.equal(sanitizeFilename('-test-'), 'test');
});

test('sanitizeFilename: limits to 120 chars', () => {
  const long = 'a'.repeat(200);
  const result = sanitizeFilename(long);
  assert.equal(result.length, 120);
});

test('sanitizeFilename: empty string stays empty', () => {
  assert.equal(sanitizeFilename(''), '');
});

// ── buildFilename ───────────────────────────────────────────────────────────────

test('buildFilename: with title and date', () => {
  const name = buildFilename('جلسه هیات مدیره', '2026-08-01');
  assert.ok(name.startsWith('صورتجلسه-'));
  assert.ok(name.endsWith('.docx'));
  assert.ok(name.includes('جلسه-هیات-مدیره'));
});

test('buildFilename: empty title uses date only', () => {
  const name = buildFilename(null, '2026-08-01');
  assert.ok(name.startsWith('صورتجلسه-'));
  assert.ok(name.endsWith('.docx'));
  assert.ok(!name.includes('null'));
  assert.ok(!name.includes('undefined'));
});

test('buildFilename: both empty still produces valid name', () => {
  const name = buildFilename(null, null);
  assert.ok(name.startsWith('صورتجلسه-'));
  assert.ok(name.endsWith('.docx'));
});

test('buildFilename: strips invalid chars from title', () => {
  const name = buildFilename('test/file:name', '2026-08-01');
  assert.ok(!name.includes('/'));
  assert.ok(!name.includes(':'));
});

// ── Config visibility: showApprovers respects config ─────────────────────────

test('config visibility: showApprovers defaults to true with null config', () => {
  const data = toDocData({
    minute: {
      id: 'test-1',
      meeting_title_snapshot: 'تست',
      meeting_date_snapshot: '2026-08-01',
      meeting_start_time_snapshot: null,
      meeting_end_time_snapshot: null,
      meeting_location_snapshot: null,
      meeting_type: null,
      org_unit_name_snapshot: null,
      secretary_name_snapshot: 'دبیر',
      chair_name_snapshot: 'رئیس',
      notes: null,
      confidentiality: 'organizational',
      status: 'published',
      approval_mode: 'system',
      revision_number: 1,
      secretary_confirmed_at: null,
      chair_confirmed_at: null,
      published_at: null,
    },
    internalParts: [],
    externalParts: [],
    agendaResults: [],
    approvals: [],
    approvalComments: [],
    decisions: [],
    ownerNames: {},
    logoUrl: null,
    config: null,
  });
  assert.equal(data.config?.showApprovers, true);
});

test('config visibility: showApprovers is true when config has showApprovers=true', () => {
  const maliciousConfig: MinutesLayoutConfig = {
    headerTitle: 'تست',
    orgName: '',
    subtitle: '',
    footerText: '',
    showLogo: true,
    showParticipants: true,
    showApprovers: true,
    showConfidentiality: true,
    showDecisions: true,
    showNotes: true,
    fontSize: 'medium',
  };
  const data = toDocData({
    minute: {
      id: 'test-2',
      meeting_title_snapshot: 'تست',
      meeting_date_snapshot: '2026-08-01',
      meeting_start_time_snapshot: null,
      meeting_end_time_snapshot: null,
      meeting_location_snapshot: null,
      meeting_type: null,
      org_unit_name_snapshot: null,
      secretary_name_snapshot: 'دبیر',
      chair_name_snapshot: 'رئیس',
      notes: null,
      confidentiality: 'organizational',
      status: 'published',
      approval_mode: 'system',
      revision_number: 1,
      secretary_confirmed_at: null,
      chair_confirmed_at: null,
      published_at: null,
    },
    internalParts: [],
    externalParts: [],
    agendaResults: [],
    approvals: [],
    approvalComments: [],
    decisions: [],
    ownerNames: {},
    logoUrl: null,
    config: maliciousConfig,
  });
  assert.equal(data.config?.showApprovers, true);
});

test('config visibility: showDecisions and showConfidentiality respect config', () => {
  const config: MinutesLayoutConfig = {
    headerTitle: 'تست',
    orgName: '',
    subtitle: '',
    footerText: '',
    showLogo: false,
    showParticipants: false,
    showApprovers: true,
    showConfidentiality: false,
    showDecisions: false,
    showNotes: false,
    fontSize: 'medium',
  };
  const data = toDocData({
    minute: {
      id: 'test-3',
      meeting_title_snapshot: 'تست',
      meeting_date_snapshot: '2026-08-01',
      meeting_start_time_snapshot: null,
      meeting_end_time_snapshot: null,
      meeting_location_snapshot: null,
      meeting_type: null,
      org_unit_name_snapshot: null,
      secretary_name_snapshot: 'دبیر',
      chair_name_snapshot: 'رئیس',
      notes: null,
      confidentiality: 'organizational',
      status: 'published',
      approval_mode: 'system',
      revision_number: 1,
      secretary_confirmed_at: null,
      chair_confirmed_at: null,
      published_at: null,
    },
    internalParts: [],
    externalParts: [],
    agendaResults: [],
    approvals: [],
    approvalComments: [],
    decisions: [],
    ownerNames: {},
    logoUrl: null,
    config,
  });
  assert.equal(data.config?.showDecisions, false);
  assert.equal(data.config?.showConfidentiality, false);
  assert.equal(data.config?.showParticipants, false);
  assert.equal(data.config?.showLogo, false);
  assert.equal(data.config?.showApprovers, true);
  assert.equal(data.config?.showNotes, false);
});

// ── Config visibility: null config uses defaults ───────────────────────────────

test('config visibility: null config uses defaults', () => {
  const data = toDocData({
    minute: {
      id: 'test-4',
      meeting_title_snapshot: 'تست',
      meeting_date_snapshot: '2026-08-01',
      meeting_start_time_snapshot: null,
      meeting_end_time_snapshot: null,
      meeting_location_snapshot: null,
      meeting_type: null,
      org_unit_name_snapshot: null,
      secretary_name_snapshot: 'دبیر',
      chair_name_snapshot: 'رئیس',
      notes: null,
      confidentiality: 'organizational',
      status: 'published',
      approval_mode: 'system',
      revision_number: 1,
      secretary_confirmed_at: null,
      chair_confirmed_at: null,
      published_at: null,
    },
    internalParts: [],
    externalParts: [],
    agendaResults: [],
    approvals: [],
    approvalComments: [],
    decisions: [],
    ownerNames: {},
    logoUrl: null,
    config: null,
  });
  assert.equal(data.config?.showDecisions, true);
  assert.equal(data.config?.showConfidentiality, true);
  assert.equal(data.config?.showParticipants, true);
  assert.equal(data.config?.showLogo, true);
  assert.equal(data.config?.showApprovers, true);
  assert.equal(data.config?.showNotes, true);
  assert.equal(data.config?.headerTitle, 'صورت‌جلسه');
  assert.equal(data.config?.fontSize, 'medium');
});

// ── Config visibility: showNotes is independent of other flags ────────────────

test('config visibility: showNotes defaults to true with null config', () => {
  const data = toDocData({
    minute: {
      id: 'test-notes-1',
      meeting_title_snapshot: 'تست',
      meeting_date_snapshot: '2026-08-01',
      meeting_start_time_snapshot: null,
      meeting_end_time_snapshot: null,
      meeting_location_snapshot: null,
      meeting_type: null,
      org_unit_name_snapshot: null,
      secretary_name_snapshot: 'دبیر',
      chair_name_snapshot: 'رئیس',
      notes: 'یادداشت نمونه',
      confidentiality: 'organizational',
      status: 'published',
      approval_mode: 'system',
      revision_number: 1,
      secretary_confirmed_at: null,
      chair_confirmed_at: null,
      published_at: null,
    },
    internalParts: [],
    externalParts: [],
    agendaResults: [],
    approvals: [],
    approvalComments: [],
    decisions: [],
    ownerNames: {},
    logoUrl: null,
    config: null,
  });
  assert.equal(data.config?.showNotes, true);
});

test('config visibility: showNotes=false is preserved and independent of showParticipants/showApprovers', () => {
  const config: MinutesLayoutConfig = {
    headerTitle: 'تست',
    orgName: '',
    subtitle: '',
    footerText: '',
    showLogo: true,
    showParticipants: true,
    showApprovers: true,
    showConfidentiality: true,
    showDecisions: true,
    showNotes: false,
    fontSize: 'medium',
  };
  const data = toDocData({
    minute: {
      id: 'test-notes-2',
      meeting_title_snapshot: 'تست',
      meeting_date_snapshot: '2026-08-01',
      meeting_start_time_snapshot: null,
      meeting_end_time_snapshot: null,
      meeting_location_snapshot: null,
      meeting_type: null,
      org_unit_name_snapshot: null,
      secretary_name_snapshot: 'دبیر',
      chair_name_snapshot: 'رئیس',
      notes: 'یادداشت نمونه',
      confidentiality: 'organizational',
      status: 'published',
      approval_mode: 'system',
      revision_number: 1,
      secretary_confirmed_at: null,
      chair_confirmed_at: null,
      published_at: null,
    },
    internalParts: [],
    externalParts: [],
    agendaResults: [],
    approvals: [],
    approvalComments: [],
    decisions: [],
    ownerNames: {},
    logoUrl: null,
    config,
  });
  assert.equal(data.config?.showNotes, false);
  assert.equal(data.config?.showParticipants, true);
  assert.equal(data.config?.showApprovers, true);
  assert.equal(data.config?.showDecisions, true);
});

test('config visibility: showNotes=true while showParticipants=false and showApprovers=false', () => {
  const config: MinutesLayoutConfig = {
    headerTitle: 'تست',
    orgName: '',
    subtitle: '',
    footerText: '',
    showLogo: false,
    showParticipants: false,
    showApprovers: false,
    showConfidentiality: false,
    showDecisions: false,
    showNotes: true,
    fontSize: 'medium',
  };
  const data = toDocData({
    minute: {
      id: 'test-notes-3',
      meeting_title_snapshot: 'تست',
      meeting_date_snapshot: '2026-08-01',
      meeting_start_time_snapshot: null,
      meeting_end_time_snapshot: null,
      meeting_location_snapshot: null,
      meeting_type: null,
      org_unit_name_snapshot: null,
      secretary_name_snapshot: 'دبیر',
      chair_name_snapshot: 'رئیس',
      notes: 'یادداشت نمونه',
      confidentiality: 'organizational',
      status: 'published',
      approval_mode: 'system',
      revision_number: 1,
      secretary_confirmed_at: null,
      chair_confirmed_at: null,
      published_at: null,
    },
    internalParts: [],
    externalParts: [],
    agendaResults: [],
    approvals: [],
    approvalComments: [],
    decisions: [],
    ownerNames: {},
    logoUrl: null,
    config,
  });
  assert.equal(data.config?.showNotes, true);
  assert.equal(data.config?.showParticipants, false);
  assert.equal(data.config?.showApprovers, false);
});

// ── Config consistency: same config object used across preview, final, and Word ──

test('config consistency: toDocData passes through all config flags identically', () => {
  const config: MinutesLayoutConfig = {
    headerTitle: 'عنوان تست',
    orgName: 'سازمان تست',
    subtitle: 'زیرعنوان',
    footerText: 'پایان',
    showLogo: false,
    showParticipants: false,
    showApprovers: false,
    showConfidentiality: false,
    showDecisions: false,
    showNotes: false,
    fontSize: 'large',
  };
  const data = toDocData({
    minute: {
      id: 'test-consistency',
      meeting_title_snapshot: 'تست',
      meeting_date_snapshot: '2026-08-01',
      meeting_start_time_snapshot: null,
      meeting_end_time_snapshot: null,
      meeting_location_snapshot: null,
      meeting_type: null,
      org_unit_name_snapshot: null,
      secretary_name_snapshot: 'دبیر',
      chair_name_snapshot: 'رئیس',
      notes: 'یادداشت',
      confidentiality: 'organizational',
      status: 'published',
      approval_mode: 'system',
      revision_number: 1,
      secretary_confirmed_at: null,
      chair_confirmed_at: null,
      published_at: null,
    },
    internalParts: [],
    externalParts: [],
    agendaResults: [],
    approvals: [],
    approvalComments: [],
    decisions: [],
    ownerNames: {},
    logoUrl: null,
    config,
  });
  assert.equal(data.config?.headerTitle, config.headerTitle);
  assert.equal(data.config?.orgName, config.orgName);
  assert.equal(data.config?.subtitle, config.subtitle);
  assert.equal(data.config?.footerText, config.footerText);
  assert.equal(data.config?.showLogo, config.showLogo);
  assert.equal(data.config?.showParticipants, config.showParticipants);
  assert.equal(data.config?.showApprovers, config.showApprovers);
  assert.equal(data.config?.showConfidentiality, config.showConfidentiality);
  assert.equal(data.config?.showDecisions, config.showDecisions);
  assert.equal(data.config?.showNotes, config.showNotes);
  assert.equal(data.config?.fontSize, config.fontSize);
});
