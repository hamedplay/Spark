import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  ConferencePollAction,
  ConferencePollItem,
  ConferencePollSnapshot,
  ConferencePollType,
  ConferencePollResultVisibility,
} from '../types/conference.types';

export class ConferencePollActionError extends Error {
  code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ConferencePollActionError';
    this.code = code;
  }
}

interface CreatePollInput {
  roomId: string;
  question: string;
  pollType: ConferencePollType;
  options: string[];
  anonymous: boolean;
  resultVisibility: ConferencePollResultVisibility;
  timeLimitSeconds: number | null;
  openImmediately: boolean;
}

interface PollActionInput {
  roomId: string;
  action: Exclude<ConferencePollAction, 'create' | 'vote'>;
  pollId: string;
}

interface VotePollInput {
  roomId: string;
  action: 'vote';
  pollId: string;
  optionIds: string[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function asPolls(value: unknown): ConferencePollItem[] {
  return Array.isArray(value) ? value as ConferencePollItem[] : [];
}

export async function loadConferencePollSnapshot(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<ConferencePollSnapshot> {
  const { data, error } = await client.rpc('get_conference_poll_snapshot', {
    p_room_id: roomId,
  });
  if (error) throw error;

  const payload = asObject(data);
  if (!payload || payload.ok !== true) {
    throw new Error(String(payload?.reason || 'POLL_SNAPSHOT_FAILED'));
  }

  return {
    loaded: true,
    serverTime: typeof payload.serverTime === 'string'
      ? payload.serverTime
      : new Date().toISOString(),
    canCreate: payload.canCreate === true,
    canVote: payload.canVote === true,
    polls: asPolls(payload.polls),
  };
}

export async function runConferencePollAction(
  client: ConferenceSupabaseClient,
  input: CreatePollInput | PollActionInput | VotePollInput,
) {
  const { data, error } = await client.functions.invoke(
    'conference-poll-control',
    { body: input },
  );

  if (error || !data?.ok) {
    throw new ConferencePollActionError(
      String(data?.error || error?.message || 'POLL_ACTION_FAILED'),
    );
  }

  return data;
}
