import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const hardening = read('supabase/migrations/20260831060153_video_conference_phase16_recording_hardening.sql');
const joinGate = read('supabase/migrations/20260831060310_video_conference_phase16_recording_consent_join_gate.sql');
const recording = read('supabase/functions/conference-recording/index.ts');
const webhook = read('supabase/functions/livekit-webhook/index.ts');
const moderation = read('src/features/video-conference/hooks/useConferenceModeration.ts');
const realtime = read('src/features/video-conference/services/conferenceRealtime.ts');
const consentHook = read('src/features/video-conference/hooks/useConferenceRecordingConsent.ts');
const consentBanner = read('src/features/video-conference/components/recording/RecordingConsentBanner.tsx');
const page = read('src/components/VideoConference/VideoConferencePage.tsx');
const roomHook = read('src/features/video-conference/hooks/useLiveKitRoom.ts');
const types = read('src/features/video-conference/types/conference.types.ts');
const compose = read('deploy/livekit/docker-compose.yml');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('Phase 16 uses the exact production recording lifecycle', () => {
  for (const status of [
    'queued',
    'starting',
    'recording',
    'stopping',
    'processing',
    'completed',
    'failed',
  ]) {
    assert.match(hardening, new RegExp("'" + status + "'"));
    assert.match(types, new RegExp("'" + status + "'"));
  }
  assert.doesNotMatch(types, /'ready'/);
  assert.match(realtime, /'queued', 'starting', 'recording', 'stopping', 'processing'/);
});

test('one active recording per room is enforced in PostgreSQL', () => {
  assert.match(hardening, /conference_recordings_active_room_uidx/);
  assert.match(hardening, /unique index/);
  assert.match(hardening, /on public\.conference_recordings\(room_id\)/);
  assert.match(hardening, /where status in \('queued','starting','recording','stopping','processing'\)/);
});

test('recording metadata is synchronized from LiveKit Egress fileResults', () => {
  for (const field of [
    'duration_seconds',
    'size_bytes',
    'started_at',
    'ended_at',
    'provider_egress_id',
    'storage_path',
    'provider_status',
  ]) {
    assert.match(hardening, new RegExp(field));
  }
  assert.match(hardening, /\{egressInfo,fileResults,0,duration\}/);
  assert.match(hardening, /\{egressInfo,fileResults,0,size\}/);
  assert.match(hardening, /\{egressInfo,fileResults,0,filename\}/);
  assert.match(hardening, /1000000000/);
});

test('webhook processing is idempotent and monotonic', () => {
  assert.match(hardening, /on conflict\(event_id\) where event_id is not null do nothing/);
  assert.match(hardening, /'duplicate',true/);
  assert.match(hardening, /recording_status_rank/);
  assert.match(hardening, /when r\.status in \('completed','failed'\) then r\.status/);
  assert.match(hardening, /p_source='webhook'/);
});

test('LiveKit webhook verifies the signature and uses event id as idempotency key', () => {
  assert.match(webhook, /WebhookReceiver/);
  assert.match(webhook, /\.receive\(rawBody, authHeader\)/);
  assert.match(webhook, /WEBHOOK_EVENT_ID_REQUIRED/);
  assert.match(webhook, /p_event_id: eventId/);
  assert.match(webhook, /typeof item === "bigint" \? item\.toString\(\) : item/);
  assert.match(webhook, /egressInfo\?\.roomName/);
  assert.doesNotMatch(webhook, /p_event_id: null/);
});

test('uncertain Egress start and stop are reconciled instead of blindly failing', () => {
  assert.match(recording, /listEgress/);
  assert.match(recording, /storagePathMatches/);
  assert.match(recording, /START_STATUS_UNCERTAIN/);
  assert.match(recording, /STOP_STATUS_UNCERTAIN/);
  assert.match(recording, /reconciliationPending/);
  assert.match(recording, /action\?: "start" \| "stop" \| "reconcile"/);
  assert.match(recording, /idempotent: true/);
  assert.match(recording, /status: "starting"/);
  assert.match(recording, /status: "stopping"/);
  assert.doesNotMatch(recording, /started_at: new Date\(\)\.toISOString\(\)/);
});

test('S3-compatible RoomComposite Egress remains the recording backend', () => {
  assert.match(recording, /EncodedFileOutput/);
  assert.match(recording, /S3Upload/);
  assert.match(recording, /startRoomCompositeEgress/);
  assert.match(recording, /forcePathStyle: Boolean\(storageEndpoint\)/);
  assert.match(compose, /S3_ENDPOINT/);
  assert.match(compose, /S3_BUCKET/);
});

test('recording consent is server persisted and gates start recording', () => {
  assert.match(hardening, /create table if not exists public\.conference_recording_consents/);
  assert.match(hardening, /status in \('accepted','declined'\)/);
  assert.match(hardening, /recording_consent_required/);
  assert.match(hardening, /missing_consent_count/);
  assert.match(hardening, /START_RECORDING/);
  assert.match(hardening, /STOP_RECORDING/);
});

test('joining an already-recording SFU room is blocked without accepted consent', () => {
  assert.match(joinGate, /v_recording_active/);
  assert.match(joinGate, /conference_recording_consents/);
  assert.match(joinGate, /status='accepted'/);
  assert.match(joinGate, /reason','recording_consent_required'/);
  assert.match(roomHook, /RECORDING_CONSENT_REQUIRED/);
});

test('frontend exposes explicit consent before join and inside the room', () => {
  assert.match(page, /get_conference_recording_consent_state/);
  assert.match(page, /set_conference_recording_consent/);
  assert.match(page, /submitDisabled/);
  assert.match(page, /این جلسه هم‌اکنون در حال ضبط سروری است/);
  assert.match(consentHook, /setConferenceRecordingConsent/);
  assert.match(consentBanner, /رضایت برای ضبط جلسه/);
  assert.match(consentBanner, /موافقم/);
  assert.match(consentBanner, /موافق نیستم/);
});

test('host receives a visible error when participant consent is missing', () => {
  assert.match(moderation, /RECORDING_CONSENT_REQUIRED/);
  assert.match(moderation, /missingConsentCount/);
  assert.match(moderation, /رضایت/);
});

test('recording Edge Function and signed webhook remain deployment probes', () => {
  assert.match(manager, /livekit_function_unauthorized_probe conference-recording/);
  assert.match(manager, /livekit_function_unauthorized_probe livekit-webhook/);
});
