import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  ConferenceSpotlightItem,
  ConferenceSpotlightSnapshot,
} from '../types/conference.types';

export class ConferenceSpotlightActionError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ConferenceSpotlightActionError';
    this.code = code;
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

export async function loadConferenceSpotlightSnapshot(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferenceSpotlightSnapshot> {
  const { data, error } = await client.rpc(
    'get_conference_spotlight_snapshot',
    { p_room_id: roomId },
  );
  if (error) throw error;

  const payload = asObject(data);
  if (!payload || payload.ok !== true) {
    throw new ConferenceSpotlightActionError(
      String(payload?.reason || 'SPOTLIGHT_LOAD_FAILED').toUpperCase(),
    );
  }

  return {
    loaded: true,
    serverTime: typeof payload.serverTime === 'string'
      ? payload.serverTime
      : new Date().toISOString(),
    canManage: payload.canManage === true,
    items: Array.isArray(payload.items)
      ? payload.items as ConferenceSpotlightItem[]
      : [],
  };
}

export async function manageConferenceSpotlight(
  client: ConferenceSupabaseClient,
  roomId: string,
  action: 'add' | 'remove' | 'clear',
  targetUserId: string | null = null,
) {
  const { data, error } = await client.rpc(
    'manage_conference_spotlight',
    {
      p_room_id: roomId,
      p_target_user_id: targetUserId,
      p_action: action,
    },
  );

  if (error || !data?.ok) {
    throw new ConferenceSpotlightActionError(
      String(data?.reason || error?.message || 'SPOTLIGHT_ACTION_FAILED')
        .toUpperCase(),
    );
  }

  return data;
}
