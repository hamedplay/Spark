import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const timerService = read('src/features/video-conference/services/conferenceSpeakerTimer.ts');
const timerHook = read('src/features/video-conference/hooks/useConferenceSpeakerTimer.ts');
const roomPage = read('src/features/video-conference/components/room/ConferenceRoomPage.tsx');
const participants = read('src/features/video-conference/components/participants/ConferenceParticipantsPanel.tsx');
const controlEdge = read('supabase/functions/conference-speaker-timer-control/index.ts');
const enforcerEdge = read('supabase/functions/conference-speaker-timer-enforcer/index.ts');
const engineMigration = read('supabase/migrations/20260827205401_video_conference_phase4_speaker_timer_engine.sql');
const boundaryMigration = read('supabase/migrations/20260827210838_video_conference_phase4_timer_edge_boundary.sql');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('speaker timer state is server authoritative and cron-driven', () => {
  assert.match(engineMigration, /conference_speaker_sessions/);
  for (const state of ['ACTIVE','PAUSED','EXPIRED','COMPLETED']) {
    assert.match(engineMigration, new RegExp(`['"]${state}['"]`));
  }
  assert.match(engineMigration, /expire_conference_speaker_sessions/);
  assert.match(engineMigration, /conference-speaker-timer-enforcer/);
  assert.match(engineMigration, /'5 seconds'/);
  assert.match(engineMigration, /conference_speaker_timer_worker_secret/);
});

test('browser routes timer mutation through Edge instead of direct mutation RPC', () => {
  assert.match(timerService, /functions\.invoke\('conference-speaker-timer-control'/);
  assert.doesNotMatch(timerService, /rpc\('control_conference_speaker_timer'/);
  assert.match(boundaryMigration, /authorize_conference_speaker_timer_action/);
  assert.match(boundaryMigration, /apply_livekit_conference_speaker_timer_action/);
  assert.match(boundaryMigration, /control_conference_speaker_timer\(uuid,uuid,text,integer\)[\s\S]*from authenticated/i);
  assert.match(boundaryMigration, /apply_livekit_conference_speaker_timer_action\(uuid,uuid,text,integer,uuid\)[\s\S]*to service_role/i);
});

test('control Edge authorizes as user then applies as service role and syncs LiveKit permissions', () => {
  const authorizeAt = controlEdge.indexOf('authorize_conference_speaker_timer_action');
  const applyAt = controlEdge.indexOf('apply_livekit_conference_speaker_timer_action');
  const updateAt = controlEdge.indexOf('roomService.updateParticipant');
  assert.ok(authorizeAt >= 0 && applyAt > authorizeAt && updateAt > applyAt);
  assert.match(controlEdge, /mutePublishedTrack/);
  assert.match(controlEdge, /canPublishSources:\s*policy\.publishSources/);
});

test('expiry worker uses Vault-backed custom auth and idempotent DB claim-complete flow', () => {
  assert.match(enforcerEdge, /X-Speaker-Timer-Secret/);
  assert.match(enforcerEdge, /verify_conference_speaker_timer_worker_secret/);
  assert.match(enforcerEdge, /claim_conference_speaker_enforcement/);
  assert.match(enforcerEdge, /complete_conference_speaker_enforcement/);
  assert.match(enforcerEdge, /mutePublishedTrack/);
  assert.match(enforcerEdge, /roomService\.updateParticipant/);
});

test('frontend countdown is display-only and derived from synchronized server time', () => {
  assert.match(timerHook, /serverOffsetMs/);
  assert.match(timerHook, /new Date\(session\.expires_at\)/);
  assert.match(timerHook, /synchronizedNowMs/);
  assert.doesNotMatch(timerHook, /\.from\(['"]conference_speaker_sessions['"]\)\.update/);
  assert.match(roomPage, /speakerTimer\.microphoneBlocked/);
});

test('manager provisions worker endpoint and validates both timer functions', () => {
  assert.match(manager, /configure_conference_speaker_timer_worker/);
  assert.match(manager, /conference-speaker-timer-control/);
  assert.match(manager, /conference-speaker-timer-enforcer/);
  assert.match(manager, /https:\/\/\$\{API_DOMAIN\}\/functions\/v1\/conference-speaker-timer-enforcer/);
});

test('timer controls are permission driven and viewer is not assignable as timed speaker', () => {
  assert.match(participants, /canManageTimer/);
  assert.match(participants, /participant\.role !== 'VIEWER'/);
  assert.match(participants, /SpeakerTimerControl/);
});
