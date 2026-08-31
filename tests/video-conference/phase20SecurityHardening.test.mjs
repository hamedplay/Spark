import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) =>
  readFileSync(new URL('../../' + path, import.meta.url), 'utf8');

const migration = read(
  'supabase/migrations/20260831075550_video_conference_phase20_security_hardening.sql',
);
const tokenEdge = read(
  'supabase/functions/conference-livekit-token/index.ts',
);
const webhookEdge = read(
  'supabase/functions/livekit-webhook/index.ts',
);
const chatEdge = read(
  'supabase/functions/conference-chat-control/index.ts',
);
const pollEdge = read(
  'supabase/functions/conference-poll-control/index.ts',
);
const whiteboardEdge = read(
  'supabase/functions/conference-whiteboard-control/index.ts',
);
const presentationEdge = read(
  'supabase/functions/conference-presentation-control/index.ts',
);
const recordingEdge = read(
  'supabase/functions/conference-recording/index.ts',
);
const legacyChat = read(
  'src/components/VideoConference/ChatPanel.tsx',
);

test('Phase 20 introduces a fail-closed FULL conference API session guard', () => {
  assert.match(
    migration,
    /create or replace function private\.conference_api_session_is_full\(\)/i,
  );
  assert.match(
    migration,
    /private\.is_current_session_fully_authorized\(\)/,
  );
  assert.match(
    migration,
    /not coalesce\(\(auth\.jwt\(\)->>'is_anonymous'\)::boolean,false\)/,
  );
  assert.match(
    migration,
    /revoke all on function private\.conference_api_session_is_full\(\)[\s\S]*from public,anon/i,
  );
});

test('current actor role resolution fails closed outside a FULL session', () => {
  assert.match(
    migration,
    /p_user_id=auth\.uid\(\)[\s\S]*not private\.conference_api_session_is_full\(\)[\s\S]*return null/i,
  );
  assert.match(
    migration,
    /create or replace function private\.conference_actor_role[\s\S]*not private\.conference_api_session_is_full\(\)[\s\S]*return null/i,
  );
});

test('pre-join and state RPCs enforce the FULL conference API boundary', () => {
  for (const name of [
    'resolve_conference_room',
    'check_conference_join',
    'create_conference_room',
    'create_meeting_livekit_conference',
    'join_conference_room',
    'prepare_livekit_conference_join',
    'get_livekit_waiting_room_state',
    'get_livekit_waiting_room_snapshot',
    'get_conference_recording_consent_state',
    'set_conference_recording_consent',
    'get_conference_phase_snapshot',
    'get_conference_speaker_timer_snapshot',
    'get_my_conference_authorization',
    'get_my_livekit_conference_policy',
  ]) {
    const section = migration.match(
      new RegExp(
        'create or replace function public\\.' + name
        + '[\\s\\S]*?(?=create or replace function|revoke insert)',
        'i',
      ),
    )?.[0] || '';
    assert.match(
      section,
      /private\.conference_api_session_is_full\(\)/,
      name,
    );
  }

  assert.match(
    migration,
    /create or replace function public\.get_video_conference_runtime_config[\s\S]*not private\.conference_api_session_is_full\(\)/i,
  );
});

test('direct participant join and sensitive participant mutation are closed', () => {
  assert.match(
    migration,
    /revoke insert,delete,truncate,references,trigger,update[\s\S]*public\.conference_participants[\s\S]*from authenticated/i,
  );
  assert.match(
    migration,
    /grant update\(is_muted,is_video_off,is_hand_raised\)[\s\S]*conference_participants[\s\S]*to authenticated/i,
  );
  assert.match(
    migration,
    /drop policy if exists auth_can_join_rooms/i,
  );
  assert.match(
    migration,
    /guard_conference_participant_client_update/,
  );
  for (const field of [
    'role',
    'status',
    'peer_id',
    'mic_publishing_disabled',
    'camera_publishing_disabled',
    'screen_publishing_disabled',
  ]) {
    assert.match(migration, new RegExp(field));
  }
});

test('server-managed conference tables use least-privilege authenticated grants', () => {
  assert.match(
    migration,
    /revoke insert,update,delete,truncate,references,trigger[\s\S]*conference_audit_events[\s\S]*conference_attendance_events[\s\S]*conference_message_mentions[\s\S]*conference_message_reactions[\s\S]*conference_phase_events[\s\S]*conference_speaker_sessions[\s\S]*from authenticated/i,
  );
});

test('legacy anonymous signaling and reaction table access is removed', () => {
  assert.match(
    migration,
    /revoke all[\s\S]*conference_signals,public\.conference_reactions[\s\S]*from anon/i,
  );
  assert.match(migration, /drop policy if exists "Anon can insert signals"/);
  assert.match(migration, /drop policy if exists "Anon can read signals"/);
  assert.match(migration, /drop policy if exists "Anon can insert reactions"/);
  assert.match(migration, /drop policy if exists "Anon can read reactions"/);
});

