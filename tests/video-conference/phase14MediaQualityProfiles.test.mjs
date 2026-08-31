import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const quality = read('src/features/video-conference/services/conferenceMediaQuality.ts');
const media = read('src/features/video-conference/services/conferenceMedia.ts');
const roomHook = read('src/features/video-conference/hooks/useLiveKitRoom.ts');
const qualityHook = read('src/features/video-conference/hooks/useConferenceMediaQuality.ts');
const grid = read('src/features/video-conference/components/participants/ParticipantGrid.tsx');
const tile = read('src/features/video-conference/components/LiveKitParticipantTile.tsx');
const devices = read('src/features/video-conference/components/controls/MediaDevicesPanel.tsx');
const roomPage = read('src/features/video-conference/components/room/ConferenceRoomPage.tsx');
const types = read('src/features/video-conference/types/conference.types.ts');
const server = read('deploy/livekit/livekit.yaml');

test('Phase 14 exposes all required media profiles and camera resolutions', () => {
  for (const profile of ['AUTO', 'DATA_SAVER', 'BALANCED', 'HIGH']) {
    assert.match(types, new RegExp(`'${profile}'`));
  }
  for (const resolution of ['180p', '360p', '540p', '720p', '1080p']) {
    assert.match(types, new RegExp(`'${resolution}'`));
  }
  assert.match(devices, /mediaProfile/);
  assert.match(devices, /cameraQuality/);
});

test('Room keeps adaptive stream, dynacast and simulcast enabled', () => {
  assert.match(quality, /adaptiveStream:/);
  assert.match(quality, /pixelDensity: 1/);
  assert.match(quality, /dynacast: true/);
  assert.match(quality, /simulcast: true/);
  assert.match(roomHook, /roomMediaOptions/);
  assert.doesNotMatch(roomHook, /width: 1920, height: 1080/);
});

test('camera profiles use LiveKit presets and a bounded simulcast ladder', () => {
  for (const preset of ['h180', 'h360', 'h540', 'h720', 'h1080']) {
    assert.match(quality, new RegExp(`VideoPresets\\.${preset}`));
  }
  assert.match(quality, /videoSimulcastLayers/);
  assert.match(media, /cameraCaptureOptions/);
  assert.match(media, /cameraPublishOptions/);
});

test('ordinary grid tiles are capped below high quality while focus can step up', () => {
  assert.match(quality, /gridQuality/);
  assert.match(quality, /VideoQuality\.MEDIUM/);
  assert.match(quality, /focusQuality/);
  assert.match(quality, /VideoQuality\.HIGH/);
  assert.match(quality, /participant\.identity === focusIdentity/);
  assert.match(grid, /pinnedIdentity \|\| activeSpeakerIdentity/);
  assert.match(tile, /featured/);
  assert.match(tile, /onTogglePin/);
  assert.match(roomPage, /focusIdentity/);
});

test('adaptive stream remains effective because remote video uses track.attach', () => {
  assert.match(tile, /track\.attach\(element\)/);
  assert.match(quality, /pauseVideoInBackground: true/);
});

test('screen share quality is independent from camera profile', () => {
  assert.match(types, /ConferenceScreenShareQuality/);
  assert.match(quality, /ScreenSharePresets\.h720fps15/);
  assert.match(quality, /ScreenSharePresets\.h1080fps15/);
  assert.match(quality, /Screen-share quality is controlled independently/);
  assert.match(media, /screenShareOptions/);
  assert.match(devices, /screenShareQuality/);
});

test('quality preference persists locally and can be changed without DB state', () => {
  assert.match(quality, /localStorage/);
  assert.match(qualityHook, /saveConferenceMediaQualitySettings/);
  assert.match(qualityHook, /setProfile/);
  assert.match(qualityHook, /setCameraQuality/);
  assert.match(qualityHook, /setScreenShareQuality/);
});

test('self-hosted server remains capped at 20 participants', () => {
  assert.match(server, /max_participants: 20/);
});
