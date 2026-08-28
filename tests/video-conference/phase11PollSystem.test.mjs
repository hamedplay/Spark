import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260827235528_video_conference_phase11_poll_system.sql');
const hardening = read('supabase/migrations/20260827235822_video_conference_phase11_poll_acl_hardening.sql');
const fkIndex = read('supabase/migrations/20260828000249_video_conference_phase11_poll_fk_index.sql');
const edge = read('supabase/functions/conference-poll-control/index.ts');
const service = read('src/features/video-conference/services/conferencePolls.ts');
const hook = read('src/features/video-conference/hooks/useConferencePolls.ts');
const createForm = read('src/features/video-conference/components/polls/PollCreateForm.tsx');
const pollCard = read('src/features/video-conference/components/polls/PollCard.tsx');
const panel = read('src/features/video-conference/components/polls/ConferencePollPanel.tsx');
const tools = read('src/features/video-conference/components/controls/ConferenceTools.tsx');
const toolbar = read('src/features/video-conference/components/controls/ConferenceToolsBar.tsx');
const legacy = read('src/components/VideoConference/PollPanel.tsx');
const types = read('src/features/video-conference/types/conference.types.ts');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('Phase 11 preserves polls and votes while normalizing options into the third required table', () => {
  assert.match(migration, /create table if not exists public\.conference_poll_options/);
  assert.match(migration, /insert into public\.conference_poll_options[\s\S]*jsonb_array_elements\(p\.options\)/);
  assert.match(migration, /alter table public\.conference_poll_votes[\s\S]*add column if not exists option_id uuid/);
  assert.match(migration, /update public\.conference_poll_votes v[\s\S]*set option_id=o\.id/);
  assert.match(migration, /conference_poll_votes_option_id_fkey/);
  assert.match(fkIndex, /conference_poll_votes_option_id_idx[\s\S]*option_id/);
});

test('all four required poll types are server constrained and represented in frontend types', () => {
  for (const type of ['SINGLE_CHOICE', 'MULTIPLE_CHOICE', 'YES_NO', 'TRUE_FALSE']) {
    assert.match(migration, new RegExp(type));
    assert.match(types, new RegExp(type));
    assert.match(edge, new RegExp(type));
  }
  assert.match(migration, /v_options:='\["بله","خیر"\]'::jsonb/);
  assert.match(migration, /v_options:='\["درست","نادرست"\]'::jsonb/);
});

test('poll configuration covers anonymous identified time limit open close and result visibility', () => {
  assert.match(migration, /is_anonymous boolean not null default false/);
  assert.match(migration, /time_limit_seconds integer/);
  assert.match(migration, /opened_at timestamptz/);
  assert.match(migration, /closes_at timestamptz/);
  assert.match(migration, /status in\('DRAFT','OPEN','CLOSED'\)/);
  for (const visibility of ['LIVE', 'AFTER_VOTE', 'AFTER_CLOSE', 'HIDDEN']) {
    assert.match(migration, new RegExp(visibility));
    assert.match(types, new RegExp(visibility));
  }
  assert.match(migration, /time_limit_seconds between 10 and 86400/);
});

test('Presenter receives create permission without receiving global poll management permission', () => {
  assert.match(migration, /values\('PRESENTER','CREATE_POLL'\)/);
  assert.doesNotMatch(
    migration.slice(0, migration.indexOf('alter table public.conference_polls')),
    /values\('PRESENTER','MANAGE_POLLS'\)/,
  );
  assert.match(migration, /p\.created_by=p_user_id[\s\S]*MANAGE_POLLS/);
});

test('authenticated browsers are read-only on poll tables and service role owns mutations', () => {
  for (const table of ['conference_polls', 'conference_poll_options', 'conference_poll_votes']) {
    assert.match(
      migration,
      new RegExp(`revoke all on table public\\.${table} from public,anon,authenticated`),
    );
    assert.match(
      migration,
      new RegExp(`grant select on table public\\.${table} to authenticated,service_role`),
    );
  }
  assert.match(migration, /apply_conference_poll_action[\s\S]*from public,anon,authenticated/i);
  assert.match(migration, /apply_conference_poll_action[\s\S]*to service_role/i);
});

test('poll RLS requires FULL auth and joined room membership', () => {
  assert.match(migration, /conference_polls_full_auth_boundary/);
  assert.match(migration, /conference_poll_options_full_auth_boundary/);
  assert.match(migration, /conference_poll_votes_full_auth_boundary/);
  assert.match(migration, /private\.is_current_session_fully_authorized\(\)/);
  assert.match(migration, /conference_participants cp/);
  assert.match(migration, /cp\.status='joined'/);
});

test('anonymous polls hide raw voter identity even from poll managers', () => {
  assert.match(migration, /not p\.is_anonymous/);
  assert.match(migration, /conference_poll_votes_authorized_select/);
  assert.match(migration, /p_vote_user_id=p_actor_user_id/);
  assert.match(migration, /not p\.is_anonymous[\s\S]*p\.created_by=p_actor_user_id[\s\S]*MANAGE_POLLS/);
  assert.match(migration, /when not p\.is_anonymous[\s\S]*can_manage_conference_poll[\s\S]*'voters'/);
});

