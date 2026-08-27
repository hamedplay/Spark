import { useCallback, useEffect, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import { loadWaitingRows } from '../services/conferenceRealtime';
import type { ConferenceUiState, WaitingRow } from '../types/conference.types';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  isManager: boolean;
  uiState: ConferenceUiState;
  onAdmitted: () => void;
  onRejected: () => void;
}

export function useWaitingRoom({ client, roomId, currentUserId, isManager, uiState, onAdmitted, onRejected }: Params) {
  const [waitingRows, setWaitingRows] = useState<WaitingRow[]>([]);

  const refreshWaitingRows = useCallback(async () => {
    try {
      setWaitingRows(await loadWaitingRows(client, roomId));
    } catch (error) {
      console.error('[VideoConference] waiting room load failed', error);
    }
  }, [client, roomId]);

  useEffect(() => {
    if (uiState !== 'waiting') return;
    const channel = client.channel(`sfu-wait-${roomId}-${currentUserId}`)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'conference_waiting_room', filter: `room_id=eq.${roomId}`,
      }, (payload) => {
        const row = payload.new as { user_id?: string; status?: string };
        if (row.user_id !== currentUserId) return;
        if (row.status === 'admitted') onAdmitted();
        if (row.status === 'rejected') onRejected();
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, currentUserId, onAdmitted, onRejected, roomId, uiState]);

  useEffect(() => {
    if (!isManager || uiState !== 'connected') return;
    void refreshWaitingRows();
    const channel = client.channel(`sfu-host-wait-${roomId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'conference_waiting_room', filter: `room_id=eq.${roomId}`,
      }, () => void refreshWaitingRows())
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, isManager, refreshWaitingRows, roomId, uiState]);

  return { waitingRows, refreshWaitingRows };
}
