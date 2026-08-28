import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  ConferencePollActionError,
  loadConferencePollSnapshot,
  runConferencePollAction,
} from '../services/conferencePolls';
import type {
  ConferenceAuthorization,
  ConferencePollItem,
  ConferencePollResultVisibility,
  ConferencePollSnapshot,
  ConferencePollType,
} from '../types/conference.types';
import { hasConferencePermission } from '../utils/conferencePermissions';

const EMPTY_SNAPSHOT: ConferencePollSnapshot = {
  loaded: false,
  serverTime: new Date(0).toISOString(),
  canCreate: false,
  canVote: false,
  polls: [],
};

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  authorization: ConferenceAuthorization;
}

interface CreateInput {
  question: string;
  pollType: ConferencePollType;
  options: string[];
  anonymous: boolean;
  resultVisibility: ConferencePollResultVisibility;
  timeLimitSeconds: number | null;
  openImmediately: boolean;
}

function errorLabel(error: unknown): string {
  if (error instanceof ConferencePollActionError) {
    if (error.code === 'ALREADY_VOTED') return 'رأی شما قبلاً ثبت شده است.';
    if (error.code === 'POLL_CLOSED') return 'این نظرسنجی بسته شده است.';
    if (error.code === 'POLL_NOT_DRAFT') return 'این نظرسنجی دیگر در حالت پیش‌نویس نیست.';
    if (error.code === 'FORBIDDEN') return 'دسترسی لازم برای این عملیات را ندارید.';
    if (error.code === 'POLL_LIMIT_REACHED') return 'حداکثر تعداد نظرسنجی‌های این جلسه ثبت شده است.';
  }
  return 'عملیات نظرسنجی انجام نشد. دوباره تلاش کنید.';
}

export function useConferencePolls({
  client,
  roomId,
  currentUserId,
  authorization,
}: Params) {
  const [snapshot, setSnapshot] = useState<ConferencePollSnapshot>(EMPTY_SNAPSHOT);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const canUse = authorization.loaded && (
    hasConferencePermission(authorization, 'VOTE_POLL')
    || hasConferencePermission(authorization, 'CREATE_POLL')
    || hasConferencePermission(authorization, 'MANAGE_POLLS')
  );

  const refresh = useCallback(async () => {
    if (!canUse) {
      setSnapshot({ ...EMPTY_SNAPSHOT, loaded: true });
      return;
    }

    try {
      setSnapshot(await loadConferencePollSnapshot(client, roomId));
    } catch (error) {
      console.error('[VideoConference] poll snapshot failed', error);
    }
  }, [canUse, client, roomId]);

  useEffect(() => {
    void refresh();
    if (!canUse) return undefined;

    const channel = client
      .channel(`conference-polls-${roomId}-${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_polls',
        filter: `room_id=eq.${roomId}`,
      }, () => void refresh())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_poll_options',
        filter: `room_id=eq.${roomId}`,
      }, () => void refresh())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_poll_votes',
        filter: `room_id=eq.${roomId}`,
      }, () => void refresh())
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [canUse, client, currentUserId, refresh, roomId]);

  useEffect(() => {
    if (!snapshot.loaded) return undefined;

    const serverNow = Date.parse(snapshot.serverTime);
    const nearest = snapshot.polls
      .filter((poll) => poll.status === 'OPEN' && poll.closesAt)
      .map((poll) => Date.parse(poll.closesAt as string))
      .filter((value) => Number.isFinite(value) && value > serverNow)
      .sort((a, b) => a - b)[0];

    if (!nearest) return undefined;

    const timer = window.setTimeout(
      () => void refresh(),
      Math.max(100, nearest - serverNow + 150),
    );
    return () => window.clearTimeout(timer);
  }, [refresh, snapshot]);

  const run = useCallback(async (
    key: string,
    action: () => Promise<unknown>,
  ) => {
    if (busy) return false;
    setBusy(key);
    setErrorMessage('');
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      console.error('[VideoConference] poll action failed', error);
      setErrorMessage(errorLabel(error));
      return false;
    } finally {
      setBusy(null);
    }
  }, [busy, refresh]);

  const createPoll = useCallback((input: CreateInput) => run(
    'create',
    () => runConferencePollAction(client, { roomId, ...input }),
  ), [client, roomId, run]);

  const openPoll = useCallback((pollId: string) => run(
    `open:${pollId}`,
    () => runConferencePollAction(client, { roomId, action: 'open', pollId }),
  ), [client, roomId, run]);

  const closePoll = useCallback((pollId: string) => run(
    `close:${pollId}`,
    () => runConferencePollAction(client, { roomId, action: 'close', pollId }),
  ), [client, roomId, run]);

  const deletePoll = useCallback((pollId: string) => run(
    `delete:${pollId}`,
    () => runConferencePollAction(client, { roomId, action: 'delete', pollId }),
  ), [client, roomId, run]);

  const votePoll = useCallback((
    poll: ConferencePollItem,
    optionIds: string[],
  ) => run(
    `vote:${poll.id}`,
    () => runConferencePollAction(client, {
      roomId,
      action: 'vote',
      pollId: poll.id,
      optionIds,
    }),
  ), [client, roomId, run]);

  const openCount = useMemo(
    () => snapshot.polls.filter((poll) => poll.status === 'OPEN').length,
    [snapshot.polls],
  );

  return {
    ...snapshot,
    canUse,
    openCount,
    busy,
    errorMessage,
    refresh,
    createPoll,
    openPoll,
    closePoll,
    deletePoll,
    votePoll,
  };
}
