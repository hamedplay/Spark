import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const subsystem = read('supabase/migrations/20260828083805_video_conference_phase13_presentation_subsystem.sql');
const presenceAcl = read('supabase/migrations/20260828084326_video_conference_phase13_presentation_presence_acl.sql');
const pathHardening = read('supabase/migrations/20260828084936_video_conference_phase13_presentation_storage_path_hardening.sql');
const edge = read('supabase/functions/conference-presentation-control/index.ts');
const service = read('src/features/video-conference/services/conferencePresentations.ts');
const hook = read('src/features/video-conference/hooks/useConferencePresentations.ts');
const viewer = read('src/features/video-conference/components/presentation/ConferencePresentationViewer.tsx');
const panel = read('src/features/video-conference/components/presentation/ConferencePresentationPanel.tsx');
const tools = read('src/features/video-conference/components/controls/ConferenceTools.tsx');
const toolsBar = read('src/features/video-conference/components/controls/ConferenceToolsBar.tsx');
const types = read('src/features/video-conference/types/conference.types.ts');
const screenShare = read('src/features/video-conference/hooks/useScreenShare.ts');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');
const readme = read('deploy/livekit/README.md');

test('Phase 13 persists presentation metadata, shared state and annotations', () => {
  assert.match(subsystem, /create table if not exists public\.conference_presentations/);
  assert.match(subsystem, /create table if not exists public\.conference_presentation_state/);
  assert.match(subsystem, /create table if not exists public\.conference_presentation_annotations/);
  assert.match(subsystem, /source_kind in\('PDF','IMAGE','SLIDES','DOCUMENT'\)/);
  assert.match(subsystem, /page_count/);
  assert.match(subsystem, /revision bigint/);
});

test('Phase 13 uses a private bounded object-storage bucket with RLS', () => {
  assert.match(subsystem, /conference-presentations/);
  assert.match(subsystem, /false,\s*52428800/);
  assert.match(subsystem, /application\/pdf/);
  assert.match(subsystem, /presentationml\.presentation/);
  assert.match(subsystem, /wordprocessingml\.document/);
  assert.match(subsystem, /Conference presentation assets read boundary/);
  assert.match(subsystem, /as restrictive/);
  assert.match(pathHardening, /private\.try_uuid/);
  assert.match(pathHardening, /can_write_conference_presentation_asset/);
  assert.match(service, /createSignedUrl/);
  assert.match(service, /upsert: false/);
});

test('presentation mutations are server-authorized and FULL-session gated', () => {
  assert.match(edge, /get_my_auth_access_state/);
  assert.match(edge, /accessState\.access_level !== "FULL"/);
  assert.match(edge, /authorize_conference_presentation_action/);
  assert.match(edge, /apply_conference_presentation_action/);
  assert.match(subsystem, /MANAGE_PRESENTATIONS/);
  assert.match(subsystem, /SHARE_FILE/);
  assert.match(subsystem, /USE_WHITEBOARD/);
  assert.match(types, /'MANAGE_PRESENTATIONS'/);
});

test('PDF images slides and documents use a self-hosted conversion path', () => {
  assert.match(edge, /PRESENTATION_CONVERTER_URL/);
  assert.match(edge, /\/forms\/libreoffice\/convert/);
  assert.match(edge, /downloadFrom/);
  assert.match(edge, /createSignedUrl\(input\.sourcePath, 300, \{ download: true \}\)/);
  assert.match(edge, /rendered\.pdf/);
  assert.match(readme, /self-hosted Gotenberg/);
});

test('presentation viewer supports navigation, zoom, fullscreen, laser and annotations', () => {
  assert.match(viewer, /onNavigate/);
  assert.match(viewer, /pageInput/);
  assert.match(viewer, /setZoom/);
  assert.match(viewer, /requestFullscreen/);
  assert.match(viewer, /mode === 'laser'/);
  assert.match(viewer, /mode === 'annotate'/);
  assert.match(viewer, /onPersistStroke/);
  assert.match(edge, /annotation_upsert/);
  assert.match(edge, /annotation_delete/);
  assert.match(edge, /annotation_clear/);
});

test('laser pointer is transient while shared state recovers from Realtime and reconnect', () => {
  assert.match(hook, /spark-presentation-laser/);
  assert.match(hook, /publishData/);
  assert.match(hook, /reliable: false/);
  assert.match(hook, /conference_presentations/);
  assert.match(hook, /conference_presentation_state/);
  assert.match(hook, /conference_presentation_annotations/);
  assert.match(hook, /RoomEvent\.Reconnected/);
  assert.match(presenceAcl, /annotatorUserIds/);
});

test('presentation UI is integrated without replacing screen share or whiteboard', () => {
  assert.match(types, /'presentation'/);
  assert.match(toolsBar, /togglePanel\('presentation'\)/);
  assert.match(tools, /ConferencePresentationPanel/);
  assert.match(tools, /ConferenceWhiteboardPanel/);
  assert.match(panel, /ConferencePresentationViewer/);
  assert.match(screenShare, /setConferenceScreenShare/);
  assert.match(screenShare, /toggleScreen/);
});

test('self-hosted manager probes the presentation Edge Function', () => {
  assert.match(manager, /livekit_function_unauthorized_probe conference-presentation-control/);
});
