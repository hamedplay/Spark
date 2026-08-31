import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const migration = read(
  'supabase/migrations/20260831072246_video_conference_phase19_spotlight_pin.sql',
);
const types = read('src/features/video-conference/types/conference.types.ts');
const service = read(
  'src/features/video-conference/services/conferenceSpotlights.ts',
);
const hook = read(
  'src/features/video-conference/hooks/useConferenceSpotlights.ts',
);
const roomPage = read(
  'src/features/video-conference/components/room/ConferenceRoomPage.tsx',
);
const grid = read(
  'src/features/video-conference/components/participants/ParticipantGrid.tsx',
);
const tile = read(
  'src/features/video-conference/components/LiveKitParticipantTile.tsx',
);
const panel = read(
  'src/features/video-conference/components/participants/ConferenceParticipantsPanel.tsx',
);

test('Phase 19 keeps local pin and shared spotlight as separate state models', () => {
  assert.match(
    migration,
    /Phase 19 shared Host-controlled spotlight state\. Pin remains client-local/,
  );
  assert.match(
    migration,
    /Legacy mesh pin\/presenter state\. LiveKit Phase 19 pin is client-local/,
  );
  assert.match(roomPage, /useState<string \| null>\(null\)/);
  assert.match(roomPage, /pinnedIdentity/);
  assert.doesNotMatch(service, /pinned_user_id|set_conference_pinned_user/);
  assert.doesNotMatch(hook, /pinned_user_id|set_conference_pinned_user/);
});

test('shared spotlight has its own permission instead of reusing PIN_PARTICIPANT', () => {
  assert.match(migration, /SPOTLIGHT_PARTICIPANT/);
  assert.match(types, /'SPOTLIGHT_PARTICIPANT'/);
  assert.match(
    migration,
    /where r\.role in \('OWNER','HOST','CO_HOST','MODERATOR'\)/,
  );
  assert.match(
    migration,
    /private\.has_conference_permission\([\s\S]*'SPOTLIGHT_PARTICIPANT'/,
  );
});

test('spotlight table supports multiple simultaneous users in one room', () => {
  assert.match(migration, /create table if not exists public\.conference_spotlights/);
  assert.match(migration, /unique\(room_id,user_id\)/);
  assert.doesNotMatch(migration, /unique\(room_id\)\s*[;,]/);
  assert.match(migration, /order by s\.created_at,s\.id/);
});

test('spotlight table is authenticated read-only and protected by RLS', () => {
  assert.match(
    migration,
    /revoke all on table public\.conference_spotlights[\s\S]*from public,anon,authenticated/,
  );
  assert.match(
    migration,
    /grant select on table public\.conference_spotlights[\s\S]*to authenticated/,
  );
  assert.match(
    migration,
    /conference_spotlights_full_auth_boundary[\s\S]*as restrictive/,
  );
  assert.match(
    migration,
    /conference_spotlights_joined_select[\s\S]*can_read_conference_spotlight/,
  );
});

test('spotlight mutations are backend-authorized and idempotent', () => {
  assert.match(migration, /private\.manage_conference_spotlight/);
  assert.match(migration, /private\.is_current_session_fully_authorized/);
  assert.match(migration, /participant_not_found/);
  assert.match(migration, /on conflict\(room_id,user_id\) do nothing/);
  assert.match(migration, /v_action='add'/);
  assert.match(migration, /v_action='remove'/);
  assert.match(migration, /v_action='clear'/);
  assert.match(migration, /'idempotent',v_changed=0/);
});

test('spotlight changes are audited and stale rows are removed on participant leave', () => {
  assert.match(migration, /participant_spotlight_added/);
  assert.match(migration, /participant_spotlight_removed/);
  assert.match(migration, /participant_spotlights_cleared/);
  assert.match(migration, /cleanup_conference_spotlight_on_leave/);
  assert.match(migration, /after update of status/);
});

test('spotlight state is recovered and synchronized through Postgres Realtime', () => {
  assert.match(
    migration,
    /alter publication supabase_realtime[\s\S]*add table public\.conference_spotlights/,
  );
  assert.match(hook, /table: 'conference_spotlights'/);
  assert.match(hook, /event: '\*'/);
  assert.match(hook, /loadConferenceSpotlightSnapshot/);
  assert.match(service, /get_conference_spotlight_snapshot/);
});

test('host UI can spotlight any joined participant including itself', () => {
  assert.match(panel, /canSpotlight/);
  assert.match(panel, /onToggleSpotlight\(participant\.user_id\)/);
  assert.match(panel, /Spotlight برای همه شرکت‌کنندگان جلسه اعمال می‌شود/);
  assert.match(panel, /onClearSpotlights/);
  assert.match(panel, /Spotlight فعال/);
});

test('layout priority is screen share then shared spotlights then local pin or active speaker', () => {
  assert.match(
    grid,
    /participantFocusIdentity =[\s\S]*pinnedIdentity \|\| activeSpeakerIdentity/,
  );
  assert.match(grid, /spotlightFocusIdentity =[\s\S]*spotlightIdentities\[0\]/);
  assert.match(
    grid,
    /focusIdentity =[\s\S]*screenShareIdentity[\s\S]*\|\| spotlightFocusIdentity[\s\S]*\|\| participantFocusIdentity/,
  );
  assert.match(
    grid,
    /priorityIdentities =[\s\S]*screenShareIdentity[\s\S]*\.\.\.spotlightIdentities[\s\S]*participantFocusIdentity/,
  );
  assert.match(grid, /spotlightIdentities\.length > 0/);
});

test('all spotlighted tiles are visibly marked independently from local pin', () => {
  assert.match(grid, /spotlighted={spotlightIdentities\.includes/);
  assert.match(tile, /spotlighted = false/);
  assert.match(tile, /ring-amber-400/);
  assert.match(tile, />Spotlight</);
  assert.match(tile, /aria-pressed={pinned}/);
  assert.match(tile, /ring-sky-400/);
});

test('local pin has no database or realtime mutation path', () => {
  assert.doesNotMatch(grid, /\.rpc\(|functions\.invoke|postgres_changes/);
  assert.doesNotMatch(tile, /\.rpc\(|functions\.invoke|postgres_changes/);
  assert.match(grid, /onPinnedIdentityChange/);
  assert.match(roomPage, /setPinnedIdentity/);
});
