import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  loadMyWaitingState,
  loadWaitingRows,
} from '../services/conferenceRealtime';
import type {
  ConferenceUiState,
  ConferenceWaitingState,
  ConferenceWaitingStatus,
  WaitingRow,
} from '../types/conference.types';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  isManager: boolean;
  uiState: ConferenceUiState;
  onAdmitted: () => void;
  onRejected: () => void;
  onExpired: () => void;
}

const EMPTY_STATE: ConferenceWaitingState = {
  status: null,
  requestedAt: null,
  expiresAt: null,
  resolvedAt: null,
  serverTime: '',
};

export function useWaitingRoom({
  client,
  roomId,
  currentUserId,
  isManager,
  uiState,
  onAdmitted,
  onRejected,
  onExpired,
}: Params) {
  const [waitingRows, setWaitingRows] = useState<WaitingRow[]>([]);
  const [ownState, setOwnState] =
    useState<ConferenceWaitingState>(EMPTY_STATE);
  const settledRef = useRef<ConferenceWaitingStatus | null>(null);

  const onAdmittedRef = useRef(onAdmitted);
  const onRejectedRef = useRef(onRejected);
  const onExpiredRef = useRef(onExpired);
  onAdmittedRef.current = onAdmitted;
  onRejectedRef.current = onRejected;
  onExpiredRef.current = onExpired;

  const handleOwnStatus = useCallback(
    (status: ConferenceWaitingStatus | null) => {
      if (!status || status === 'waiting') {
        settledRef.current = null;
        return;
      }
      if (settledRef.current === status) return;

      settledRef.current = status;
      if (status === 'admitted') onAdmittedRef.current();
      if (status === 'rejected') onRejectedRef.current();
      if (status === 'expired') onExpiredRef.current();
    },
    [],
  );

  const refreshOwnState = useCallback(async () => {
    try {
      const next = await loadMyWaitingState(client, roomId);
      setOwnState(next);
      handleOwnStatus(next.status);
      return next;
    } catch (error) {
      console.error('[VideoConference] waiting room state load failed', error);
      return null;
    }
  }, [client, handleOwnStatus, roomId]);

  const refreshWaitingRows = useCallback(async () => {
    try {
      setWaitingRows(await loadWaitingRows(client, roomId));
    } catch (error) {
      console.error('[VideoConference] waiting room load failed', error);
    }
  }, [client, roomId]);

  useEffect(() => {
    if (uiState !== 'waiting') {
      settledRef.current = null;
      return;
    }

    void refreshOwnState();

    const channel = client
      .channel(`sfu-wait-${roomId}-${currentUserId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conference_waiting_room',
          filter: `room_id=eq.${roomId}`,
        },
        (payload) => {
          const row = payload.new as {
            user_id?: string;
            status?: ConferenceWaitingStatus;
          };
          if (row.user_id !== currentUserId || !row.status) return;
          handleOwnStatus(row.status);
          void refreshOwnState();
        },
      )
      .subscribe();

    const poll = window.setInterval(() => {
      void refreshOwnState();
    }, 5000);

    return () => {
      window.clearInterval(poll);
      void client.removeChannel(channel);
    };
  }, [
    client,
    currentUserId,
    handleOwnStatus,
    refreshOwnState,
    roomId,
    uiState,
  ]);

  useEffect(() => {
    if (!isManager || uiState !== 'connected') {
      setWaitingRows([]);
      return;
    }

    void refreshWaitingRows();

    const channel = client
      .channel(`sfu-host-wait-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conference_waiting_room',
          filter: `room_id=eq.${roomId}`,
        },
        () => void refreshWaitingRows(),
      )
      .subscribe();

    const poll = window.setInterval(() => {
      void refreshWaitingRows();
    }, 15000);

    return () => {
      window.clearInterval(poll);
      void client.removeChannel(channel);
    };
  }, [
    client,
    isManager,
    refreshWaitingRows,
    roomId,
    uiState,
  ]);

  return {
    waitingRows,
    ownState,
    refreshOwnState,
    refreshWaitingRows,
  };
}
