import { useConferenceLiveData } from './useConferenceLiveData';
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

  useConferenceLiveData(['conference_waiting_room','conference_rooms'], refreshOwnState, client, roomId, uiState === 'waiting');
  useConferenceLiveData(['conference_waiting_room','conference_participants'], refreshWaitingRows, client, roomId, isManager && uiState === 'connected');
  useEffect(() => { if (uiState !== 'waiting') settledRef.current = null; }, [uiState]);
  useEffect(() => { if (!isManager || uiState !== 'connected') setWaitingRows([]); }, [isManager, uiState]);

  return {
    waitingRows,
    ownState,
    refreshOwnState,
    refreshWaitingRows,
  };
}
