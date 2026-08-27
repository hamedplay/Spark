import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const types = read('src/features/video-conference/types/conference.types.ts');
const roomPage = read('src/features/video-conference/components/room/ConferenceRoomPage.tsx');
const toolsBar = read('src/features/video-conference/components/controls/ConferenceToolsBar.tsx');
const moderation = read('src/features/video-conference/hooks/useConferenceModeration.ts');
const authorization = read('src/features/video-conference/services/conferenceAuthorization.ts');
const realtime = read('src/features/video-conference/services/conferenceRealtime.ts');
const hostEdge = read('supabase/functions/conference-host-control/index.ts');
const recordingEdge = read('supabase/functions/conference-recording/index.ts');
const rbacMigration = read('supabase/migrations/20260827195314_video_conference_phase2_rbac.sql');
const aclMigration = read('supabase/migrations/20260827195844_video_conference_phase2_rbac_acl_hardening.sql');
const policyMigration = read('supabase/migrations/20260827200114_video_conference_phase2_rbac_policy_completion.sql');

test('defines the seven canonical conference roles', () => {
  for (const role of ['OWNER','HOST','CO_HOST','MODERATOR','PRESENTER','PARTICIPANT','VIEWER']) {
    assert.match(types, new RegExp(`['"]${role}['"]`));
  }
});

test('defines an independent permission catalogue', () => {
  for (const permission of [
    'JOIN_ROOM','PUBLISH_MIC','PUBLISH_CAMERA','PUBLISH_SCREEN','SUBSCRIBE_MEDIA',
    'SEND_CHAT','SEND_PRIVATE_CHAT','DELETE_CHAT','CREATE_POLL','VOTE_POLL',
    'USE_WHITEBOARD','MANAGE_WHITEBOARD','SHARE_FILE','START_RECORDING',
    'STOP_RECORDING','MUTE_OTHERS','DISABLE_MIC','DISABLE_CAMERA',
    'REMOVE_PARTICIPANT','LOCK_ROOM','MANAGE_ROLES','MANAGE_TIMER',
    'START_BREAK','END_MEETING',
  ]) assert.match(types, new RegExp(`['"]${permission}['"]`));
});

test('frontend management affordances are permission-driven instead of legacy role-driven', () => {
  assert.match(roomPage, /hasConferencePermission\(authorization, 'MANAGE_WAITING_ROOM'\)/);
  assert.match(roomPage, /hasConferencePermission\(authorization, 'PUBLISH_MIC'\)/);
  assert.match(moderation, /hasConferencePermission\(authorization, 'MUTE_OTHERS'\)/);
  assert.match(moderation, /hasConferencePermission\(authorization, 'MANAGE_ROLES'\)/);
  assert.doesNotMatch(roomPage, /role\s*===\s*['"]host['"]/);
  assert.doesNotMatch(toolsBar, /role\s*===/);
});

test('frontend reads canonical authorization and participant roles from server boundaries', () => {
  assert.match(authorization, /get_my_conference_authorization/);
  assert.match(authorization, /conference-host-control/);
  assert.match(authorization, /action:\s*'set-role'/);
  assert.match(realtime, /get_conference_participants_rbac/);
});

test('edge functions authorize the concrete requested action', () => {
  assert.match(hostEdge, /authorize_livekit_host_action/);
  assert.match(hostEdge, /p_action:\s*body\.action/);
  assert.doesNotMatch(hostEdge, /HOST_ONLY/);
  assert.match(recordingEdge, /authorize_livekit_recording/);
  assert.match(recordingEdge, /p_action:\s*body\.action/);
});

test('database migration keeps RBAC catalog private and public RPCs invoker-safe', () => {
  assert.match(rbacMigration, /private\.conference_rbac_roles/);
  assert.match(rbacMigration, /private\.conference_role_permissions/);
  assert.match(rbacMigration, /private\.conference_role_assignments/);
  assert.match(rbacMigration, /private\.has_conference_permission/);
  assert.match(rbacMigration, /get_my_conference_authorization/);
  assert.match(rbacMigration, /security invoker/i);
  assert.match(rbacMigration, /SEND_CHAT/);
  assert.match(rbacMigration, /MANAGE_WAITING_ROOM/);
});

test('acl hardening disables generic LiveKit authorization overloads for authenticated clients', () => {
  assert.match(aclMigration, /revoke execute on function public\.authorize_livekit_host_action\(uuid,uuid\) from public,anon,authenticated/i);
  assert.match(aclMigration, /revoke execute on function public\.authorize_livekit_recording\(uuid\) from public,anon,authenticated/i);
  assert.match(aclMigration, /private\.join_conference_authenticated/);
  assert.match(aclMigration, /JOIN_ROOM/);
});

test('screen presenter and whiteboard write paths use permissions', () => {
  assert.match(policyMigration, /PUBLISH_SCREEN/);
  assert.match(policyMigration, /USE_WHITEBOARD/);
});
