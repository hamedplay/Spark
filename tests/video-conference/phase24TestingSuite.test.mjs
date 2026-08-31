import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
} from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const packageJson = JSON.parse(read('package.json'));
const unit = read('tests/video-conference/phase24UnitBehavior.test.ts');
const integration = read(
  'tests/video-conference/runtime/phase24IntegrationRuntime.mjs',
);
const integrationEnv = read(
  'tests/video-conference/runtime/phase24-runtime.env.example',
);
const e2e = read(
  'tests/video-conference/e2e/phase24ConferenceE2E.mjs',
);
const e2eRunner = read(
  'tests/video-conference/e2e/run-phase24-e2e.sh',
);
const e2eEnv = read(
  'tests/video-conference/e2e/phase24-e2e.env.example',
);
const load = read(
  'tests/video-conference/load/run-phase24-livekit-load.sh',
);
const gitignore = read('.gitignore');
const timerHook = read(
  'src/features/video-conference/hooks/useConferenceSpeakerTimer.ts',
);
const phaseHook = read(
  'src/features/video-conference/hooks/useConferencePhase.ts',
);

test('Phase 24 provides safe default and explicit runtime test entrypoints', () => {
  assert.equal(
    packageJson.scripts['test:video-conference:contract'],
    'node --test tests/video-conference/phase*.test.mjs',
  );
  assert.equal(
    packageJson.scripts['test:video-conference:unit'],
    'node --import tsx --test tests/video-conference/phase24UnitBehavior.test.ts',
  );
  assert.equal(
    packageJson.scripts['test:video-conference'],
    'npm run test:video-conference:contract && npm run test:video-conference:unit',
  );
  assert.match(
    packageJson.scripts['test:video-conference:integration'],
    /phase24IntegrationRuntime\.mjs/,
  );
  assert.match(
    packageJson.scripts['test:video-conference:e2e'],
    /run-phase24-e2e\.sh/,
  );
  assert.match(
    packageJson.scripts['test:video-conference:load'],
    /run-phase24-livekit-load\.sh/,
  );

  assert.doesNotMatch(
    packageJson.scripts['test:video-conference'],
    /integration|e2e|load/,
  );
});

test('Phase 24 unit suite executes real application helpers instead of text copies', () => {
  for (const symbol of [
    'CONFERENCE_RBAC_ROLES',
    'CONFERENCE_PERMISSIONS',
    'hasConferencePermission',
    'calculateSpeakerRemainingSeconds',
    'calculateConferencePhaseRemainingSeconds',
    'conferencePhaseHidesMedia',
    'runConferencePhaseAction',
    'runConferencePollAction',
    'runConferenceChatAction',
    'getMyConferenceAuthorization',
  ]) {
    assert.match(unit, new RegExp(symbol));
  }

  assert.match(
    timerHook,
    /export function calculateSpeakerRemainingSeconds/,
  );
  assert.match(
    phaseHook,
    /export function calculateConferencePhaseRemainingSeconds/,
  );
  assert.match(
    phaseHook,
    /export function conferencePhaseHidesMedia/,
  );
});

test('Phase 24 unit coverage includes permissions roles timers phase polls and chat', () => {
  for (const marker of [
    'canonical conference roles',
    'permission helper',
    'speaker timer calculation',
    'phase countdown and media hiding',
    'phase transition intents',
    'poll transport',
    'poll snapshot',
    'chat action',
  ]) {
    assert.match(unit, new RegExp(marker, 'i'));
  }
});

test('runtime integration suite covers the required server-side lifecycle', () => {
  for (const marker of [
    'join authorization for both users',
    'LiveKit token issuance',
    'host disable/enable microphone',
    'speaker expiry worker lifecycle',
    'webhook idempotency database boundary',
    'recording start/stop lifecycle',
  ]) {
    assert.match(integration, new RegExp(marker));
  }

  assert.match(integration, /conference-livekit-token/);
  assert.match(integration, /conference-host-control/);
  assert.match(integration, /conference-speaker-timer-control/);
  assert.match(integration, /apply_livekit_webhook_event_v1/);
  assert.match(integration, /conference-recording/);
});

test('integration runner fails closed when runtime credentials are missing', () => {
  for (const key of [
    'PHASE24_SUPABASE_URL',
    'PHASE24_ANON_KEY',
    'PHASE24_SERVICE_ROLE_KEY',
    'PHASE24_HOST_ACCESS_TOKEN',
    'PHASE24_PARTICIPANT_ACCESS_TOKEN',
    'PHASE24_ROOM_ID',
    'PHASE24_PARTICIPANT_USER_ID',
  ]) {
    assert.match(integration, new RegExp(key));
  }

  assert.match(
    integration,
    /Missing required environment variable/,
  );
});

test('runtime integration cleanup restores mutable conference state', () => {
  assert.match(
    integration,
    /set_livekit_raise_hand[\s\S]*p_raised: false/,
  );
  assert.match(
    integration,
    /action: 'enable-mic'/,
  );
  assert.match(
    integration,
    /recordingStarted[\s\S]*action: 'stop'/,
  );
  assert.match(
    integration,
    /livekit_webhook_events[\s\S]*\.delete\(\)[\s\S]*event_id/,
  );
});

