import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';

const REQUIRED = [
  'PHASE24_SUPABASE_URL',
  'PHASE24_ANON_KEY',
  'PHASE24_SERVICE_ROLE_KEY',
  'PHASE24_HOST_ACCESS_TOKEN',
  'PHASE24_PARTICIPANT_ACCESS_TOKEN',
  'PHASE24_ROOM_ID',
  'PHASE24_PARTICIPANT_USER_ID',
];

function env(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

for (const key of REQUIRED) env(key);

const supabaseUrl = env('PHASE24_SUPABASE_URL').replace(/\/$/, '');
const anonKey = env('PHASE24_ANON_KEY');
const serviceRoleKey = env('PHASE24_SERVICE_ROLE_KEY');
const hostToken = env('PHASE24_HOST_ACCESS_TOKEN');
const participantToken = env('PHASE24_PARTICIPANT_ACCESS_TOKEN');
const roomId = env('PHASE24_ROOM_ID');
const targetUserId = env('PHASE24_PARTICIPANT_USER_ID');
const enableRecording = process.env.PHASE24_ENABLE_RECORDING === '1';

function userClient(accessToken) {
  return createClient(supabaseUrl, anonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

const host = userClient(hostToken);
const participant = userClient(participantToken);
const service = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});

const results = [];

async function step(name, fn) {
  const started = Date.now();
  try {
    const details = await fn();
    results.push({
      name,
      ok: true,
      durationMs: Date.now() - started,
      details: details ?? null,
    });
    console.log(`PASS ${name}`);
    return details;
  } catch (error) {
    results.push({
      name,
      ok: false,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    });
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Unexpected JWT shape');
  const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4
    ? '='.repeat(4 - (normalized.length % 4))
    : '';
  return JSON.parse(
    Buffer.from(normalized + pad, 'base64').toString('utf8'),
  );
}

async function rpc(client, name, args = {}) {
  const { data, error } = await client.rpc(name, args);
  if (error) throw error;
  return data;
}

async function edge(client, name, body) {
  const { data, error } = await client.functions.invoke(name, { body });
  if (error || !data?.ok) {
    throw new Error(
      String(data?.error || data?.reason || error?.message || `${name}_FAILED`),
    );
  }
  return data;
}

async function rawToken(accessToken) {
  const response = await fetch(
    `${supabaseUrl}/functions/v1/conference-livekit-token`,
    {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ roomId }),
    },
  );

  const payload = await response.json().catch(() => ({}));

  return {
    response,
    payload,
  };
}

async function ensureParticipantTokenReady() {
  let current = await rawToken(participantToken);

  if (
    current.payload?.reason === 'waiting_for_admission'
    || current.payload?.error === 'WAITING_FOR_ADMISSION'
  ) {
    const admitted = await rpc(host, 'admit_livekit_conference_participant', {
      p_room_id: roomId,
      p_target_user_id: targetUserId,
      p_admit: true,
    });
    assert.equal(admitted?.ok, true, 'host could not admit participant');
    current = await rawToken(participantToken);
  }

  assert.equal(current.response.ok, true, JSON.stringify(current.payload));
  assert.equal(typeof current.payload?.token, 'string');
  return current;
}

