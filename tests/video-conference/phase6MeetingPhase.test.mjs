import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

const migration = read('supabase/migrations/20260827220441_video_conference_phase6_meeting_phase_engine.sql');
const hardening = read('supabase/migrations/20260827221115_video_conference_phase6_server_boundary_hardening.sql');
const types = read('src/features/video-conference/types/conference.types.ts');
const phaseHook = read('src/features/video-conference/hooks/useConferencePhase.ts');
const phaseService = read('src/features/video-conference/services/conferencePhase.ts');
const overlay = read('src/features/video-conference/components/room/MeetingPhaseOverlay.tsx');
const controls = read('src/features/video-conference/components/controls/MeetingPhaseControls.tsx');
const roomPage = read('src/features/video-conference/components/room/ConferenceRoomPage.tsx');
const participantGrid = read('src/features/video-conference/components/participants/ParticipantGrid.tsx');
const participantTile = read('src/features/video-conference/components/LiveKitParticipantTile.tsx');
const chatHook = read('src/features/video-conference/hooks/useConferenceChat.ts');
const phaseControl = read('supabase/functions/conference-phase-control/index.ts');
const phaseEnforcer = read('supabase/functions/conference-phase-enforcer/index.ts');
const manager = read('deploy/spark-cli/lib/install-livekit.sh');

test('meeting phase state machine stores current state on rooms and revisioned history in events', () => {
  for (const phase of ['SCHEDULED', 'WAITING', 'COUNTDOWN', 'LIVE', 'BREAK', 'RESUMING', 'ENDED']) {
    assert.match(migration, new RegExp(`['"]${phase}['"]`));
    assert.match(types, new RegExp(`['"]${phase}['"]`));
  }
  assert.match(migration, /add column if not exists current_phase/);
  assert.match(migration, /add column if not exists phase_revision/);
  assert.match(migration, /create table if not exists public\.conference_phase_events/);
  assert.match(migration, /unique\(room_id,revision\)/i);
});

test('server validates only the required meeting phase transitions', () => {
  for (const [from, to] of [
    ['SCHEDULED', 'WAITING'],
    ['WAITING', 'COUNTDOWN'],
    ['COUNTDOWN', 'LIVE'],
    ['LIVE', 'BREAK'],
    ['BREAK', 'RESUMING'],
    ['RESUMING', 'LIVE'],
  ]) {
    assert.match(
      migration,
      new RegExp(`p_from='${from}'\\s+and p_to='${to}'`),
    );
  }
  assert.match(migration, /p_from<>'ENDED' and p_to='ENDED'/);
  assert.match(migration, /invalid_transition/);
});

test('phase management is permission based and client mutation is edge-authorized then service-role applied', () => {
  assert.match(migration, /values\('MANAGE_PHASE'\)/);
  assert.match(migration, /\('OWNER','MANAGE_PHASE'\)/);
  assert.match(migration, /\('HOST','MANAGE_PHASE'\)/);
  assert.match(migration, /\('CO_HOST','MANAGE_PHASE'\)/);
  assert.match(types, /'MANAGE_PHASE'/);
  assert.match(phaseControl, /authorize_conference_phase_action/);
  assert.match(phaseControl, /apply_livekit_conference_phase_action/);
  assert.match(migration, /apply_livekit_conference_phase_action[\s\S]*to service_role/i);
  assert.match(hardening, /conference_rooms_phase_server_guard/);
  assert.match(hardening, /current_user in \('anon','authenticated'\)/);
});

