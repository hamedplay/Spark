import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const collector = read('src/features/video-conference/services/conferenceDiagnostics.ts');
const hook = read('src/features/video-conference/hooks/useNetworkDiagnostics.ts');
const quality = read('src/features/video-conference/hooks/useNetworkQuality.ts');
const livekit = read('src/features/video-conference/hooks/useLiveKitRoom.ts');
const roomPage = read('src/features/video-conference/components/room/ConferenceRoomPage.tsx');
const tools = read('src/features/video-conference/components/controls/ConferenceTools.tsx');
const toolsBar = read('src/features/video-conference/components/controls/ConferenceToolsBar.tsx');
const panel = read('src/features/video-conference/components/diagnostics/NetworkDiagnosticsPanel.tsx');
const types = read('src/features/video-conference/types/conference.types.ts');

test('Phase 15 includes all required diagnostics metrics', () => {
  for (const field of [
    'connectionQuality',
    'rttMs',
    'packetLossPercent',
    'jitterMs',
    'bitrateKbps',
    'codecs',
    'resolution',
    'fps',
    'iceState',
    'candidateType',
    'turnInUse',
    'reconnectCount',
  ]) {
    assert.match(types, new RegExp(field));
  }
});

test('RTC stats use supported LiveKit track getRTCStatsReport instead of private room internals', () => {
  assert.match(collector, /getRTCStatsReport/);
  assert.match(collector, /currentBitrate/);
  assert.match(collector, /candidate-pair/);
  assert.match(collector, /selectedCandidatePairId/);
  assert.match(collector, /remote-inbound-rtp/);
  assert.match(collector, /inbound-rtp/);
  assert.doesNotMatch(collector, /room\.engine/);
  assert.doesNotMatch(collector, /peerConnectionManager/);
});

test('TURN usage is derived from relay candidates without exposing addresses', () => {
  assert.match(collector, /localCandidateType === 'relay'/);
  assert.match(collector, /remoteCandidateType === 'relay'/);
  assert.match(collector, /turnInUse: relay/);
  assert.doesNotMatch(panel, /candidateAddress/);
  assert.doesNotMatch(panel, /ipAddress/);
  assert.doesNotMatch(panel, /diagnostics\.sdp/i);
  assert.doesNotMatch(panel, /candidate\.address/i);
  assert.doesNotMatch(panel, /usernameFragment/i);
  assert.match(panel, /IP، candidate address، SDP، توکن‌ها و credentialهای TURN/);
});

test('normal user network status is exactly Excellent Good Weak Poor', () => {
  for (const label of ['Excellent', 'Good', 'Weak', 'Poor']) {
    assert.match(quality, new RegExp(`'${label}'`));
  }
  assert.match(roomPage, /networkLabel/);
});

test('advanced diagnostics are gated by an RBAC permission', () => {
  assert.match(tools, /hasConferencePermission\(authorization, 'MANAGE_ROLES'\)/);
  assert.match(tools, /NetworkDiagnosticsPanel/);
  assert.match(toolsBar, /canDiagnostics/);
  assert.match(toolsBar, /togglePanel\('diagnostics'\)/);
});

test('diagnostics sample continuously and support explicit refresh', () => {
  assert.match(hook, /setInterval\(\(\) => void refresh\(\), 2500\)/);
  assert.match(hook, /collectConferenceNetworkDiagnostics/);
  assert.match(panel, /onRefresh/);
});

test('reconnect count is tracked from LiveKit reconnect events', () => {
  assert.match(livekit, /setReconnectCount\(\(current\) => current \+ 1\)/);
  assert.match(livekit, /RoomEvent\.Reconnecting/);
  assert.match(roomPage, /livekit\.reconnectCount/);
});

test('advanced panel renders required metrics without sensitive network addresses', () => {
  for (const label of [
    'RTT',
    'Packet loss',
    'Jitter',
    'Bitrate',
    'Resolution',
    'FPS',
    'Codec',
    'ICE state',
    'Candidate',
    'TURN',
    'Reconnect',
  ]) {
    assert.match(panel, new RegExp(label));
  }
  assert.match(panel, /Media tracks/);
  assert.match(panel, /Local/);
  assert.match(panel, /Remote/);
  assert.doesNotMatch(panel, /localCandidate\.address/);
  assert.doesNotMatch(panel, /remoteCandidate\.address/);
});
