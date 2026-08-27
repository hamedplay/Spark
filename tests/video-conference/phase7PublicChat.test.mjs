import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260827222910_video_conference_phase7_public_chat_enhancement.sql');
const edge = read('supabase/functions/conference-chat-control/index.ts');
const chatService = read('src/features/video-conference/services/conferenceChat.ts');
const chatHook = read('src/features/video-conference/hooks/useConferenceChat.ts');
const realtimeService = read('src/features/video-conference/services/conferenceRealtime.ts');
const realtimeHook = read('src/features/video-conference/hooks/useConferenceRealtime.ts');
const chatPanel = read('src/features/video-conference/components/chat/ConferenceChatPanel.tsx');
const composer = read('src/features/video-conference/components/chat/ConferenceChatComposer.tsx');
const item = read('src/features/video-conference/components/chat/ConferenceMessageItem.tsx');
const tools = read('src/features/video-conference/components/controls/ConferenceTools.tsx');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('public chat persistence adds edit/delete metadata plus normalized reactions and mentions', () => {
  assert.match(migration, /add column if not exists edited_at timestamptz/);
  assert.match(migration, /add column if not exists deleted_at timestamptz/);
  assert.match(migration, /add column if not exists deleted_by uuid/);
  assert.match(migration, /create table if not exists public\.conference_message_reactions/);
  assert.match(migration, /create table if not exists public\.conference_message_mentions/);
  assert.match(migration, /unique\(message_id,user_id,emoji\)/i);
  assert.match(migration, /primary key\(message_id,mentioned_user_id\)/i);
});

test('history remains PostgreSQL authoritative and realtime only refreshes persisted state', () => {
  assert.match(realtimeService, /from\('conference_messages'\)/);
  assert.match(realtimeService, /from\('conference_message_reactions'\)/);
  assert.match(realtimeService, /from\('conference_message_mentions'\)/);
  assert.match(realtimeService, /order\('created_at', \{ ascending: false \}\)/);
  assert.match(realtimeService, /\.limit\(200\)/);
  assert.match(realtimeHook, /table: 'conference_messages'/);
  assert.match(realtimeHook, /table: 'conference_message_reactions'/);
  assert.match(realtimeHook, /table: 'conference_message_mentions'/);
  assert.doesNotMatch(chatHook, /publishData|DataPacket|spark-chat/);
});

