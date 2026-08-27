import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  SpeakerSessionRow,
  SpeakerTimerAction,
  SpeakerTimerSnapshot,
} from '../types/conference.types';

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function parseSession(value: unknown): SpeakerSessionRow | null {
  const row = asObject(value);
  if (!row || typeof row.id !== 'string' || typeof row.user_id !== 'string') return null;
  return row as unknown as SpeakerSessionRow;
}

export async function getConferenceSpeakerTimerSnapshot(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<SpeakerTimerSnapshot> {
  const { data, error } = await client.rpc('get_conference_speaker_timer_snapshot', {
    p_room_id: roomId,
  });
  if (error) throw error;

  const payload = asObject(data);
  if (!payload || payload.ok !== true) {
    return {
      loaded: true,
      serverTime: new Date().toISOString(),
      canManage: false,
      sessions: [],
    };
  }

  const rawSessions = Array.isArray(payload.sessions) ? payload.sessions : [];
  return {
    loaded: true,
    serverTime: typeof payload.server_time === 'string'
      ? payload.server_time
      : new Date().toISOString(),
    canManage: payload.can_manage === true,
    sessions: rawSessions.map(parseSession).filter((item): item is SpeakerSessionRow => item !== null),
  };
}

export async function runConferenceSpeakerTimerAction(
  client: ConferenceSupabaseClient,
  roomId: string,
  targetUserId: string,
  action: SpeakerTimerAction,
  seconds?: number,
) {
  const { data, error } = await client.functions.invoke('conference-speaker-timer-control', {
    body: {
      roomId,
      targetUserId,
      action,
      seconds,
    },
  });

  if (error || !data?.ok) {
    throw new Error(String(data?.error || error?.message || 'SPEAKER_TIMER_ACTION_FAILED'));
  }

  return data;
}
