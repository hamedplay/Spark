import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const hardening = read('supabase/migrations/20260827223541_video_conference_phase7_chat_auth_hardening.sql');
const edge = read('supabase/functions/conference-chat-control/index.ts');

test('chat reads require both room membership and Spark FULL auth state', () => {
  assert.match(hardening, /conference_messages_room_read_boundary/);
  assert.match(hardening, /as restrictive/);
  assert.match(hardening, /private\.is_current_session_fully_authorized\(\)/);
  assert.match(hardening, /conference_message_reactions_select/);
  assert.match(hardening, /conference_message_mentions_select/);
});

test('legacy direct inserts reject sessions that are not fully authorized', () => {
  assert.match(hardening, /enforce_conference_phase_chat_insert/);
  assert.match(hardening, /not private\.is_current_session_fully_authorized\(\)/);
  assert.match(hardening, /conference chat session is not fully authorized/);
});

test('edge path independently checks FULL access before mutation authorization', () => {
  assert.match(edge, /get_my_auth_access_state/);
  assert.match(edge, /accessState\.access_level !== "FULL"/);
  assert.match(edge, /authorize_conference_chat_action/);
});
