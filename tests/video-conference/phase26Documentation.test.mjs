import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(
  new URL(`../../${path}`, import.meta.url),
  'utf8',
);

const requiredDocs = [
  'architecture.md',
  'database.md',
  'livekit.md',
  'permissions.md',
  'deployment.md',
  'recording.md',
  'whiteboard.md',
  'monitoring.md',
  'testing.md',
  'troubleshooting.md',
];

test('Phase 26 publishes all required video conference documentation', () => {
  for (const name of requiredDocs) {
    const content = read(`docs/video-conference/${name}`);
    assert.ok(content.length > 500, name);
  }
});

test('Phase 26 architecture documents server authority and compatibility seam', () => {
  const architecture = read('docs/video-conference/architecture.md');
  assert.match(architecture, /PostgreSQL\/Supabase is the authoritative source/);
  assert.match(architecture, /ConferenceRoomCore/);
  assert.match(architecture, /max_participants = 10/);
  assert.match(architecture, /20-participant/);
});

test('Phase 26 LiveKit documentation reflects short lived policy-derived tokens', () => {
  const livekit = read('docs/video-conference/livekit.md');
  assert.match(livekit, /TTL = \*\*120 seconds\*\*/);
  assert.match(livekit, /publish\/subscribe\/data permission is derived from server policy/);
  assert.match(livekit, /roomAdmin = false/);
});

test('Phase 26 documents RBAC and records the observed OWNER moderator-chat mapping', () => {
  const permissions = read('docs/video-conference/permissions.md');
  for (const role of [
    'OWNER',
    'HOST',
    'CO_HOST',
    'MODERATOR',
    'PRESENTER',
    'PARTICIPANT',
    'VIEWER',
  ]) assert.match(permissions, new RegExp(role));

  assert.match(permissions, /ACCESS_MODERATOR_CHAT/);
  assert.match(permissions, /currently not present in OWNER/);
});

test('Phase 26 monitoring documentation no longer claims observability is missing', () => {
  const monitoring = read('docs/video-conference/monitoring.md');
  for (const component of [
    'Prometheus',
    'Alertmanager',
    'Grafana',
    'Loki',
    'Grafana Alloy',
    'Node Exporter',
    'Blackbox Exporter',
  ]) assert.match(monitoring, new RegExp(component));

  assert.doesNotMatch(monitoring, /Monitoring.*MISSING/i);
});

test('Phase 26 testing documentation distinguishes tooling from production load proof', () => {
  const testing = read('docs/video-conference/testing.md');
  assert.match(testing, /20 total simulated participants/);
  assert.match(testing, /not.*real 20-user production capacity/i);
  assert.match(testing, /Lint is not used/);
});

test('Phase 26 docs do not contain known secret field values', () => {
  const combined = requiredDocs
    .map((name) => read(`docs/video-conference/${name}`))
    .join('\n');

  assert.doesNotMatch(combined, /turn_credential\s*[=:]/i);
  assert.doesNotMatch(combined, /LIVEKIT_API_SECRET=[^<\s]/);
  assert.doesNotMatch(combined, /SERVICE_ROLE_KEY=[^<\s]/);
});
