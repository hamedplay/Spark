import assert from 'node:assert/strict';
import {
  readdirSync,
  readFileSync,
  statSync,
} from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const migration = read(
  'supabase/migrations/20260831082418_video_conference_phase21_token_reissue_guard.sql',
);
const tokenEdge = read(
  'supabase/functions/conference-livekit-token/index.ts',
);
const conferenceApi = read(
  'src/features/video-conference/services/conferenceApi.ts',
);
const reconnectPolicy = read(
  'src/features/video-conference/services/conferenceTokenSecurity.ts',
);
const liveKitHook = read(
  'src/features/video-conference/hooks/useLiveKitRoom.ts',
);

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.isFile()) return [];
    return /\.(?:ts|tsx|js|jsx)$/.test(entry.name) ? [path] : [];
  });
}

test('Phase 21 token endpoint accepts only room identity input from the client', () => {
  assert.match(tokenEdge, /let body: \{ roomId\?: string \}/);
  assert.match(tokenEdge, /identity: authUser\.id/);
  assert.doesNotMatch(tokenEdge, /body\.identity/);
  assert.doesNotMatch(tokenEdge, /body\.role/);
  assert.doesNotMatch(tokenEdge, /body\.canPublish/);
  assert.doesNotMatch(tokenEdge, /body\.canSubscribe/);
});

test('LiveKit access token remains short-lived, room-scoped and DB-permission-derived', () => {
  assert.match(tokenEdge, /TOKEN_TTL_SECONDS\s*=\s*120/);
  assert.match(tokenEdge, /ttl:\s*TOKEN_TTL_SECONDS/);
  assert.match(tokenEdge, /roomJoin:\s*true/);
  assert.match(tokenEdge, /room:\s*roomName/);
  assert.match(tokenEdge, /roomAdmin:\s*false/);
  assert.match(tokenEdge, /get_my_livekit_conference_policy/);
  assert.match(tokenEdge, /canPublish:\s*livekitPolicy\.canPublish/);
  assert.match(tokenEdge, /canSubscribe:\s*livekitPolicy\.canSubscribe/);
  assert.match(tokenEdge, /canPublishData:\s*livekitPolicy\.canPublishData/);
  assert.match(tokenEdge, /canPublishSources:\s*livekitPolicy\.publishSources/);
});