async function waitForSpeakerTerminalStatus(timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snapshot = await rpc(host, 'get_conference_speaker_timer_snapshot', {
      p_room_id: roomId,
    });

    const sessions = Array.isArray(snapshot?.sessions)
      ? snapshot.sessions
      : [];
    const session = sessions.find((item) => item?.user_id === targetUserId);

    if (
      session
      && ['EXPIRED', 'COMPLETED', 'CANCELLED'].includes(session.status)
    ) {
      return session;
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error('speaker session did not expire within timeout');
}

let webhookEventId = null;
let recordingStarted = false;

try {
  const users = await step('authenticated test identities', async () => {
    const [
      { data: hostUser, error: hostUserError },
      { data: participantUser, error: participantUserError },
    ] = await Promise.all([
      host.auth.getUser(hostToken),
      participant.auth.getUser(participantToken),
    ]);

    if (hostUserError) throw hostUserError;
    if (participantUserError) throw participantUserError;

    assert.ok(hostUser.user?.id);
    assert.equal(participantUser.user?.id, targetUserId);

    return {
      hostUserId: hostUser.user.id,
      participantUserId: participantUser.user.id,
    };
  });

  await step('join authorization for both users', async () => {
    const [hostJoin, participantJoin] = await Promise.all([
      rpc(host, 'check_conference_join', { p_room_id: roomId }),
      rpc(participant, 'check_conference_join', { p_room_id: roomId }),
    ]);

    assert.equal(hostJoin?.allowed, true, JSON.stringify(hostJoin));
    assert.equal(participantJoin?.allowed, true, JSON.stringify(participantJoin));
  });

  const hostTokenResult = await step('LiveKit token issuance', async () => {
    const current = await rawToken(hostToken);

    assert.equal(current.response.ok, true, JSON.stringify(current.payload));
    assert.match(
      current.response.headers.get('cache-control') || '',
      /no-store/i,
    );
    assert.equal(typeof current.payload?.token, 'string');
    assert.equal(typeof current.payload?.serverUrl, 'string');
    assert.equal(typeof current.payload?.roomName, 'string');
    assert.equal(current.payload?.expiresInSeconds, 120);

    const claims = decodeJwtPayload(current.payload.token);
    assert.equal(claims.sub, users.hostUserId);
    assert.equal(claims.video?.roomJoin, true);
    assert.equal(claims.video?.room, current.payload.roomName);
    assert.notEqual(claims.video?.roomAdmin, true);

    const issuedAt = Number(claims.iat || claims.nbf || 0);
    const expiresAt = Number(claims.exp || 0);
    assert.ok(expiresAt > issuedAt);
    assert.ok(expiresAt - issuedAt <= 130);

    return {
      roomName: current.payload.roomName,
      expiresInSeconds: current.payload.expiresInSeconds,
    };
  });

  await step('participant token issuance / waiting-room admission', async () => {
    const current = await ensureParticipantTokenReady();
    const claims = decodeJwtPayload(current.payload.token);
    assert.equal(claims.sub, targetUserId);
    assert.equal(claims.video?.room, hostTokenResult.roomName);
    return { roomName: current.payload.roomName };
  });

  await step('host disable/enable microphone updates participant policy', async () => {
    await edge(host, 'conference-host-control', {
      roomId,
      action: 'disable-mic',
      targetUserId,
    });

    const disabled = await rpc(
      participant,
      'get_my_livekit_conference_policy',
      { p_room_id: roomId },
    );
    assert.equal(disabled?.ok, true, JSON.stringify(disabled));
    assert.equal(
      Array.isArray(disabled?.publishSources)
        && disabled.publishSources.includes('microphone'),
      false,
    );

    await edge(host, 'conference-host-control', {
      roomId,
      action: 'enable-mic',
      targetUserId,
    });

    const enabled = await rpc(
      participant,
      'get_my_livekit_conference_policy',
      { p_room_id: roomId },
    );
    assert.equal(enabled?.ok, true, JSON.stringify(enabled));

    return {
      microphoneRestored: Array.isArray(enabled?.publishSources)
        && enabled.publishSources.includes('microphone'),
    };
  });

  await step('raise hand lifecycle', async () => {
    const raised = await rpc(participant, 'set_livekit_raise_hand', {
      p_room_id: roomId,
      p_raised: true,
    });
    assert.equal(raised?.ok, true, JSON.stringify(raised));

    const { data: row, error } = await participant
      .from('conference_participants')
      .select('is_hand_raised,hand_raised_at')
      .eq('room_id', roomId)
      .eq('user_id', targetUserId)
      .single();
    if (error) throw error;
    assert.equal(row.is_hand_raised, true);
    assert.ok(row.hand_raised_at);

    const lowered = await rpc(participant, 'set_livekit_raise_hand', {
      p_room_id: roomId,
      p_raised: false,
    });
    assert.equal(lowered?.ok, true, JSON.stringify(lowered));
  });

  await step('speaker expiry worker lifecycle', async () => {
    await edge(host, 'conference-speaker-timer-control', {
      roomId,
      targetUserId,
      action: 'start',
      seconds: 10,
    });

    const terminal = await waitForSpeakerTerminalStatus();

    assert.ok(
      ['EXPIRED', 'COMPLETED'].includes(terminal.status),
      JSON.stringify(terminal),
    );

    return {
      status: terminal.status,
      allocatedSeconds: terminal.allocated_seconds,
    };
  });

  await step('webhook idempotency database boundary', async () => {
    webhookEventId = `phase24-${crypto.randomUUID()}`;
    const args = {
      p_event_type: 'track_published',
      p_event_id: webhookEventId,
      p_room_name: hostTokenResult.roomName,
      p_participant_identity: users.hostUserId,
      p_egress_id: null,
      p_payload: {
        phase24: true,
        source: 'runtime-integration',
      },
    };

    const first = await rpc(service, 'apply_livekit_webhook_event_v1', args);
    const duplicate = await rpc(service, 'apply_livekit_webhook_event_v1', args);

    assert.equal(first?.duplicate, false, JSON.stringify(first));
    assert.equal(duplicate?.duplicate, true, JSON.stringify(duplicate));

    return {
      duplicate: duplicate.duplicate,
    };
  });

  if (enableRecording) {
    await step('recording start/stop lifecycle', async () => {
      const start = await edge(host, 'conference-recording', {
        roomId,
        action: 'start',
      });
      recordingStarted = true;
      assert.ok(start.recordingId);

      const stop = await edge(host, 'conference-recording', {
        roomId,
        action: 'stop',
      });
      recordingStarted = false;
      assert.ok(stop.recordingId);

      return {
        recordingId: stop.recordingId,
        status: stop.status,
      };
    });
  } else {
    results.push({
      name: 'recording start/stop lifecycle',
      ok: true,
      skipped: true,
      reason: 'PHASE24_ENABLE_RECORDING is not 1',
    });
    console.log('SKIP recording start/stop lifecycle');
  }
} finally {
  try {
    await rpc(participant, 'set_livekit_raise_hand', {
      p_room_id: roomId,
      p_raised: false,
    });
  } catch {}

  try {
    await edge(host, 'conference-host-control', {
      roomId,
      action: 'enable-mic',
      targetUserId,
    });
  } catch {}

  if (recordingStarted) {
    try {
      await edge(host, 'conference-recording', {
        roomId,
        action: 'stop',
      });
    } catch {}
  }

  if (webhookEventId) {
    try {
      await service
        .from('livekit_webhook_events')
        .delete()
        .eq('event_id', webhookEventId);
    } catch {}
  }
}

console.log(JSON.stringify({
  ok: results.every((item) => item.ok),
  roomId,
  results,
}, null, 2));