test('all previously ungated conference read surfaces receive restrictive FULL auth RLS', () => {
  for (const table of [
    'conference_archives',
    'conference_attendance_events',
    'conference_audit_events',
    'conference_breakout_assignments',
    'conference_live_captions',
    'conference_message_mentions',
    'conference_message_reactions',
    'conference_phase_events',
    'conference_preflight_results',
    'conference_recordings',
    'conference_speaker_sessions',
    'conference_transcript_segments',
    'conference_transcripts',
  ]) {
    assert.match(migration, new RegExp("'" + table + "'"));
  }
  assert.match(
    migration,
    /as restrictive for all to authenticated using \(\(select private\.conference_api_session_is_full\(\)\)\) with check/i,
  );
});

test('conference chat attachment upload and read are room-scoped and FULL-auth protected', () => {
  assert.match(
    migration,
    /can_upload_conference_chat_attachment/,
  );
  assert.match(
    migration,
    /can_read_conference_chat_attachment_path/,
  );
  assert.match(
    migration,
    /v_parts\[1\]<>'conf-chat'/,
  );
  assert.match(
    migration,
    /private\.has_conference_permission\([\s\S]*'SEND_CHAT'/,
  );
  assert.match(
    migration,
    /chat_enabled[\s\S]*phase_allow_chat/,
  );
  assert.match(
    migration,
    /Conference chat attachment insert boundary/,
  );
  assert.match(
    migration,
    /Conference chat attachment read boundary/,
  );
});

test('chat image linkage requires a real owned storage object with approved MIME', () => {
  assert.match(
    migration,
    /is_valid_conference_chat_image_path/,
  );
  assert.match(
    migration,
    /from storage\.objects o/,
  );
  assert.match(
    migration,
    /o\.bucket_id='chat-attachments'/,
  );
  assert.match(
    migration,
    /o\.owner_id=p_user_id::text/,
  );
  for (const mime of [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]) {
    assert.match(migration, new RegExp(mime.replace('/', '\\/')));
  }
});

test('legacy direct chat is backend-guarded instead of bypassing authorization and rate limits', () => {
  assert.match(
    migration,
    /guard_direct_conference_message_insert/,
  );
  assert.match(
    migration,
    /conference_chat_action_allowed\([\s\S]*'send'/,
  );
  assert.match(
    migration,
    /consume_conference_chat_rate_limit/,
  );
  assert.match(
    migration,
    /conference_chat_display_name/,
  );
  assert.match(
    migration,
    /conference_chat_role_label/,
  );
  assert.match(
    migration,
    /conference_chat_reply_requires_control_api/,
  );
  assert.match(
    migration,
    /conference_message_direct_insert_guard/,
  );
});

test('legacy chat client mirrors the authoritative bucket MIME and size allowlist', () => {
  assert.match(legacyChat, /CHAT_IMAGE_EXTENSIONS/);
  for (const mime of [
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
  ]) {
    assert.match(legacyChat, new RegExp(mime.replace('/', '\\/')));
  }
  assert.match(legacyChat, /file\.size <= 0/);
  assert.match(legacyChat, /5 \* 1024 \* 1024/);
  assert.doesNotMatch(legacyChat, /file\.type\.startsWith\('image\/'\)/);
  assert.doesNotMatch(legacyChat, /file\.name\.split\('\.'\)/);
});

test('LiveKit token issuance is server-side, scoped and short lived', () => {
  assert.match(tokenEdge, /auth\.getUser\(\)/);
  assert.match(tokenEdge, /get_my_auth_access_state/);
  assert.match(tokenEdge, /accessState\.access_level !== "FULL"/);
  assert.match(tokenEdge, /identity: authUser\.id/);
  assert.match(tokenEdge, /ttl: "2m"/);
  assert.match(tokenEdge, /room: roomName/);
  assert.match(tokenEdge, /roomAdmin: false/);
  assert.match(tokenEdge, /LIVEKIT_API_SECRET/);
  assert.doesNotMatch(tokenEdge, /livekitApiSecret[\s\S]*return json\(200,[\s\S]*livekitApiSecret/);
});

test('LiveKit webhook validates the signed raw body and requires an idempotency key', () => {
  assert.match(webhookEdge, /new WebhookReceiver/);
  assert.match(webhookEdge, /\.receive\(rawBody, authHeader\)/);
  assert.match(webhookEdge, /INVALID_WEBHOOK_SIGNATURE/);
  assert.match(webhookEdge, /WEBHOOK_EVENT_ID_REQUIRED/);
  assert.match(webhookEdge, /apply_livekit_webhook_event_v1/);
});

test('chat poll whiteboard presentation and recording actions validate on the backend', () => {
  assert.match(chatEdge, /authorize_conference_chat_action/);
  assert.match(chatEdge, /apply_conference_chat_action/);

  assert.match(pollEdge, /authorize_conference_poll_action/);
  assert.match(pollEdge, /apply_conference_poll_action/);

  assert.match(whiteboardEdge, /authorize_conference_whiteboard_action_v2/);
  assert.match(whiteboardEdge, /apply_conference_whiteboard_action_v2/);

  assert.match(
    presentationEdge,
    /authorize_conference_presentation_action/,
  );
  assert.match(
    presentationEdge,
    /apply_conference_presentation_action/,
  );

  assert.match(recordingEdge, /authorize_livekit_recording/);
});