test('browser E2E covers every required two-user conference scenario', () => {
  for (const marker of [
    'two users join the real conference room',
    'public chat propagates between users',
    'private chat stays addressable to selected peer',
    'raise hand creates speaker queue state',
    'host mute and publish restriction controls work',
    'queued participant receives timed speaker session',
    'screen sharing publishes and unpublishes',
    'poll create and vote lifecycle works',
    'countdown phase transition',
    'break and resume transition',
    'recording start and stop lifecycle',
    'browser network loss recovers conference session',
  ]) {
    assert.match(e2e, new RegExp(marker));
  }
});

test('E2E uses semantic UI selectors and real authenticated storage states', () => {
  assert.match(e2e, /storageState/);
  assert.match(e2e, /grantPermissions/);
  assert.match(e2e, /camera/);
  assert.match(e2e, /microphone/);
  assert.match(e2e, /getByRole/);
  assert.match(e2e, /setOffline\(true\)/);
  assert.match(e2e, /setOffline\(false\)/);

  assert.doesNotMatch(e2e, /password\s*[:=]/i);
  assert.doesNotMatch(e2e, /refresh_token/i);
});

test('Playwright runner is pinned and does not persist test accounts in the repository', () => {
  assert.match(
    e2eRunner,
    /mcr\.microsoft\.com\/playwright:v1\.62\.0-noble/,
  );
  assert.match(
    e2eRunner,
    /playwright@1\.62\.0/,
  );
  assert.match(e2eRunner, /--init/);
  assert.match(e2eRunner, /--ipc=host/);
  assert.match(e2eRunner, /:ro/);

  assert.match(
    gitignore,
    /tests\/video-conference\/e2e\/\.state\//,
  );
  assert.match(
    gitignore,
    /\*\.storage-state\.json/,
  );
  assert.match(
    gitignore,
    /tests\/video-conference\/runtime\/\.env/,
  );
});

test('full E2E mode can require countdown recording and screen sharing', () => {
  assert.match(e2e, /PHASE24_E2E_REQUIRE_COUNTDOWN/);
  assert.match(e2e, /PHASE24_E2E_RECORDING/);
  assert.match(e2e, /PHASE24_E2E_SCREEN_SHARE/);

  assert.match(e2eEnv, /PHASE24_E2E_REQUIRE_COUNTDOWN=1/);
  assert.match(e2eEnv, /PHASE24_E2E_RECORDING=1/);
  assert.match(e2eEnv, /PHASE24_E2E_SCREEN_SHARE=1/);
});

test('20-user load test uses exactly ten publishing and ten subscribing clients', () => {
  assert.match(load, /--video-publishers 10/);
  assert.match(load, /--audio-publishers 10/);
  assert.match(load, /--subscribers 10/);
  assert.match(load, /Participants\s+: 20 total/);
  assert.match(load, /Publishers\s+: 10 audio\+video/);
  assert.match(load, /Subscribers\s+: 10/);
  assert.match(load, /--layout 4x4/);
  assert.match(load, /--simulate-speakers/);
});

test('load test is isolated to dedicated test rooms and enforces quality gates', () => {
  assert.match(load, /phase24-load-/);
  assert.match(
    load,
    /Refusing to run against a non-test room/,
  );
  assert.match(load, /ulimit -n 65535/);
  assert.match(load, /PACKET_LOSS_MAX_PERCENT:-5/);
  assert.match(load, /Packet loss .* exceeded threshold/);
  assert.match(load, /Subscriber error count/);
  assert.match(
    load,
    /could not connect\|track subscription failed\|panic\|fatal/,
  );
});

test('load test pins LiveKit CLI release and verifies its checksum', () => {
  assert.match(load, /PHASE24_LK_VERSION:-2\.18\.4/);
  assert.match(
    load,
    /livekit\/livekit-cli\/releases\/download/,
  );
  assert.match(load, /checksums\.txt/);
  assert.match(load, /sha256sum -c/);
  assert.match(load, /lk_bin.*--version/);
  assert.match(load, /perf load-test/);
});

test('committed runtime examples contain placeholders only', () => {
  assert.match(
    integrationEnv,
    /replace-with-test-service-role-key/,
  );
  assert.match(
    integrationEnv,
    /replace-with-host-access-token/,
  );
  assert.match(
    e2eEnv,
    /\/secure\/path\/host\.storage-state\.json/,
  );

  for (const content of [integrationEnv, e2eEnv]) {
    assert.doesNotMatch(content, /eyJ[A-Za-z0-9_-]{20,}\./);
    assert.doesNotMatch(content, /sb_secret_/);
  }
});

test('no generated test credential files are tracked by Phase 24 fixtures', () => {
  assert.equal(
    existsSync(
      new URL(
        '../../tests/video-conference/e2e/.state',
        import.meta.url,
      ),
    ),
    false,
  );
  assert.equal(
    existsSync(
      new URL(
        '../../tests/video-conference/runtime/.env',
        import.meta.url,
      ),
    ),
    false,
  );
});