test('countdown is server authoritative and restricts camera and microphone', () => {
  assert.match(migration, /v_to='COUNTDOWN'/);
  assert.match(migration, /p_duration_seconds<10/);
  assert.match(migration, /p_duration_seconds>3600/);
  assert.match(migration, /v_allow_mic:=false/);
  assert.match(migration, /v_allow_camera:=false/);
  assert.match(migration, /'conference-phase-enforcer'/);
  assert.match(migration, /'1 second'/);
  assert.match(migration, /advance_conference_phase_timers/);
  assert.match(phaseHook, /serverOffsetMs/);
  assert.match(phaseHook, /new Date\(snapshot\.phaseEndsAt\)/);
  assert.doesNotMatch(phaseHook, /\.from\(['"]conference_rooms['"]\)\.update/);
});

test('countdown and resuming remove participant media DOM while the overlay is fullscreen', () => {
  assert.match(phaseHook, /snapshot\.currentPhase === 'COUNTDOWN'/);
  assert.match(phaseHook, /snapshot\.currentPhase === 'RESUMING'/);
  assert.match(roomPage, /!phase\.mediaHidden[\s\S]*<ParticipantGrid/);
  assert.match(overlay, /phase === 'COUNTDOWN'/);
  assert.match(overlay, /absolute inset-0 z-50/);
  assert.match(participantGrid, /LiveKitParticipantTile/);
  assert.match(participantTile, /<audio ref=\{audioRef\} autoPlay/);
  assert.match(participantTile, /track\.detach\(element\)/);
});

test('break has a large server-timed countdown and configurable mic camera chat policy', () => {
  assert.match(migration, /v_to='BREAK'/);
  assert.match(migration, /p_duration_seconds>7200/);
  assert.match(migration, /p_allow_mic/);
  assert.match(migration, /p_allow_camera/);
  assert.match(migration, /p_allow_chat/);
  assert.match(overlay, /phase === 'BREAK'/);
  assert.match(overlay, /text-5xl/);
  assert.match(controls, /allowMic/);
  assert.match(controls, /allowCamera/);
  assert.match(controls, /allowChat/);
  assert.match(controls, /start_break/);
  for (const seconds of ['300', '600', '900', '1800']) {
    assert.match(controls, new RegExp(`value="${seconds}"`));
  }
});

test('countdown controls provide required presets and custom duration', () => {
  assert.match(controls, /start_countdown/);
  for (const seconds of ['30', '60', '300', '600']) {
    assert.match(controls, new RegExp(`value="${seconds}"`));
  }
  assert.match(controls, /زمان سفارشی شمارش معکوس/);
});

test('phase-aware LiveKit policy and runtime enforcement update all connected participants', () => {
  assert.match(migration, /v_current_phase in \('COUNTDOWN','RESUMING'\)/);
  assert.match(migration, /v_current_phase='BREAK'/);
  assert.match(migration, /v_phase_allow_mic/);
  assert.match(migration, /v_phase_allow_camera/);
  assert.match(phaseControl, /roomService\.listParticipants/);
  assert.match(phaseControl, /roomService\.updateParticipant/);
  assert.match(phaseEnforcer, /roomService\.listParticipants/);
  assert.match(phaseEnforcer, /roomService\.updateParticipant/);
  assert.match(phaseEnforcer, /verify_conference_phase_worker_secret/);
});

test('stale runtime events cannot overwrite a newer phase revision', () => {
  assert.match(migration, /v_event\.revision<>v_room\.phase_revision/);
  assert.match(migration, /v_event\.to_phase<>v_room\.current_phase/);
  assert.match(migration, /runtime_sync_status='SUPERSEDED'/);
});

test('chat policy is enforced in UI, RLS, and a database trigger boundary', () => {
  assert.match(chatHook, /phaseAllowsChat/);
  assert.match(chatHook, /phaseAllowsChat[\s\S]*hasConferencePermission/);
  assert.match(migration, /r\.phase_allow_chat=true/);
  assert.match(hardening, /conference_messages_phase_chat_guard/);
  assert.match(hardening, /conference chat is disabled for the current meeting phase/);
});

test('phase state uses realtime room updates only as synchronization, not as source of truth', () => {
  assert.match(phaseHook, /table: 'conference_rooms'/);
  assert.match(phaseHook, /event: 'UPDATE'/);
  assert.match(phaseHook, /getConferencePhaseSnapshot/);
  assert.match(phaseService, /get_conference_phase_snapshot/);
  assert.match(migration, /alter publication supabase_realtime[\s\S]*conference_phase_events/);
});

test('legacy meeting end is integrated with the ENDED phase', () => {
  assert.match(migration, /create or replace function private\.end_conference_room/);
  assert.match(migration, /transition_conference_phase\([\s\S]*'ENDED'/);
  assert.match(migration, /set status='left'/);
});

test('self-hosted manager configures and probes the phase worker functions', () => {
  assert.match(manager, /configure_conference_phase_worker/);
  assert.match(manager, /conference-phase-enforcer/);
  assert.match(manager, /livekit_function_unauthorized_probe conference-phase-control/);
  assert.match(manager, /livekit_function_unauthorized_probe conference-phase-enforcer/);
});
