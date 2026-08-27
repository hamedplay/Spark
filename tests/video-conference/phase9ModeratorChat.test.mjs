import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260827231900_video_conference_phase9_moderator_chat.sql');
const hardening = read('supabase/migrations/20260827232053_video_conference_phase9_moderator_chat_rls_hardening.sql');
const edge = read('supabase/functions/conference-moderator-chat-control/index.ts');
const service = read('src/features/video-conference/services/conferenceModeratorChat.ts');
const hook = read('src/features/video-conference/hooks/useConferenceModeratorChat.ts');
const panel = read('src/features/video-conference/components/chat/ConferenceModeratorChatPanel.tsx');
const item = read('src/features/video-conference/components/chat/ConferenceModeratorMessageItem.tsx');
const composer = read('src/features/video-conference/components/chat/ConferenceModeratorChatComposer.tsx');
const tools = read('src/features/video-conference/components/controls/ConferenceTools.tsx');
const toolbar = read('src/features/video-conference/components/controls/ConferenceToolsBar.tsx');
const types = read('src/features/video-conference/types/conference.types.ts');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('Phase 9 adds a dedicated moderator channel table', () => {
  assert.match(migration, /create table if not exists public\.conference_moderator_messages/);
  for (const column of [
    'room_id',
    'sender_id',
    'sender_name',
    'body',
    'reply_to_id',
    'edited_at',
    'deleted_at',
    'created_at',
  ]) {
    assert.match(migration, new RegExp(`\\b${column}\\b`));
  }
  assert.match(migration, /conference_moderator_messages_body_length_check/);
});

test('moderator chat uses an independent RBAC permission', () => {
  assert.match(types, /'ACCESS_MODERATOR_CHAT'/);
  assert.match(migration, /values\('ACCESS_MODERATOR_CHAT'\)/);
  assert.match(migration, /\('HOST','ACCESS_MODERATOR_CHAT'\)/);
  assert.match(migration, /\('CO_HOST','ACCESS_MODERATOR_CHAT'\)/);
  assert.match(migration, /\('MODERATOR','ACCESS_MODERATOR_CHAT'\)/);

  const mappingStart = migration.indexOf('insert into private.conference_role_permissions');
  const mappingEnd = migration.indexOf('create table if not exists public.conference_moderator_messages');
  const mapping = migration.slice(mappingStart, mappingEnd);
  assert.doesNotMatch(mapping, /\('OWNER','ACCESS_MODERATOR_CHAT'\)/);
  assert.doesNotMatch(mapping, /\('PRESENTER','ACCESS_MODERATOR_CHAT'\)/);
  assert.doesNotMatch(mapping, /\('PARTICIPANT','ACCESS_MODERATOR_CHAT'\)/);
  assert.doesNotMatch(mapping, /\('VIEWER','ACCESS_MODERATOR_CHAT'\)/);
});

test('RLS has both permissive membership and restrictive FULL-auth boundaries', () => {
  assert.match(migration, /conference_moderator_messages_member_select/);
  assert.match(migration, /conference_moderator_messages_auth_boundary/);
  assert.match(migration, /as restrictive/);
  assert.match(hardening, /can_access_conference_moderator_chat/);
  assert.match(hardening, /private\.is_current_session_fully_authorized\(\)/);
});

test('dedicated RLS helper checks permission and joined conference membership', () => {
  assert.match(hardening, /create or replace function private\.can_access_conference_moderator_chat/);
  assert.match(hardening, /has_conference_permission[\s\S]*ACCESS_MODERATOR_CHAT/);
  assert.match(hardening, /conference_participants/);
  assert.match(hardening, /p\.status='joined'/);
  assert.match(hardening, /grant execute[\s\S]*to authenticated,service_role/);
});

