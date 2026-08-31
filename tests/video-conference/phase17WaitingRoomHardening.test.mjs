import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const hardening = read(
  'supabase/migrations/20260831063346_video_conference_phase17_waiting_room_hardening.sql',
);
const reservations = read(
  'supabase/migrations/20260831063936_video_conference_phase17_waiting_room_capacity_reservations.sql',
);
const api = read('src/features/video-conference/services/conferenceApi.ts');
const realtime = read('src/features/video-conference/services/conferenceRealtime.ts');
const hook = read('src/features/video-conference/hooks/useWaitingRoom.ts');
const list = read(
  'src/features/video-conference/components/waiting-room/WaitingRoomList.tsx',
);
const roomPage = read(
  'src/features/video-conference/components/room/ConferenceRoomPage.tsx',
);
const videoPage = read('src/components/VideoConference/VideoConferencePage.tsx');
const dbTypes = read('src/types/supabase.ts');

test('Phase 17 models all four waiting room states with expiry', () => {
  for (const status of ['waiting', 'admitted', 'rejected', 'expired']) {
    assert.match(hardening, new RegExp("'" + status + "'"));
  }
  assert.match(hardening, /expires_at timestamptz/);
  assert.match(hardening, /interval '5 minutes'/);
  assert.match(dbTypes, /'waiting' \| 'admitted' \| 'rejected' \| 'expired'/);
});

test('one authoritative waiting state exists per room and user', () => {
  assert.match(hardening, /unique\(room_id,user_id\)/i);
  assert.match(hardening, /conference_waiting_room_room_user_key/);
  assert.match(hardening, /on conflict\(room_id,user_id\) do nothing/);
});

test('browser waiting room mutations are routed through atomic RPCs', () => {
  assert.match(hardening, /revoke insert,update,delete,truncate,references,trigger[\s\S]*from anon,authenticated/i);
  assert.match(api, /admit_livekit_conference_participant/);
  assert.match(api, /admit_all_livekit_conference_participants/);
  assert.doesNotMatch(realtime, /from\('conference_waiting_room'\)/);
  assert.match(realtime, /get_livekit_waiting_room_snapshot/);
  assert.match(realtime, /get_livekit_waiting_room_state/);
});

test('single admission resolution is serialized and first decision wins', () => {
  assert.match(hardening, /from public\.conference_rooms[\s\S]*for update/);
  assert.match(hardening, /from public\.conference_waiting_room[\s\S]*for update/);
  assert.match(hardening, /where id=v_row\.id[\s\S]*and status='waiting'/);
  assert.match(hardening, /already_rejected/);
  assert.match(hardening, /already_admitted/);
  assert.match(hardening, /concurrent_resolution/);
  assert.match(hardening, /idempotent',true/);
});

test('admit all is capacity-aware and preserves request order', () => {
  assert.match(hardening, /admit_all_livekit_conference_participants/);
  assert.match(hardening, /least\(greatest\(v_room\.max_participants,1\),20\)/);
  assert.match(hardening, /v_joined\+v_reserved/);
  assert.match(hardening, /order by w\.requested_at,w\.id/);
  assert.match(hardening, /limit v_available/);
  assert.match(hardening, /remaining_waiting_count/);
});

test('admitted users own reserved capacity until they join', () => {
  assert.match(reservations, /v_reserved_count/);
  assert.match(reservations, /w\.status='admitted'/);
  assert.match(reservations, /w\.user_id<>v_uid/);
  assert.match(
    reservations,
    /v_joined_count\+v_reserved_count>=least\(v_room\.max_participants,20\)/,
  );
});

test('room lock blocks new SFU waiting requests but preserves existing queue decisions', () => {
  assert.match(
    hardening,
    /v_room\.is_locked and v_room\.host_id<>v_uid[\s\S]*v_waiting_status='admitted'/,
  );
  assert.match(hardening, /v_waiting_status='waiting'[\s\S]*waiting_for_admission/);
  assert.match(hardening, /else[\s\S]*room_locked/);
  assert.match(hardening, /MANAGE_WAITING_ROOM/);
});

test('participant waiting state survives missed realtime events through server polling', () => {
  assert.match(hook, /loadMyWaitingState/);
  assert.match(hook, /setInterval[\s\S]*refreshOwnState/);
  assert.match(hook, /status === 'admitted'/);
  assert.match(hook, /status === 'rejected'/);
  assert.match(hook, /status === 'expired'/);
  assert.match(roomPage, /onExpired: handleExpired/);
});

test('host UI exposes admit, reject, and admit all', () => {
  assert.match(list, /پذیرش همه/);
  assert.match(list, /پذیرش/);
  assert.match(list, /رد/);
  assert.match(list, /admitAllWaitingParticipants/);
  assert.match(list, /resolveWaitingParticipant/);
});

test('SFU bypasses legacy pending_approvals and uses LiveKit waiting room', () => {
  assert.match(
    videoPage,
    /room\.require_approval[\s\S]*room\.media_topology !== 'sfu'/,
  );
});

test('manager snapshots expose only active non-expired waiting rows', () => {
  assert.match(
    hardening,
    /where room_id=p_room_id[\s\S]*and status='waiting'[\s\S]*and expires_at>now\(\)/,
  );
});
