import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260828065022_video_conference_phase12_collaborative_whiteboard.sql');
const realtime = read('supabase/migrations/20260828065838_video_conference_phase12_whiteboard_realtime_hardening.sql');
const edge = read('supabase/functions/conference-whiteboard-control/index.ts');
const service = read('src/features/video-conference/services/conferenceWhiteboard.ts');
const state = read('src/features/video-conference/utils/conferenceWhiteboardState.ts');
const geometry = read('src/features/video-conference/utils/conferenceWhiteboardGeometry.ts');
const hook = read('src/features/video-conference/hooks/useConferenceWhiteboard.ts');
const canvas = read('src/features/video-conference/components/whiteboard/ConferenceWhiteboardCanvas.tsx');
const toolbar = read('src/features/video-conference/components/whiteboard/ConferenceWhiteboardToolbar.tsx');
const panel = read('src/features/video-conference/components/whiteboard/ConferenceWhiteboardPanel.tsx');
const tools = read('src/features/video-conference/components/controls/ConferenceTools.tsx');
const toolsBar = read('src/features/video-conference/components/controls/ConferenceToolsBar.tsx');
const types = read('src/features/video-conference/types/conference.types.ts');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');
const pkg = JSON.parse(read('package.json'));

test('Phase 12 introduces separate revisioned SFU whiteboard state without rewriting legacy strokes', () => {
  assert.match(migration, /create table if not exists public\.conference_whiteboard_boards/);
  assert.match(migration, /create table if not exists public\.conference_whiteboard_pages/);
  assert.match(migration, /create table if not exists public\.conference_whiteboard_snapshots/);
  assert.match(migration, /snapshot_data jsonb/);
  assert.match(migration, /revision bigint/);
  assert.doesNotMatch(migration, /drop table[^;]*conference_whiteboard\b/i);
  assert.doesNotMatch(migration, /alter table public\.conference_whiteboard\b/i);
});

test('whiteboard snapshots are bounded and checkpointed for reconnect recovery', () => {
  assert.match(migration, /jsonb_array_length\(v_elements\)>=1000/);
  assert.match(migration, /octet_length\(v_elements::text\)>4000000/);
  assert.match(migration, /jsonb_array_length\(v_points\)>2000/);
  assert.match(migration, /v_new_revision%10=0/);
  assert.match(migration, /conference_whiteboard_snapshots_page_revision_key/);
  assert.match(hook, /RoomEvent\.Reconnected/);
  assert.match(hook, /refreshSnapshot/);
});

