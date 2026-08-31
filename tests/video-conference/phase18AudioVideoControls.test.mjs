import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const migration = read(
  'supabase/migrations/20260831065126_video_conference_phase18_media_permission_hardening.sql',
);
const hostEdge = read('supabase/functions/conference-host-control/index.ts');
const liveKitHook = read('src/features/video-conference/hooks/useLiveKitRoom.ts');
const screenHook = read('src/features/video-conference/hooks/useScreenShare.ts');
const devicesHook = read('src/features/video-conference/hooks/useMediaDevices.ts');
const devicesPanel = read(
  'src/features/video-conference/components/controls/MediaDevicesPanel.tsx',
);
const mediaControls = read(
  'src/features/video-conference/components/controls/RoomMediaControls.tsx',
);
const participantPanel = read(
  'src/features/video-conference/components/participants/ConferenceParticipantsPanel.tsx',
);
const participantGrid = read(
  'src/features/video-conference/components/participants/ParticipantGrid.tsx',
);
const participantTile = read(
  'src/features/video-conference/components/LiveKitParticipantTile.tsx',
);
const roomPage = read(
  'src/features/video-conference/components/room/ConferenceRoomPage.tsx',
);

test('Phase 18 persists source-specific publish restrictions in PostgreSQL', () => {
  assert.match(migration, /mic_publishing_disabled boolean not null default false/);
  assert.match(migration, /camera_publishing_disabled boolean not null default false/);
  assert.match(migration, /screen_publishing_disabled boolean not null default false/);
  assert.match(migration, /set_livekit_participant_media_permission/);
});

test('LiveKit token policy removes disabled sources across reconnects', () => {
  assert.match(
    migration,
    /'PUBLISH_MIC'=any\(v_permissions\) and not v_mic_disabled/,
  );
  assert.match(
    migration,
    /'PUBLISH_CAMERA'=any\(v_permissions\) and not v_camera_disabled/,
  );
  assert.match(
    migration,
    /v_allow_screen_share[\s\S]*not v_screen_disabled[\s\S]*'PUBLISH_SCREEN'=any\(v_permissions\)/,
  );
  assert.match(migration, /'media_restrictions'/);
});

test('mute current track and revoke publish permission remain separate host actions', () => {
  assert.match(hostEdge, /body\.action === "mute"/);
  assert.match(hostEdge, /track\.source === TrackSource\.MICROPHONE/);
  assert.match(hostEdge, /mutePublishedTrack/);
  assert.match(hostEdge, /mode: "current_microphone_track"/);

  for (const action of [
    'disable-mic',
    'enable-mic',
    'disable-camera',
    'enable-camera',
    'disable-screen',
    'enable-screen',
  ]) {
    assert.match(hostEdge, new RegExp('"' + action + '"'));
  }

  assert.match(hostEdge, /set_livekit_participant_media_permission/);
  assert.match(hostEdge, /roomService\.updateParticipant/);
  assert.match(hostEdge, /mode: "publish_permission"/);
});

test('host media revocation is permission-gated for each source', () => {
  assert.match(migration, /when 'disable-mic' then 'DISABLE_MIC'/);
  assert.match(migration, /when 'enable-mic' then 'DISABLE_MIC'/);
  assert.match(migration, /when 'disable-camera' then 'DISABLE_CAMERA'/);
  assert.match(migration, /when 'enable-camera' then 'DISABLE_CAMERA'/);
  assert.match(migration, /when 'disable-screen' then 'DISABLE_SCREEN'/);
  assert.match(migration, /when 'enable-screen' then 'DISABLE_SCREEN'/);
  assert.match(migration, /OWNER','HOST','CO_HOST','MODERATOR/);
});

test('participant panel exposes mute current track separately from publish restrictions', () => {
  assert.match(participantPanel, /Mute فعلی/);
  assert.match(participantPanel, /disable-mic/);
  assert.match(participantPanel, /enable-mic/);
  assert.match(participantPanel, /disable-camera/);
  assert.match(participantPanel, /enable-camera/);
  assert.match(participantPanel, /disable-screen/);
  assert.match(participantPanel, /enable-screen/);
  assert.match(participantPanel, /میکروفون ممنوع/);
  assert.match(participantPanel, /دوربین ممنوع/);
  assert.match(participantPanel, /اشتراک صفحه ممنوع/);
});