test('SFU mutations use one authenticated edge boundary instead of direct table writes', () => {
  assert.match(chatService, /functions\.invoke\('conference-chat-control'/);
  assert.doesNotMatch(chatHook, /from\('conference_messages'\)\.insert/);
  assert.doesNotMatch(chatHook, /from\('conference_messages'\)\.update/);
  assert.doesNotMatch(chatHook, /from\('conference_messages'\)\.delete/);
  assert.match(edge, /get_my_auth_access_state/);
  assert.match(edge, /authorize_conference_chat_action/);
  assert.match(edge, /apply_conference_chat_action/);
  assert.match(migration, /apply_conference_chat_action[\s\S]*to service_role/i);
});

test('legacy direct inserts stay compatible but are server sanitized and rate limited', () => {
  assert.match(migration, /create or replace function private\.enforce_conference_phase_chat_insert/);
  assert.match(migration, /new\.user_id<>v_uid/);
  assert.match(migration, /is_conference_joined_actor_in_room/);
  assert.match(migration, /has_conference_permission\(new\.room_id,'SEND_CHAT',v_uid\)/);
  assert.match(migration, /new\.display_name:=private\.conference_chat_display_name/);
  assert.match(migration, /new\.role:=private\.conference_chat_role_label/);
  assert.match(migration, /consume_conference_chat_rate_limit/);
  assert.doesNotMatch(migration, /revoke insert on table public\.conference_messages from authenticated/);
});

test('direct destructive mutations are closed and reads have a restrictive room boundary', () => {
  assert.match(migration, /revoke update,delete,truncate,references,trigger[\s\S]*from anon,authenticated/);
  assert.match(migration, /conference_messages_room_read_boundary/);
  assert.match(migration, /as restrictive[\s\S]*for select[\s\S]*to authenticated/i);
  assert.match(migration, /p\.room_id=conference_messages\.room_id/);
  assert.match(migration, /p\.user_id=\(select auth\.uid\(\)\)/);
});

test('send rate limit is atomic and capped at eight messages per ten seconds', () => {
  assert.match(migration, /v_window interval:=interval '10 seconds'/);
  assert.match(migration, /v_limit integer:=8/);
  assert.match(migration, /for update/);
  assert.match(migration, /reason','rate_limited'/);
  assert.match(edge, /return reply\(429/);
  assert.match(chatHook, /RATE_LIMITED/);
  assert.match(chatHook, /retryAfterMs/);
});

test('reply stores a durable snapshot in the message row', () => {
  assert.match(migration, /p_reply_to_id/);
  assert.match(migration, /reply_to_id,reply_to_body,reply_to_name/);
  assert.match(migration, /left\(coalesce\(v_reply\.body,''\),500\)/);
  assert.match(item, /item\.reply_to_id/);
  assert.match(item, /item\.reply_to_body/);
  assert.match(chatHook, /replyTo\?\.id/);
  assert.match(composer, /پاسخ به/);
});

test('authors can edit and deletes are soft with moderator authorization', () => {
  assert.match(migration, /v_action='edit'/);
  assert.match(migration, /v_message\.user_id<>p_actor_user_id/);
  assert.match(migration, /set body=v_body,[\s\S]*edited_at=clock_timestamp\(\)/);
  assert.match(migration, /v_action='delete'/);
  assert.match(migration, /DELETE_CHAT/);
  assert.match(migration, /set body='',[\s\S]*is_deleted=true,[\s\S]*deleted_at=clock_timestamp\(\)/);
  assert.match(migration, /conference_chat_message_deleted/);
  assert.match(item, /ویرایش شده/);
  assert.match(item, /حذف مدیر/);
});

test('emoji reactions toggle per user and message', () => {
  assert.match(migration, /v_action='react'/);
  assert.match(migration, /delete from public\.conference_message_reactions/);
  assert.match(migration, /insert into public\.conference_message_reactions/);
  assert.match(item, /QUICK_REACTIONS/);
  for (const emoji of ['👍', '❤️', '😂', '👏', '🎉']) {
    assert.match(item, new RegExp(emoji));
  }
  assert.match(chatHook, /toggleReaction/);
});

test('mentions are selected from joined participants and persisted by user id', () => {
  assert.match(migration, /validate_conference_message_mentions/);
  assert.match(migration, /v_distinct_count>10/);
  assert.match(migration, /p\.status='joined'/);
  assert.match(migration, /insert into public\.conference_message_mentions/);
  assert.match(chatHook, /toggleMention/);
  assert.match(chatHook, /mentionCandidates/);
  assert.match(composer, /message\.includes\('@'\)/);
  assert.match(composer, /@\{participant\.display_name\}/);
  assert.match(tools, /mentionCandidates=\{moderation\.participants\}/);
});

test('message item preserves timestamps and displays deleted history without removing rows', () => {
  assert.match(item, /toLocaleTimeString\('fa-IR'/);
  assert.match(item, /toLocaleString\('fa-IR'\)/);
  assert.match(item, /پیام حذف شده است/);
  assert.match(chatPanel, /ConferenceMessageItem/);
  assert.match(chatPanel, /ConferenceChatComposer/);
});

test('phase chat policy remains part of every send edit and reaction authorization path', () => {
  assert.match(migration, /phase_allow_chat/);
  assert.match(migration, /chat_enabled/);
  assert.match(migration, /conference chat is disabled for the current meeting phase/);
  assert.match(chatHook, /phaseAllowsChat/);
});

test('self-hosted validation probes the new chat edge function', () => {
  assert.match(manager, /livekit_function_unauthorized_probe conference-chat-control/);
});
