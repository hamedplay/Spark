import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const types = read('src/features/video-conference/types/conference.types.ts');
const timerHook = read('src/features/video-conference/hooks/useConferenceSpeakerTimer.ts');
const moderation = read('src/features/video-conference/hooks/useConferenceModeration.ts');
const participants = read('src/features/video-conference/components/participants/ConferenceParticipantsPanel.tsx');
const queuePanel = read('src/features/video-conference/components/participants/SpeakerQueuePanel.tsx');
const queueService = read('src/features/video-conference/services/conferenceSpeakerQueue.ts');
const queueEdge = read('supabase/functions/conference-speaker-queue-control/index.ts');
const enforcer = read('supabase/functions/conference-speaker-timer-enforcer/index.ts');
const hostEdge = read('supabase/functions/conference-host-control/index.ts');
const migration = read('supabase/migrations/20260827214304_video_conference_phase5_speaker_queue.sql');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('speaker queue reuses the Phase 4 speaker-session lifecycle instead of duplicating state', () => {
  assert.match(migration, /add column if not exists queue_position bigint/i);
  assert.match(migration, /status='QUEUED'/);
  assert.match(migration, /conference_speaker_sessions_queue_idx/);
  assert.doesNotMatch(migration, /create table public\.conference_speaker_queue/i);
});

test('hand raise creates a server-side queued session ordered from hand raise time', () => {
  assert.match(migration, /create or replace function private\.set_livekit_raise_hand/);
  assert.match(migration, /hand_raised_at=coalesce\(hand_raised_at,v_now\)/);
  assert.match(migration, /coalesce\(max\(s\.queue_position\),0\)\+1/);
  assert.match(migration, /'QUEUED'/);
  assert.match(migration, /speaker_queue_joined/);
});

test('queued speakers cannot publish microphone until selected', () => {
  assert.match(migration, /v_session_status in \('QUEUED','PAUSED','EXPIRED','COMPLETED'\)/);
  assert.match(timerHook, /ownSession\.status === 'QUEUED'/);
  assert.match(enforcer, /status === "QUEUED"/);
  assert.match(enforcer, /mutePublishedTrack/);
});

test('host queue actions are server authorized and service-role applied', () => {
  for (const action of ['move_up', 'move_down', 'remove', 'set_time', 'allow']) {
    assert.match(types, new RegExp(`['"]${action}['"]`));
    assert.match(migration, new RegExp(`['"]${action}['"]`));
  }
  assert.match(migration, /authorize_conference_speaker_queue_action/);
  assert.match(migration, /MANAGE_TIMER/);
  assert.match(migration, /apply_livekit_conference_speaker_queue_action/);
  assert.match(migration, /to service_role/i);
});

test('allow to speak starts the authoritative timer and returns the resulting LiveKit policy', () => {
  const timerAt = migration.indexOf('v_timer:=private.apply_conference_speaker_timer_action');
  const handAt = migration.indexOf("set is_hand_raised=false", timerAt);
  assert.ok(timerAt >= 0 && handAt > timerAt);
  assert.match(migration, /'start'/);
  assert.match(migration, /speaker_queue_allowed/);
  assert.match(queueEdge, /roomService\.updateParticipant/);
  assert.match(queueEdge, /complete_conference_speaker_enforcement/);
});

test('frontend renders the real queue and no longer treats raised-at sorting as the queue authority', () => {
  assert.match(moderation, /session\?\.status === 'QUEUED'/);
  assert.match(moderation, /session\.queue_position/);
  assert.doesNotMatch(moderation, /filter\(\(participant\) => participant\.is_hand_raised\)\s*\.sort/);
  assert.match(participants, /SpeakerQueuePanel/);
  assert.match(participants, /speakerSession\?\.status !== 'QUEUED'/);
});

test('queue UI exposes reorder, remove, speaking time, and allow controls', () => {
  assert.match(queuePanel, /move_up/);
  assert.match(queuePanel, /move_down/);
  assert.match(queuePanel, /remove/);
  assert.match(queuePanel, /set_time/);
  assert.match(queuePanel, /allow/);
  for (const seconds of ['30', '60', '120', '180', '300']) {
    assert.match(queuePanel, new RegExp(`value="${seconds}"`));
  }
});

test('browser queue management goes through Edge rather than direct mutation RPC', () => {
  assert.match(queueService, /functions\.invoke\([\s\S]*conference-speaker-queue-control/);
  assert.doesNotMatch(queueService, /rpc\(['"]apply_livekit_conference_speaker_queue_action/);
  assert.match(queueEdge, /authorize_conference_speaker_queue_action/);
  assert.match(queueEdge, /apply_livekit_conference_speaker_queue_action/);
});

test('existing moderator lower-hand path also reconciles queued microphone policy', () => {
  assert.match(hostEdge, /body\.action === "lower-hand"/);
  assert.match(hostEdge, /data\.livekit_policy/);
  assert.match(hostEdge, /roomService\.updateParticipant/);
  assert.match(hostEdge, /complete_conference_speaker_enforcement/);
});

test('self-hosted validation includes the Phase 5 queue Edge function', () => {
  assert.match(manager, /livekit_function_unauthorized_probe conference-speaker-queue-control/);
});
