import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const tokenEdge = read('supabase/functions/conference-livekit-token/index.ts');
const hostEdge = read('supabase/functions/conference-host-control/index.ts');
const authService = read('src/features/video-conference/services/conferenceAuthorization.ts');
const conferenceApi = read('src/features/video-conference/services/conferenceApi.ts');
const liveKitHook = read('src/features/video-conference/hooks/useLiveKitRoom.ts');
const policyMigration = read('supabase/migrations/20260827202146_video_conference_phase3_livekit_permission_policy.sql');
const mutationMigration = read('supabase/migrations/20260827202503_video_conference_phase3_edge_role_mutation.sql');
const edgeOnlyMigration = read('supabase/migrations/20260827203136_video_conference_phase3_role_rpc_edge_only.sql');

test('token issuance reads LiveKit media policy from PostgreSQL', () => {
  assert.match(tokenEdge, /get_my_livekit_conference_policy/);
  assert.match(tokenEdge, /canPublish:\s*livekitPolicy\.canPublish/);
  assert.match(tokenEdge, /canSubscribe:\s*livekitPolicy\.canSubscribe/);
  assert.match(tokenEdge, /canPublishData:\s*livekitPolicy\.canPublishData/);
  assert.match(tokenEdge, /canPublishSources:\s*livekitPolicy\.publishSources/);
  assert.doesNotMatch(tokenEdge, /canPublish:\s*true/);
  assert.doesNotMatch(tokenEdge, /canSubscribe:\s*true/);
  assert.doesNotMatch(tokenEdge, /canPublishData:\s*true/);
});

test('business publish permissions map to exact LiveKit track sources', () => {
  assert.match(policyMigration, /'PUBLISH_CAMERA'=any\(v_permissions\)/);
  assert.match(policyMigration, /jsonb_build_array\('camera'\)/);
  assert.match(policyMigration, /'PUBLISH_MIC'=any\(v_permissions\)/);
  assert.match(policyMigration, /jsonb_build_array\('microphone'\)/);
  assert.match(policyMigration, /'PUBLISH_SCREEN'=any\(v_permissions\)/);
  assert.match(policyMigration, /jsonb_build_array\('screen_share','screen_share_audio'\)/);
  assert.match(policyMigration, /'SUBSCRIBE_MEDIA'=any\(v_permissions\)/);
});

test('role mutation is routed through host-control instead of direct browser RPC', () => {
  assert.match(authService, /functions\.invoke\('conference-host-control'/);
  assert.match(authService, /action:\s*'set-role'/);
  assert.doesNotMatch(authService, /rpc\('set_conference_participant_role'/);
});

test('host-control updates LiveKit participant permissions from DB response', () => {
  assert.match(hostEdge, /action === "set-role"/);
  assert.match(hostEdge, /apply_livekit_conference_participant_role/);
  assert.match(hostEdge, /data\.livekit_policy/);
  assert.match(hostEdge, /roomService\.updateParticipant/);
  assert.match(hostEdge, /canPublishSources:\s*policy\.publishSources/);
  assert.doesNotMatch(hostEdge, /permission:\s*\{\s*canPublish:\s*true/);
});

test('service-only role mutation RPC is present and set-role authorization requires MANAGE_ROLES', () => {
  assert.match(mutationMigration, /apply_livekit_conference_participant_role/);
  assert.match(mutationMigration, /to service_role/i);
  assert.match(mutationMigration, /when 'set-role' then 'MANAGE_ROLES'/);
});

test('client does not publish preflight microphone or camera when token forbids the source', () => {
  assert.match(conferenceApi, /publishSources:\s*LiveKitPublishSource\[\]/);
  assert.match(liveKitHook, /publishSources\.includes\('microphone'\)/);
  assert.match(liveKitHook, /publishSources\.includes\('camera'\)/);
  assert.match(liveKitHook, /if \(micEnabled && canPublishMic\)/);
  assert.match(liveKitHook, /if \(cameraEnabled && canPublishCamera\)/);
});

test('client reacts to runtime participant permission changes', () => {
  assert.match(liveKitHook, /RoomEvent\.ParticipantPermissionsChanged/);
  assert.match(liveKitHook, /localParticipant\.isMicrophoneEnabled/);
  assert.match(liveKitHook, /localParticipant\.isCameraEnabled/);
});


test('direct authenticated role mutation is disabled so LiveKit sync cannot be bypassed', () => {
  assert.match(edgeOnlyMigration, /public\.set_conference_participant_role\(uuid,uuid,text\)[\s\S]*from authenticated/i);
  assert.match(edgeOnlyMigration, /private\.set_conference_participant_role\(uuid,uuid,text\)[\s\S]*from authenticated/i);
  assert.match(edgeOnlyMigration, /to service_role/i);
});


test('self-hosted join tokens use a short replay window', () => {
  assert.match(tokenEdge, /TOKEN_TTL_SECONDS\s*=\s*120/);
  assert.match(tokenEdge, /ttl:\s*TOKEN_TTL_SECONDS/);
  assert.match(tokenEdge, /expiresInSeconds:\s*TOKEN_TTL_SECONDS/);
});