test('participant runtime reacts immediately to LiveKit permission updates', () => {
  assert.match(liveKitHook, /RoomEvent\.ParticipantPermissionsChanged/);
  assert.match(liveKitHook, /Track\.Source\.Microphone/);
  assert.match(liveKitHook, /Track\.Source\.Camera/);
  assert.match(liveKitHook, /Track\.Source\.ScreenShare/);
  assert.match(liveKitHook, /setCanPublishMic/);
  assert.match(liveKitHook, /setCanPublishCamera/);
  assert.match(liveKitHook, /setCanPublishScreen/);
  assert.match(roomPage, /livekit\.canPublishMic/);
  assert.match(roomPage, /livekit\.canPublishCamera/);
  assert.match(roomPage, /livekit\.canPublishScreen/);
});

test('device routing initializes and follows actual LiveKit active devices', () => {
  assert.match(devicesHook, /room\.getActiveDevice\('audioinput'\)/);
  assert.match(devicesHook, /room\.getActiveDevice\('videoinput'\)/);
  assert.match(devicesHook, /room\.getActiveDevice\('audiooutput'\)/);
  assert.match(devicesHook, /RoomEvent\.ActiveDeviceChanged/);
  assert.match(devicesHook, /room\.switchActiveDevice/);
  assert.match(devicesHook, /supportsAudioOutputSelection/);
  assert.match(devicesHook, /switchCamera/);
  assert.match(devicesPanel, /تعویض دوربین/);
  assert.match(devicesPanel, /این مرورگر پشتیبانی نمی‌شود/);
});

test('screen share lifecycle follows LiveKit publications and browser-native stop', () => {
  assert.match(screenHook, /Track\.Source\.ScreenShare/);
  assert.match(screenHook, /RoomEvent\.LocalTrackPublished/);
  assert.match(screenHook, /RoomEvent\.LocalTrackUnpublished/);
  assert.match(screenHook, /RoomEvent\.ParticipantPermissionsChanged/);
  assert.match(mediaControls, /توقف اشتراک صفحه/);
  assert.doesNotMatch(mediaControls, /hidden h-12 w-12/);
});

test('speaker mute is local-only and does not alter room or participant DB state', () => {
  assert.match(mediaControls, /speakerMuted/);
  assert.match(mediaControls, /onToggleSpeaker/);
  assert.match(participantTile, /muted={speakerMuted}/);
  assert.match(roomPage, /setSpeakerMuted/);
  assert.doesNotMatch(mediaControls, /functions\.invoke|\.rpc\(/);
});

test('participant tile provides fullscreen, picture-in-picture and zoom', () => {
  assert.match(participantTile, /requestFullscreen/);
  assert.match(participantTile, /requestPictureInPicture/);
  assert.match(participantTile, /exitPictureInPicture/);
  assert.match(participantTile, /Math\.max\(1, value - 0\.25\)/);
  assert.match(participantTile, /Math\.min\(2, value \+ 0\.25\)/);
});

test('pin remains local while grid and speaker views are independent local layouts', () => {
  assert.match(participantGrid, /layoutMode === 'speaker'/);
  assert.match(roomPage, /setLayoutMode\('grid'\)/);
  assert.match(roomPage, /setLayoutMode\('speaker'\)/);
  assert.match(participantTile, /onTogglePin/);
  assert.match(participantTile, /aria-pressed={pinned}/);
  assert.doesNotMatch(participantTile, /functions\.invoke|\.rpc\(/);
});

test('active screen share gets display priority without hiding all other participants', () => {
  assert.match(
    participantGrid,
    /participantFocusIdentity =[\s\S]*pinnedIdentity \|\| activeSpeakerIdentity/,
  );
  assert.match(
    participantGrid,
    /focusIdentity =[\s\S]*screenShareIdentity[\s\S]*\|\| participantFocusIdentity/,
  );
  assert.match(participantGrid, /preferScreenShare/);
  assert.match(participantTile, /Track\.Source\.ScreenShare/);
  assert.match(participantTile, /Track\.Source\.ScreenShareAudio/);
  assert.match(participantTile, /object-contain bg-black/);
  assert.match(
    roomPage,
    /screenShareIdentity[\s\S]*layoutMode === 'speaker'/,
  );
});
