import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260827230113_video_conference_phase8_private_chat.sql');
const hardening = read('supabase/migrations/20260827230639_video_conference_phase8_private_chat_rls_hardening.sql');
const edge = read('supabase/functions/conference-private-chat-control/index.ts');
const service = read('src/features/video-conference/services/conferencePrivateChat.ts');
const hook = read('src/features/video-conference/hooks/useConferencePrivateChat.ts');
const panel = read('src/features/video-conference/components/chat/ConferencePrivateChatPanel.tsx');
const item = read('src/features/video-conference/components/chat/ConferencePrivateMessageItem.tsx');
const composer = read('src/features/video-conference/components/chat/ConferencePrivateChatComposer.tsx');
const tools = read('src/features/video-conference/components/controls/ConferenceTools.tsx');
const toolbar = read('src/features/video-conference/components/controls/ConferenceToolsBar.tsx');
const types = read('src/features/video-conference/types/conference.types.ts');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('Phase 8 creates a dedicated one-to-one private message schema', () => {
  assert.match(migration, /create table if not exists public\.conference_private_messages/);
  for (const column of [
    'sender_id',
    'recipient_id',
    'body',
    'read_at',
    'reply_to_id',
    'edited_at',
    'deleted_at',
    'created_at',
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`));
  }
  assert.match(migration, /sender_id<>recipient_id/);
  assert.match(migration, /char_length\(body\)<=4000/);
});

test('private history has a permissive party grant plus restrictive FULL-auth boundary', () => {
  assert.match(hardening, /conference_private_messages_party_select/);
  assert.match(hardening, /conference_private_messages_full_auth_boundary/);
  assert.match(hardening, /as restrictive/);
  assert.match(hardening, /private\.is_current_session_fully_authorized\(\)/);
  assert.match(hardening, /auth\.uid\(\)[\s\S]*sender_id/);
  assert.match(hardening, /auth\.uid\(\)[\s\S]*recipient_id/);
  assert.match(hardening, /conference_participants/);

  const policyStart = hardening.indexOf('create policy "conference_private_messages_party_select"');
  const policy = hardening.slice(policyStart);
  assert.doesNotMatch(policy, /MODERATOR|MANAGE_CHAT|DELETE_CHAT/);
});

test('browser has read-only table access while mutations are service-role only', () => {
  assert.match(migration, /revoke all on table public\.conference_private_messages from public,anon,authenticated/);
  assert.match(migration, /grant select on table public\.conference_private_messages to authenticated,service_role/);
  assert.match(migration, /grant insert,update,delete on table public\.conference_private_messages to service_role/);
  assert.match(migration, /apply_conference_private_chat_action[\s\S]*to service_role/i);
  assert.match(migration, /apply_conference_private_chat_action[\s\S]*from public,anon,authenticated/i);
});

test('server authorization requires joined sender, SEND_PRIVATE_CHAT and joined recipient', () => {
  assert.match(migration, /p\.status='joined'/);
  assert.match(migration, /SEND_PRIVATE_CHAT/);
  assert.match(migration, /recipient_not_joined/);
  assert.match(migration, /invalid_recipient/);
  assert.match(migration, /chat_enabled/);
  assert.match(migration, /phase_allow_chat/);
});

test('edit and delete are sender-only and delete is soft/idempotent', () => {
  assert.match(migration, /v_message\.sender_id<>p_actor_user_id/);
  assert.match(migration, /not_message_sender/);
  assert.match(migration, /set body='',[\s\S]*is_deleted=true/);
  assert.match(migration, /deleted_by=p_actor_user_id/);
  assert.match(migration, /already_deleted/);
  assert.match(migration, /conference_private_message_deleted/);
});

test('reply target must belong to the same one-to-one conversation', () => {
  assert.match(migration, /p_reply_to_id/);
  assert.match(migration, /invalid_reply_target/);
  assert.match(migration, /m\.sender_id=p_actor_user_id[\s\S]*m\.recipient_id=p_peer_user_id/);
  assert.match(migration, /m\.sender_id=p_peer_user_id[\s\S]*m\.recipient_id=p_actor_user_id/);
  assert.match(migration, /reply_to_body/);
  assert.match(migration, /reply_to_sender_name/);
});

test('read receipt only marks incoming unread messages from the selected peer', () => {
  assert.match(migration, /v_action='read'/);
  assert.match(migration, /sender_id=p_peer_user_id/);
  assert.match(migration, /recipient_id=p_actor_user_id/);
  assert.match(migration, /read_at is null/);
  assert.match(migration, /updated_count/);
});

test('private chat is persisted and realtime only refreshes PostgreSQL history', () => {
  assert.match(service, /from\('conference_private_messages'\)/);
  assert.match(service, /order\('created_at', \{ ascending: false \}\)/);
  assert.match(service, /\.limit\(500\)/);
  assert.match(hook, /table: 'conference_private_messages'/);
  assert.match(hook, /postgres_changes/);
  assert.doesNotMatch(hook, /publishData|DataPacket/);
  assert.match(migration, /alter publication supabase_realtime[\s\S]*conference_private_messages/);
});

test('private chat edge validates FULL access then uses user authorization and service mutation', () => {
  assert.match(edge, /get_my_auth_access_state/);
  assert.match(edge, /accessState\.access_level !== "FULL"/);
  assert.match(edge, /authorize_conference_private_chat_action/);
  assert.match(edge, /apply_conference_private_chat_action/);
  assert.match(edge, /"send", "edit", "delete", "read"/);
});

test('private chat UI exposes recipient selection, unread counts, reply edit delete and read status', () => {
  assert.match(types, /'private-chat'/);
  assert.match(toolbar, /togglePanel\('private-chat'\)/);
  assert.match(toolbar, /privateUnreadCount/);
  assert.match(panel, /unreadByPeer/);
  assert.match(panel, /پیام‌ها فقط برای شما و مخاطب انتخاب‌شده/);
  assert.match(item, /خوانده شد/);
  assert.match(item, /ارسال شد/);
  assert.match(item, /onReply/);
  assert.match(item, /onEdit/);
  assert.match(item, /onDelete/);
  assert.match(composer, /پیام خصوصی/);
});

test('private chat recipients come from joined conference participants and exclude self', () => {
  assert.match(hook, /row\.user_id !== currentUserId/);
  assert.match(hook, /row\.status === 'joined'/);
  assert.match(tools, /participants: moderation\.participants/);
});

test('selected conversation is strictly current user plus one peer', () => {
  assert.match(hook, /row\.sender_id === currentUserId[\s\S]*row\.recipient_id === selectedPeerUserId/);
  assert.match(hook, /row\.sender_id === selectedPeerUserId[\s\S]*row\.recipient_id === currentUserId/);
});

test('self-hosted validation probes the private chat edge function', () => {
  assert.match(manager, /livekit_function_unauthorized_probe conference-private-chat-control/);
});