test('multiple choice is one atomic submission while repeat submissions are rejected', () => {
  assert.match(migration, /drop constraint if exists conference_poll_votes_poll_id_user_id_key/);
  assert.match(migration, /conference_poll_votes_poll_user_option_key[\s\S]*unique\(poll_id,user_id,option_id\)/);
  assert.match(migration, /if v_poll\.poll_type in\([\s\S]*SINGLE_CHOICE[\s\S]*YES_NO[\s\S]*TRUE_FALSE[\s\S]*v_selected_count<>1/);
  assert.match(migration, /if exists\([\s\S]*conference_poll_votes v[\s\S]*v\.poll_id=v_poll\.id[\s\S]*v\.user_id=p_actor_user_id[\s\S]*already_voted/);
  assert.match(migration, /insert into public\.conference_poll_votes[\s\S]*o\.id=any\(v_selected_ids\)/);
});

test('poll row locking serializes competing vote submissions', () => {
  const voteFunction = migration.slice(
    migration.indexOf('create or replace function private.apply_conference_poll_action'),
  );
  assert.match(voteFunction, /select \* into v_poll[\s\S]*for update/);
  assert.match(voteFunction, /already_voted/);
  assert.match(voteFunction, /revision=revision\+1/);
});

test('time limits use server time and effective status blocks late votes', () => {
  assert.match(migration, /conference_poll_effective_status/);
  assert.match(migration, /p_closes_at<=clock_timestamp\(\)/);
  assert.match(migration, /make_interval\(secs=>v_time_limit\)/);
  assert.match(migration, /poll_closed/);
  assert.match(hardening, /alter function private\.conference_poll_effective_status\(text,timestamptz\)[\s\S]*volatile/);
  assert.match(hook, /snapshot\.serverTime/);
  assert.match(hook, /poll\.closesAt/);
  assert.match(hook, /window\.setTimeout/);
});

test('result visibility is calculated in the server snapshot rather than raw browser aggregation', () => {
  assert.match(migration, /'resultsVisible'/);
  assert.match(migration, /p\.result_visibility='LIVE'/);
  assert.match(migration, /p\.result_visibility='AFTER_VOTE'/);
  assert.match(migration, /p\.result_visibility='AFTER_CLOSE'/);
  assert.match(migration, /'totalVoters'/);
  assert.match(migration, /'voteCount'/);
  assert.doesNotMatch(service, /from\('conference_poll_votes'\)/);
  assert.match(service, /get_conference_poll_snapshot/);
});

test('Realtime refreshes server snapshots for polls options and votes', () => {
  for (const table of ['conference_polls', 'conference_poll_options', 'conference_poll_votes']) {
    assert.match(hook, new RegExp(`table: '${table}'`));
  }
  assert.match(hook, /\(\) => void refresh\(\)/);
  assert.match(migration, /alter publication supabase_realtime[\s\S]*conference_poll_options/);
  assert.match(migration, /revision=revision\+1/);
});

test('edge function enforces FULL auth then authorization then service-role mutation', () => {
  assert.match(edge, /get_my_auth_access_state/);
  assert.match(edge, /accessState\.access_level !== "FULL"/);
  assert.match(edge, /authorize_conference_poll_action/);
  assert.match(edge, /apply_conference_poll_action/);
  for (const action of ['create', 'open', 'close', 'vote', 'delete']) {
    assert.match(edge, new RegExp(`"${action}"`));
  }
});

test('new SFU poll UI supports create vote lifecycle anonymity visibility and multiple selection', () => {
  assert.match(toolbar, /togglePanel\('polls'\)/);
  assert.match(tools, /ConferencePollPanel/);
  assert.match(createForm, /MULTIPLE_CHOICE/);
  assert.match(createForm, /YES_NO/);
  assert.match(createForm, /TRUE_FALSE/);
  assert.match(createForm, /anonymous/);
  assert.match(createForm, /resultVisibility/);
  assert.match(createForm, /timeLimitSeconds/);
  assert.match(createForm, /openImmediately/);
  assert.match(pollCard, /isMultiple/);
  assert.match(pollCard, /ثبت رأی/);
  assert.match(pollCard, /onOpen/);
  assert.match(pollCard, /onClose/);
  assert.match(pollCard, /onDelete/);
  assert.match(panel, /polls\.createPoll/);
});

test('legacy mesh PollPanel is now only a compatibility wrapper over the shared Phase 11 panel', () => {
  assert.match(legacy, /ConferencePollPanel/);
  assert.match(legacy, /useConferenceAuthorization/);
  assert.doesNotMatch(legacy, /\.from\('conference_polls'\)/);
  assert.doesNotMatch(legacy, /\.from\('conference_poll_votes'\)/);
  assert.doesNotMatch(legacy, /\.insert\(|\.update\(|\.delete\(/);
});

test('self-hosted validation probes the Phase 11 poll edge function', () => {
  assert.match(manager, /livekit_function_unauthorized_probe conference-poll-control/);
});
