import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  ConferencePhaseAction,
  ConferencePhasePolicy,
  ConferencePhaseSnapshot,
  MeetingPhase,
} from '../types/conference.types';

interface PhaseSnapshotResponse {
  ok?: boolean;
  reason?: string;
  server_time?: string;
  current_phase?: MeetingPhase;
  phase_started_at?: string;
  phase_ends_at?: string | null;
  revision?: number;
  allow_mic?: boolean;
  allow_camera?: boolean;
  allow_chat?: boolean;
  can_manage?: boolean;
}

export async function getConferencePhaseSnapshot(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferencePhaseSnapshot> {
  const { data, error } = await client.rpc('get_conference_phase_snapshot', {
    p_room_id: roomId,
  });
  if (error) throw error;

  const payload = (data || {}) as PhaseSnapshotResponse;
  if (payload.ok !== true || !payload.current_phase || !payload.server_time) {
    throw new Error(String(payload.reason || 'PHASE_SNAPSHOT_FAILED'));
  }

  return {
    loaded: true,
    serverTime: payload.server_time,
    currentPhase: payload.current_phase,
    phaseStartedAt: payload.phase_started_at || payload.server_time,
    phaseEndsAt: payload.phase_ends_at ?? null,
    revision: Number(payload.revision || 0),
    allowMic: payload.allow_mic !== false,
    allowCamera: payload.allow_camera !== false,
    allowChat: payload.allow_chat !== false,
    canManage: payload.can_manage === true,
  };
}

export async function runConferencePhaseAction(
  client: ConferenceSupabaseClient,
  roomId: string,
  action: ConferencePhaseAction,
  durationSeconds?: number,
  policy?: ConferencePhasePolicy,
) {
  const { data, error } = await client.functions.invoke('conference-phase-control', {
    body: {
      roomId,
      action,
      durationSeconds,
      allowMic: policy?.allowMic,
      allowCamera: policy?.allowCamera,
      allowChat: policy?.allowChat,
    },
  });

  if (error || !data?.ok) {
    throw new Error(String(data?.error || error?.message || 'PHASE_ACTION_FAILED'));
  }

  return data;
}
