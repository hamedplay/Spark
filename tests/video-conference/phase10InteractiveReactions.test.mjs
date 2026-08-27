import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260827233555_video_conference_phase10_interactive_reactions.sql');
const edge = read('supabase/functions/conference-reaction/index.ts');
const media = read('src/features/video-conference/services/conferenceMedia.ts');
const roomHook = read('src/features/video-conference/hooks/useLiveKitRoom.ts');
const stateHook = read('src/features/video-conference/hooks/useConferenceState.ts');
const overlay = read('src/features/video-conference/components/reactions/ReactionOverlay.tsx');
const controls = read('src/features/video-conference/components/controls/RoomMediaControls.tsx');
const page = read('src/features/video-conference/components/room/ConferenceRoomPage.tsx');
const types = read('src/features/video-conference/types/conference.types.ts');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('Phase 10 keeps reaction events transient and persists only rate-limit state', () => {
  assert.match(migration, /create table if not exists private\.conference_reaction_rate_limits/);
  assert.doesNotMatch(migration, /insert into public\.conference_reactions/);
  assert.doesNotMatch(edge, /from\(['"]conference_reactions['"]\)/);
  assert.doesNotMatch(media, /from\(['"]conference_reactions['"]\)/);
});

test('reaction authorization derives authoritative participant identity name avatar and LiveKit room', () => {
  assert.match(migration, /get_conference_reaction_context/);
  assert.match(migration, /participant_identity/);
  assert.match(migration, /display_name/);
  assert.match(migration, /avatar_url/);
  assert.match(migration, /livekit_room_name/);
  assert.match(migration, /conference_participants/);
  assert.match(migration, /p\.status='joined'/);
  assert.match(migration, /allow_reactions/);
  assert.match(migration, /v_room\.status='ended'/);
});

test('reaction rate limit is atomic five-per-five-seconds and service-role only', () => {
  assert.match(migration, /v_window interval:=interval '5 seconds'/);
  assert.match(migration, /v_limit integer:=5/);
  assert.match(migration, /for update/);
  assert.match(migration, /reason','rate_limited'/);
  assert.match(migration, /retry_after_ms/);
  assert.match(migration, /consume_conference_reaction_rate_limit[\s\S]*from public,anon,authenticated/i);
  assert.match(migration, /consume_conference_reaction_rate_limit[\s\S]*to service_role/i);
});

test('edge creates the required server-authored reaction event shape', () => {
  for (const field of [
    'reaction',
    'participantIdentity',
    'displayName',
    'avatarUrl',
    'timestamp',
  ]) {
    assert.match(edge, new RegExp(`\\b${field}\\b`));
  }
  assert.match(edge, /crypto\.randomUUID\(\)/);
  assert.match(edge, /authorize_conference_reaction/);
  assert.match(edge, /consume_conference_reaction_rate_limit/);
  assert.match(edge, /get_my_auth_access_state/);
  assert.match(edge, /accessState\.access_level !== "FULL"/);
});

test('edge uses LiveKit RoomService SendData LOSSY on the spark-reaction topic', () => {
  assert.match(edge, /new RoomServiceClient/);
  assert.match(edge, /roomService\.sendData/);
  assert.match(edge, /payload,\s*1,\s*\{ topic: "spark-reaction" \}/);
  assert.match(edge, /payload\.byteLength > 1200/);
  assert.match(edge, /REACTION_DELIVERY_FAILED/);
});

test('only the curated interactive reaction set is accepted', () => {
  for (const reaction of ['👍', '❤️', '😂', '🎉', '👏', '😮']) {
    assert.match(edge, new RegExp(reaction));
    assert.match(controls, new RegExp(reaction));
  }
  assert.match(edge, /INVALID_REACTION/);
});

test('browser no longer publishes reaction DataPackets directly', () => {
  assert.doesNotMatch(media, /publishData/);
  assert.match(media, /functions\.invoke\('conference-reaction'/);
  assert.match(roomHook, /publishConferenceReaction\(client, roomId, reaction\)/);
});

test('receiver ignores participant-originated spark-reaction packets to prevent rate-limit bypass', () => {
  assert.match(roomHook, /topic !== 'spark-reaction'/);
  assert.match(roomHook, /if \(participant\) return/);
  assert.match(roomHook, /server-originated reaction packets/);
  assert.match(roomHook, /typeof value\.participantIdentity !== 'string'/);
  assert.match(roomHook, /typeof value\.displayName !== 'string'/);
  assert.match(roomHook, /typeof value\.timestamp !== 'string'/);
});

test('reaction state supports multiple simultaneous deduplicated expiring events', () => {
  assert.match(types, /interface ConferenceReactionEvent/);
  assert.match(stateHook, /useState<ConferenceReactionEvent\[\]>/);
  assert.match(stateHook, /current\.some\(\(item\) => item\.id === event\.id\)/);
  assert.match(stateHook, /\.slice\(-12\)/);
  assert.match(stateHook, /3200/);
  assert.match(page, /ReactionOverlay reactions=\{livekit\.reactions\}/);
});

test('reaction overlay shows emoji avatar participant name and simultaneous cards', () => {
  assert.match(overlay, /reactions\.map/);
  assert.match(overlay, /event\.avatarUrl/);
  assert.match(overlay, /event\.displayName/);
  assert.match(overlay, /event\.reaction/);
  assert.match(overlay, /animate-bounce/);
  assert.match(overlay, /aria-live="polite"/);
});

test('reaction picker exposes multiple emojis and a user-visible rate-limit error', () => {
  assert.match(controls, /REACTION_OPTIONS/);
  assert.match(controls, /reactionPickerOpen/);
  assert.match(controls, /onReaction\(reaction\)/);
  assert.match(controls, /reactionError/);
  assert.match(roomHook, /RATE_LIMITED/);
  assert.match(roomHook, /retryAfterMs/);
});

test('self-hosted validation probes the Phase 10 reaction edge function', () => {
  assert.match(manager, /livekit_function_unauthorized_probe conference-reaction/);
});
