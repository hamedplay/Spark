import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const read = (path) => readFileSync(new URL(path, root), 'utf8');

test('Phase 25 removes only proven dead conference UI code', () => {
  assert.equal(
    existsSync(new URL(
      'src/components/VideoConference/Room/BreakoutPanel.tsx',
      root,
    )),
    false,
  );
});

test('Phase 25 preserves active LiveKit compatibility entrypoints', () => {
  const roomEntry = read(
    'src/features/video-conference/components/LiveKitConferenceRoom.tsx',
  );
  const toolsEntry = read(
    'src/features/video-conference/components/LiveKitConferenceTools.tsx',
  );
  const router = read(
    'src/components/VideoConference/ConferenceRoom.tsx',
  );
  const roomPage = read(
    'src/features/video-conference/components/room/ConferenceRoomPage.tsx',
  );

  assert.match(router, /LiveKitConferenceRoom/);
  assert.match(roomPage, /LiveKitConferenceTools/);
  assert.match(roomEntry, /ConferenceRoomPage/);
  assert.match(toolsEntry, /ConferenceTools/);
});

test('Phase 25 keeps the legacy mesh fallback while it remains a compatibility path', () => {
  const router = read(
    'src/components/VideoConference/ConferenceRoom.tsx',
  );

  assert.match(router, /media_topology === 'sfu'/);
  assert.match(router, /LegacyConferenceRoomView/);
  assert.match(router, /ConferenceRoomCore/);
});
