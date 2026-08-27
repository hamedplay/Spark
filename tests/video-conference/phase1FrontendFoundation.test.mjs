import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const roomEntry = read('src/features/video-conference/components/LiveKitConferenceRoom.tsx');
const toolsEntry = read('src/features/video-conference/components/LiveKitConferenceTools.tsx');
const roomPage = read('src/features/video-conference/components/room/ConferenceRoomPage.tsx');
const roomHook = read('src/features/video-conference/hooks/useLiveKitRoom.ts');
const api = read('src/features/video-conference/services/conferenceApi.ts');

test('keeps stable LiveKit conference entrypoints', () => {
  assert.match(roomEntry, /ConferenceRoomPage/);
  assert.match(toolsEntry, /ConferenceTools/);
});

test('keeps room page as composition instead of direct data access', () => {
  assert.doesNotMatch(roomPage, /\.from\(/);
  assert.doesNotMatch(roomPage, /functions\.invoke/);
  assert.match(roomPage, /useLiveKitRoom/);
  assert.match(roomPage, /useWaitingRoom/);
});

test('preserves backend contract names', () => {
  for (const contract of [
    'conference-livekit-token',
    'conference-host-control',
    'conference-recording',
    'create_meeting_livekit_conference',
    'admit_livekit_conference_participant',
    'set_livekit_raise_hand',
  ]) assert.match(api, new RegExp(contract));
});

test('installs LiveKit listeners before connecting', () => {
  const listener = roomHook.indexOf('RoomEvent.ParticipantConnected');
  const connect = roomHook.indexOf('await nextRoom.connect');
  assert.ok(listener >= 0 && connect >= 0 && listener < connect);
});

test('preserves reconnect and reaction event handling', () => {
  assert.match(roomHook, /RoomEvent\.Reconnecting/);
  assert.match(roomHook, /RoomEvent\.Reconnected/);
  assert.match(roomHook, /RoomEvent\.DataReceived/);
  assert.match(roomHook, /spark-reaction/);
});

test('compatibility entrypoints stay small', () => {
  assert.ok(roomEntry.split('\n').length < 50);
  assert.ok(toolsEntry.split('\n').length < 50);
});