test('normal browser access is select-only and mutations are service-role only', () => {
  assert.match(migration, /revoke all on table public\.conference_moderator_messages[\s\S]*from public,anon,authenticated/);
  assert.match(migration, /grant select on table public\.conference_moderator_messages[\s\S]*to authenticated,service_role/);
  assert.match(migration, /grant insert,update,delete on table public\.conference_moderator_messages[\s\S]*to service_role/);
  assert.match(migration, /apply_conference_moderator_chat_action[\s\S]*from public,anon,authenticated/i);
  assert.match(migration, /apply_conference_moderator_chat_action[\s\S]*to service_role/i);
});

test('server authorization requires moderator-channel permission and joined actor', () => {
  assert.match(migration, /conference_moderator_chat_action_allowed/);
  assert.match(migration, /ACCESS_MODERATOR_CHAT/);
  assert.match(migration, /p\.status='joined'/);
  assert.match(migration, /reason','forbidden'/);
  assert.match(migration, /v_room\.status='ended'/);
});

test('moderator channel stays independent from public chat phase toggles', () => {
  const actionStart = migration.indexOf('create or replace function private.conference_moderator_chat_action_allowed');
  const actionEnd = migration.indexOf('revoke execute on function private.conference_moderator_chat_action_allowed');
  const actionFunction = migration.slice(actionStart, actionEnd);
  assert.doesNotMatch(actionFunction, /phase_allow_chat|chat_enabled/);
});

test('reply edit and soft-delete are persisted server-side', () => {
  assert.match(migration, /invalid_reply_target/);
  assert.match(migration, /reply_to_body/);
  assert.match(migration, /reply_to_sender_name/);
  assert.match(migration, /edited_at=clock_timestamp\(\)/);
  assert.match(migration, /is_deleted=true/);
  assert.match(migration, /deleted_by=p_actor_user_id/);
  assert.match(migration, /conference_moderator_message_deleted/);
  assert.match(migration, /not_message_sender/);
});

test('history is PostgreSQL-backed and realtime only refreshes authorized rows', () => {
  assert.match(service, /from\('conference_moderator_messages'\)/);
  assert.match(service, /order\('created_at', \{ ascending: false \}\)/);
  assert.match(service, /\.limit\(300\)/);
  assert.match(hook, /table: 'conference_moderator_messages'/);
  assert.match(hook, /postgres_changes/);
  assert.doesNotMatch(hook, /publishData|DataPacket/);
  assert.match(migration, /alter publication supabase_realtime[\s\S]*conference_moderator_messages/);
});

test('frontend affordance is permission-driven rather than role-name-driven', () => {
  assert.match(hook, /hasConferencePermission\(authorization, 'ACCESS_MODERATOR_CHAT'\)/);
  assert.doesNotMatch(hook, /authorization\.role\s*===/);
  assert.match(types, /'moderator-chat'/);
  assert.match(toolbar, /canModeratorChat/);
  assert.match(toolbar, /togglePanel\('moderator-chat'\)/);
  assert.match(tools, /canModeratorChat=\{moderatorChat\.canUse\}/);
});

test('moderator channel UI exposes isolated history reply edit delete and timestamp', () => {
  assert.match(panel, /فقط برای میزبان، هم‌میزبان و مدیر جلسه/);
  assert.match(panel, /ConferenceModeratorMessageItem/);
  assert.match(item, /toLocaleTimeString\('fa-IR'/);
  assert.match(item, /onReply/);
  assert.match(item, /onEdit/);
  assert.match(item, /onDelete/);
  assert.match(composer, /کانال مدیران/);
});

test('edge function enforces FULL auth then user authorization then service mutation', () => {
  assert.match(edge, /get_my_auth_access_state/);
  assert.match(edge, /accessState\.access_level !== "FULL"/);
  assert.match(edge, /authorize_conference_moderator_chat_action/);
  assert.match(edge, /apply_conference_moderator_chat_action/);
  assert.match(edge, /"send", "edit", "delete"/);
});

test('self-hosted validation probes the moderator chat edge function', () => {
  assert.match(manager, /livekit_function_unauthorized_probe conference-moderator-chat-control/);
});