test('persistent mutations are server-authorized and direct browser table mutation is closed', () => {
  for (const table of [
    'conference_whiteboard_boards',
    'conference_whiteboard_pages',
    'conference_whiteboard_snapshots',
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table}[\\s\\S]*from public,anon,authenticated`),
    );
  }
  assert.match(migration, /apply_conference_whiteboard_action_v2[\s\S]*from public,anon,authenticated/i);
  assert.match(migration, /apply_conference_whiteboard_action_v2[\s\S]*to service_role/i);
  assert.match(edge, /get_my_auth_access_state/);
  assert.match(edge, /accessState\.access_level !== "FULL"/);
  assert.match(edge, /authorize_conference_whiteboard_action_v2/);
  assert.match(edge, /apply_conference_whiteboard_action_v2/);
});

test('whiteboard permissions enforce USE, MANAGE and board lock server-side', () => {
  assert.match(migration, /USE_WHITEBOARD/);
  assert.match(migration, /MANAGE_WHITEBOARD/);
  assert.match(migration, /board_locked/);
  assert.match(migration, /'add_page','delete_page','rename_page','lock','unlock','clear_page'/);
  assert.match(migration, /'upsert_element','delete_element'/);
  assert.match(panel, /whiteboard\.canEdit/);
  assert.match(panel, /whiteboard\.canManage/);
});

test('all required persistent drawing tools are represented by the element model', () => {
  for (const value of [
    'pen',
    'marker',
    'line',
    'arrow',
    'rectangle',
    'circle',
    'text',
    'sticky',
    'image',
  ]) {
    assert.match(types, new RegExp(`'${value}'`));
  }
  assert.match(types, /'eraser'/);
  assert.match(types, /'laser'/);
  assert.match(types, /'pan'/);
  assert.match(geometry, /renderConferenceWhiteboardElement/);
  assert.match(geometry, /hitTestConferenceWhiteboardElement/);
});

test('whiteboard supports undo redo zoom pan and multi-page management', () => {
  assert.match(hook, /const undo = useCallback/);
  assert.match(hook, /const redo = useCallback/);
  assert.match(toolbar, /Undo2/);
  assert.match(toolbar, /Redo2/);
  assert.match(toolbar, /ZoomIn/);
  assert.match(toolbar, /ZoomOut/);
  assert.match(toolbar, /onResetView/);
  assert.match(toolbar, /onAddPage/);
  assert.match(toolbar, /onDeletePage/);
  assert.match(toolbar, /onRenamePage/);
  assert.match(migration, /v_page_count>=20/);
  assert.match(canvas, /tool === 'pan'/);
  assert.match(canvas, /0\.25/);
  assert.match(canvas, /Math\.min\(4/);
});

test('cursors participant names and laser pointers stay transient over LiveKit', () => {
  assert.match(hook, /spark-whiteboard-presence/);
  assert.match(hook, /publishData/);
  assert.match(hook, /reliable: false/);
  assert.match(hook, /participant\.identity/);
  assert.match(hook, /participant\.name/);
  assert.match(hook, /laser: Boolean\(value\.laser\)/);
  assert.match(canvas, /item\.displayName/);
  assert.match(canvas, /item\.laser/);
  assert.doesNotMatch(migration, /conference_whiteboard_presence/);
});

test('committed operations are Reliable server-originated LiveKit packets', () => {
  assert.match(edge, /roomService\.sendData/);
  assert.match(edge, /payload,\s*0,\s*\{ topic: "spark-whiteboard-op" \}/);
  assert.match(edge, /WHITEBOARD_BROADCAST_FAILED/);
  assert.match(edge, /persisted: true/);
  assert.match(hook, /topic === 'spark-whiteboard-op'/);
  assert.match(hook, /if \(participant\) return/);
  assert.match(hook, /seenOperationsRef/);
});

test('Postgres Realtime is fallback recovery for board and page snapshot changes', () => {
  assert.match(realtime, /conference_whiteboard_boards/);
  assert.match(realtime, /conference_whiteboard_pages/);
  assert.match(realtime, /alter publication supabase_realtime/);
  assert.match(hook, /table: 'conference_whiteboard_pages'/);
  assert.match(hook, /table: 'conference_whiteboard_boards'/);
  assert.match(hook, /scheduleRefresh/);
});

test('image elements use a private scoped object-storage bucket and signed URLs', () => {
  assert.match(migration, /conference-whiteboard-assets/);
  assert.match(migration, /false,\s*5242880/);
  for (const mime of ['image/jpeg', 'image/png', 'image/webp', 'image/gif']) {
    assert.match(migration, new RegExp(mime.replace('/', '\\/')));
  }
  assert.match(migration, /can_read_conference_whiteboard_asset/);
  assert.match(migration, /can_write_conference_whiteboard_asset/);
  assert.match(service, /createSignedUrl/);
  assert.match(service, /upsert: false/);
  assert.match(service, /5 \* 1024 \* 1024/);
  assert.match(service, /roomId,\s*pageId,\s*userId/);
  assert.match(migration, /v_asset_path not like[\s\S]*p_room_id::text[\s\S]*v_page\.id::text/);
});

test('element payload is server-sanitized and bounded against render abuse', () => {
  assert.match(migration, /octet_length\(v_element::text\)>150000/);
  assert.match(migration, /char_length\(v_element_id\)>80/);
  assert.match(migration, /v_color!~'\^#\[0-9a-f\]\{6\}\$'/);
  assert.match(migration, /v_width<1 or v_width>40/);
  assert.match(migration, /char_length\(v_text\)>1000/);
  assert.match(migration, /abs\(\(pt->>'x'\)::numeric\)>1000000/);
  assert.match(migration, /jsonb_strip_nulls\(jsonb_build_object/);
});

test('SFU whiteboard panel is wired without replacing the legacy mesh Whiteboard', () => {
  assert.match(types, /'whiteboard'/);
  assert.match(toolsBar, /togglePanel\('whiteboard'\)/);
  assert.match(tools, /ConferenceWhiteboardPanel/);
  assert.match(tools, /panel === 'whiteboard'/);

  const legacy = read('src/components/VideoConference/Whiteboard.tsx');
  assert.match(legacy, /export function Whiteboard/);
  assert.match(legacy, /conference_whiteboard/);
});

test('Phase 12 adds no external whiteboard SDK dependency', () => {
  const deps = {
    ...(pkg.dependencies || {}),
    ...(pkg.devDependencies || {}),
  };
  assert.equal(deps.tldraw, undefined);
  assert.equal(deps['@excalidraw/excalidraw'], undefined);
  assert.equal(deps.yjs, undefined);
});

test('self-hosted manager probes the whiteboard Edge Function', () => {
  assert.match(manager, /livekit_function_unauthorized_probe conference-whiteboard-control/);
});