test('token response is explicitly non-cacheable', () => {
  assert.match(tokenEdge, /Cache-Control": "no-store, max-age=0"/);
  assert.match(tokenEdge, /Pragma": "no-cache"/);
  assert.match(tokenEdge, /X-Content-Type-Options": "nosniff"/);
});

test('fresh token issuance is blocked briefly after moderator removal', () => {
  assert.match(
    migration,
    /livekit_rejoin_blocked_until timestamptz/,
  );
  assert.match(
    migration,
    /clock_timestamp\(\)\+interval '2 minutes'/,
  );
  assert.match(
    migration,
    /p_action='kick'[\s\S]*livekit_rejoin_blocked_until/,
  );
  assert.match(
    migration,
    /reason','rejoin_blocked'/,
  );
  assert.match(
    migration,
    /retry_after_seconds/,
  );
  assert.match(
    migration,
    /prepare_livekit_conference_join_phase21/,
  );
});

test('rejoin cooldown remains server-authoritative', () => {
  assert.match(
    migration,
    /new\.livekit_rejoin_blocked_until is distinct from old\.livekit_rejoin_blocked_until/,
  );
  assert.match(
    migration,
    /revoke all on function public\.prepare_livekit_conference_join\(uuid\)[\s\S]*from public,anon/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.prepare_livekit_conference_join\(uuid\)[\s\S]*to authenticated,service_role/i,
  );
});

test('token endpoint surfaces the server rejoin cooldown without minting a token', () => {
  assert.match(tokenEdge, /retryAfterSeconds/);
  assert.match(tokenEdge, /join\?\.retry_after_seconds/);
  assert.match(conferenceApi, /retryAfterSeconds\?: number/);
  assert.match(conferenceApi, /payload\?\.retryAfterSeconds/);
  assert.match(liveKitHook, /REJOIN_BLOCKED/);
});

test('SDK reconnect is preserved while terminal recovery requests a fresh backend token', () => {
  assert.match(liveKitHook, /RoomEvent\.Reconnecting/);
  assert.match(liveKitHook, /RoomEvent\.Reconnected/);
  assert.match(liveKitHook, /RoomEvent\.Disconnected/);
  assert.match(liveKitHook, /scheduleFreshTokenReconnect\(reason\)/);
  assert.match(liveKitHook, /connectRef\.current\?\.\(\)/);
  assert.match(liveKitHook, /requestLiveKitToken\(roomId, client\)/);
});

test('fresh-token retry is bounded and reason-aware', () => {
  assert.match(
    reconnectPolicy,
    /LIVEKIT_FRESH_TOKEN_RECONNECT_DELAYS_MS = \[[\s\S]*1_000,[\s\S]*3_000,[\s\S]*5_000/,
  );
  for (const reason of [
    'SERVER_SHUTDOWN',
    'STATE_MISMATCH',
    'JOIN_FAILURE',
    'SIGNAL_CLOSE',
    'CONNECTION_TIMEOUT',
    'MEDIA_FAILURE',
  ]) {
    assert.match(
      reconnectPolicy,
      new RegExp('DisconnectReason\\.' + reason),
    );
  }

  for (const reason of [
    'PARTICIPANT_REMOVED',
    'DUPLICATE_IDENTITY',
    'ROOM_DELETED',
    'ROOM_CLOSED',
    'CLIENT_INITIATED',
  ]) {
    assert.match(
      reconnectPolicy,
      new RegExp('DisconnectReason\\.' + reason),
    );
  }

  assert.match(
    liveKitHook,
    /freshReconnectAttemptRef\.current[\s\S]*LIVEKIT_FRESH_TOKEN_RECONNECT_DELAYS_MS\.length/,
  );
});

test('moderator removal cannot trigger automatic fresh-token rejoin', () => {
  assert.match(
    reconnectPolicy,
    /case DisconnectReason\.PARTICIPANT_REMOVED:[\s\S]*case DisconnectReason\.ROOM_DELETED:[\s\S]*return false/,
  );
  assert.match(
    liveKitHook,
    /reason === DisconnectReason\.CLIENT_INITIATED/,
  );
  assert.match(
    liveKitHook,
    /liveKitTerminalDisconnectLabel\(reason\)/,
  );
});

test('client does not mutate its own LiveKit name after connect', () => {
  assert.doesNotMatch(liveKitHook, /localParticipant\.setName\(/);
});

test('fresh Room reconnect preserves the last selected media devices', () => {
  assert.match(liveKitHook, /audioDeviceIdRef/);
  assert.match(liveKitHook, /videoDeviceIdRef/);
  assert.match(liveKitHook, /getActiveDevice\('audioinput'\)/);
  assert.match(liveKitHook, /getActiveDevice\('videoinput'\)/);
  assert.match(
    liveKitHook,
    /setMicrophoneEnabled\([\s\S]*audioDeviceIdRef\.current/,
  );
  assert.match(
    liveKitHook,
    /setConferenceCamera\([\s\S]*videoDeviceIdRef\.current/,
  );
});

test('token and LiveKit server secrets are not stored in frontend source', () => {
  const srcRoot = fileURLToPath(
    new URL('../../src', import.meta.url),
  );
  const contents = sourceFiles(srcRoot)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');

  assert.doesNotMatch(contents, /LIVEKIT_API_SECRET/);
  assert.doesNotMatch(contents, /LIVEKIT_API_KEY/);
  assert.doesNotMatch(contents, /livekitApiSecret/);
  assert.doesNotMatch(contents, /localStorage\.setItem\([^)]*livekit/i);
  assert.doesNotMatch(contents, /sessionStorage\.setItem\([^)]*livekit/i);
});

test('token edge keeps LiveKit credentials in server environment only', () => {
  assert.match(tokenEdge, /Deno\.env\.get\("LIVEKIT_API_KEY"\)/);
  assert.match(tokenEdge, /Deno\.env\.get\("LIVEKIT_API_SECRET"\)/);
  assert.doesNotMatch(
    tokenEdge,
    /return json\(200,[\s\S]*livekitApiSecret/,
  );
  assert.doesNotMatch(
    tokenEdge,
    /return json\(200,[\s\S]*livekitApiKey/,
  );
});
