import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  ConferenceSpotlightActionError,
  loadConferenceSpotlightSnapshot,
  manageConferenceSpotlight,
} from '../services/conferenceSpotlights';
import type {
  ConferenceAuthorization,
  ConferenceSpotlightSnapshot,
} from '../types/conference.types';

const EMPTY: ConferenceSpotlightSnapshot = {
  loaded: false,
  serverTime: '',
  canManage: false,
  items: [],
};

function errorLabel(error: unknown): string {
  if (error instanceof ConferenceSpotlightActionError) {
    if (error.code === 'FORBIDDEN') {
      return 'دسترسی لازم برای Spotlight را ندارید.';
    }
    if (error.code === 'PARTICIPANT_NOT_FOUND') {
      return 'شرکت‌کننده دیگر در جلسه حضور ندارد.';
    }
  }
  return 'تغییر Spotlight انجام نشد.';
}

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  authorization: ConferenceAuthorization;
}

export function useConferenceSpotlights({
  client,
  roomId,
  currentUserId,
  authorization,
}: Params) {
  const [snapshot, setSnapshot] =
    useState<ConferenceSpotlightSnapshot>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState('');

  const canUse = authorization.loaded && authorization.role !== null;

  const refresh = useCallback(async () => {
    if (!canUse) {
      setSnapshot({ ...EMPTY, loaded: true });
      return;
    }

    try {
      setSnapshot(await loadConferenceSpotlightSnapshot(client, roomId));
      setErrorMessage('');
    } catch (error) {
      console.error('[VideoConference] spotlight snapshot failed', error);
      setErrorMessage(errorLabel(error));
    }
  }, [canUse, client, roomId]);

  useEffect(() => {
    void refresh();
    if (!canUse) return undefined;

    const channel = client
      .channel(`conference-spotlights-${roomId}-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conference_spotlights',
          filter: `room_id=eq.${roomId}`,
        },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      void client.removeChannel(channel);
    };
  }, [canUse, client, currentUserId, refresh, roomId]);

  const spotlightedUserIds = useMemo(
    () => snapshot.items.map((item) => item.userId),
    [snapshot.items],
  );

  const run = useCallback(async (
    key: string,
    action: 'add' | 'remove' | 'clear',
    targetUserId: string | null,
  ) => {
    if (busy) return false;
    setBusy(key);
    setErrorMessage('');

    try {
      await manageConferenceSpotlight(
        client,
        roomId,
        action,
        targetUserId,
      );
      await refresh();
      return true;
    } catch (error) {
      console.error('[VideoConference] spotlight action failed', {
        action,
        targetUserId,
        error,
      });
      setErrorMessage(errorLabel(error));
      return false;
    } finally {
      setBusy(null);
    }
  }, [busy, client, refresh, roomId]);

  const toggle = useCallback((userId: string) => {
    const active = spotlightedUserIds.includes(userId);
    return run(
      `${active ? 'remove' : 'add'}:${userId}`,
      active ? 'remove' : 'add',
      userId,
    );
  }, [run, spotlightedUserIds]);

  const clear = useCallback(
    () => run('clear', 'clear', null),
    [run],
  );

  return {
    ...snapshot,
    spotlightedUserIds,
    busy,
    errorMessage,
    refresh,
    toggle,
    clear,
  };
}
