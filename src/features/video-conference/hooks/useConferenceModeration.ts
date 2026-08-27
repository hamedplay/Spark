import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import { runHostAction, setRaiseHand, setRecording } from '../services/conferenceApi';
import { loadConferenceParticipants, loadConferenceRoomState } from '../services/conferenceRealtime';
import type { ConferenceRole, HostAction, ParticipantRow, RecordingRow } from '../types/conference.types';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  role: ConferenceRole;
  onEnded: () => void;
}

export function useConferenceModeration({ client, roomId, currentUserId, role, onEnded }: Params) {
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [raised, setRaised] = useState(false);
  const [locked, setLocked] = useState(false);
  const [recording, setRecordingState] = useState<RecordingRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const isManager = role === 'host' || role === 'admin' || role === 'moderator';

  const refreshParticipants = useCallback(async () => {
    try {
      const rows = await loadConferenceParticipants(client, roomId);
      setParticipants(rows);
      setRaised(Boolean(rows.find((row) => row.user_id === currentUserId)?.is_hand_raised));
    } catch (error) {
      console.error('[VideoConference] participant load failed', error);
    }
  }, [client, currentUserId, roomId]);

  const refreshRoomState = useCallback(async () => {
    try {
      const roomState = await loadConferenceRoomState(client, roomId);
      if (roomState.locked !== undefined) setLocked(roomState.locked);
      setRecordingState(roomState.recording);
    } catch (error) {
      console.error('[VideoConference] room state load failed', error);
    }
  }, [client, roomId]);

  useEffect(() => {
    void refreshParticipants();
    void refreshRoomState();
  }, [refreshParticipants, refreshRoomState]);

  const raisedParticipants = useMemo(
    () => participants
      .filter((participant) => participant.is_hand_raised)
      .sort((a, b) => String(a.hand_raised_at).localeCompare(String(b.hand_raised_at))),
    [participants],
  );

  const toggleRaise = useCallback(async () => {
    const next = !raised;
    setBusy('raise');
    try {
      await setRaiseHand(roomId, next, client);
      setRaised(next);
    } catch (error) {
      console.error('[VideoConference] raise hand failed', error);
    } finally {
      setBusy(null);
    }
  }, [client, raised, roomId]);

  const hostAction = useCallback(async (action: HostAction, targetUserId?: string) => {
    setBusy(`${action}:${targetUserId || ''}`);
    try {
      await runHostAction(roomId, action, targetUserId, client);
      if (action === 'lock') setLocked(true);
      if (action === 'unlock') setLocked(false);
      if (action === 'end') onEnded();
      await refreshParticipants();
      await refreshRoomState();
    } catch (error) {
      console.error('[VideoConference] host action failed', { action, error });
    } finally {
      setBusy(null);
    }
  }, [client, onEnded, refreshParticipants, refreshRoomState, roomId]);

  const toggleRecording = useCallback(async () => {
    setBusy('recording');
    try {
      await setRecording(roomId, recording ? 'stop' : 'start', client);
      await refreshRoomState();
    } catch (error) {
      console.error('[VideoConference] recording action failed', error);
    } finally {
      setBusy(null);
    }
  }, [client, recording, refreshRoomState, roomId]);

  return {
    participants,
    raised,
    locked,
    recording,
    busy,
    isManager,
    raisedParticipants,
    refreshParticipants,
    refreshRoomState,
    toggleRaise,
    hostAction,
    toggleRecording,
  };
}
