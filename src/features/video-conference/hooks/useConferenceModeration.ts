import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import { setConferenceParticipantRole } from '../services/conferenceAuthorization';
import { ConferenceRecordingActionError, runHostAction, setRaiseHand, setRecording } from '../services/conferenceApi';
import { loadConferenceParticipants, loadConferenceRoomState } from '../services/conferenceRealtime';
import { runConferenceSpeakerQueueAction } from '../services/conferenceSpeakerQueue';
import type {
  ConferenceAuthorization,
  ConferenceRbacRole,
  ConferenceSpeakerTimerController,
  HostAction,
  ParticipantRow,
  RecordingRow,
  SpeakerQueueAction,
  SpeakerQueueItem,
  SpeakerTimerAction,
} from '../types/conference.types';
import { hasConferencePermission } from '../utils/conferencePermissions';

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
  authorization: ConferenceAuthorization;
  speakerTimer: ConferenceSpeakerTimerController;
  onEnded: () => void;
}

export function useConferenceModeration({
  client,
  roomId,
  currentUserId,
  authorization,
  speakerTimer,
  onEnded,
}: Params) {
  const [participants, setParticipants] = useState<ParticipantRow[]>([]);
  const [raised, setRaised] = useState(false);
  const [locked, setLocked] = useState(false);
  const [recording, setRecordingState] = useState<RecordingRow | null>(null);
  const [recordingError, setRecordingError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

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

  const speakerQueue = useMemo<SpeakerQueueItem[]>(
    () => participants
      .flatMap((participant) => {
        const session = speakerTimer.sessionsByUser[participant.user_id];
        return session?.status === 'QUEUED'
          ? [{ participant, session }]
          : [];
      })
      .sort((left, right) => {
        const leftPosition = left.session.queue_position ?? Number.MAX_SAFE_INTEGER;
        const rightPosition = right.session.queue_position ?? Number.MAX_SAFE_INTEGER;
        if (leftPosition !== rightPosition) return leftPosition - rightPosition;
        return String(left.participant.hand_raised_at || left.session.starts_at)
          .localeCompare(String(right.participant.hand_raised_at || right.session.starts_at));
      }),
    [participants, speakerTimer.sessionsByUser],
  );

  const raisedParticipants = useMemo(
    () => speakerQueue.map((item) => item.participant),
    [speakerQueue],
  );

  const toggleRaise = useCallback(async () => {
    const next = !raised;
    setBusy('raise');
    try {
      await setRaiseHand(roomId, next, client);
      await Promise.all([
        speakerTimer.refresh(),
        refreshParticipants(),
      ]);
    } catch (error) {
      console.error('[VideoConference] raise hand failed', error);
    } finally {
      setBusy(null);
    }
  }, [client, raised, refreshParticipants, roomId, speakerTimer]);

  const hostAction = useCallback(async (action: HostAction, targetUserId?: string) => {
    setBusy(`${action}:${targetUserId || ''}`);
    try {
      await runHostAction(roomId, action, targetUserId, client);
      if (action === 'lock') setLocked(true);
      if (action === 'unlock') setLocked(false);
      if (action === 'end') onEnded();
      await Promise.all([
        refreshParticipants(),
        refreshRoomState(),
        speakerTimer.refresh(),
      ]);
    } catch (error) {
      console.error('[VideoConference] host action failed', { action, error });
    } finally {
      setBusy(null);
    }
  }, [client, onEnded, refreshParticipants, refreshRoomState, roomId, speakerTimer]);

  const changeRole = useCallback(async (targetUserId: string, role: ConferenceRbacRole) => {
    setBusy(`role:${targetUserId}`);
    try {
      await setConferenceParticipantRole(client, roomId, targetUserId, role);
      await Promise.all([
        refreshParticipants(),
        speakerTimer.refresh(),
      ]);
    } catch (error) {
      console.error('[VideoConference] role change failed', { targetUserId, role, error });
    } finally {
      setBusy(null);
    }
  }, [client, refreshParticipants, roomId, speakerTimer]);

  const timerAction = useCallback(async (
    targetUserId: string,
    action: SpeakerTimerAction,
    seconds?: number,
  ) => {
    setBusy(`timer:${targetUserId}:${action}`);
    try {
      await speakerTimer.runAction(targetUserId, action, seconds);
      await refreshParticipants();
    } catch (error) {
      console.error('[VideoConference] speaker timer action failed', {
        targetUserId,
        action,
        error,
      });
    } finally {
      setBusy(null);
    }
  }, [refreshParticipants, speakerTimer]);

  const queueAction = useCallback(async (
    targetUserId: string,
    action: SpeakerQueueAction,
    seconds?: number,
  ) => {
    setBusy(`queue:${targetUserId}:${action}`);
    try {
      await runConferenceSpeakerQueueAction(
        client,
        roomId,
        targetUserId,
        action,
        seconds,
      );
      await Promise.all([
        speakerTimer.refresh(),
        refreshParticipants(),
      ]);
    } catch (error) {
      console.error('[VideoConference] speaker queue action failed', {
        targetUserId,
        action,
        error,
      });
    } finally {
      setBusy(null);
    }
  }, [client, refreshParticipants, roomId, speakerTimer]);

  const toggleRecording = useCallback(async () => {
    setBusy('recording');
    setRecordingError('');
    try {
      await setRecording(roomId, recording ? 'stop' : 'start', client);
      await refreshRoomState();
    } catch (error) {
      console.error('[VideoConference] recording action failed', error);
      if (
        error instanceof ConferenceRecordingActionError
        && error.code === 'RECORDING_CONSENT_REQUIRED'
      ) {
        setRecordingError(
          error.missingConsentCount > 0
            ? `برای شروع ضبط، رضایت ${error.missingConsentCount} نفر از افراد حاضر هنوز ثبت نشده است.`
            : 'برای شروع ضبط، رضایت همه افراد حاضر باید ثبت شود.',
        );
      } else if (
        error instanceof ConferenceRecordingActionError
        && error.code === 'RECORDING_DISABLED'
      ) {
        setRecordingError('ضبط برای این جلسه فعال نشده است.');
      } else {
        setRecordingError('عملیات ضبط انجام نشد. وضعیت Egress را دوباره بررسی کنید.');
      }
    } finally {
      setBusy(null);
    }
  }, [client, recording, refreshRoomState, roomId]);

  return {
    participants,
    raised,
    locked,
    recording,
    recordingError,
    busy,
    raisedParticipants,
    speakerQueue,
    refreshParticipants,
    refreshRoomState,
    toggleRaise,
    hostAction,
    changeRole,
    timerAction,
    queueAction,
    speakerSessionsByUser: speakerTimer.sessionsByUser,
    speakerRemainingByUser: speakerTimer.remainingByUser,
    toggleRecording,
    canMuteOthers: hasConferencePermission(authorization, 'MUTE_OTHERS'),
    canRemoveParticipants: hasConferencePermission(authorization, 'REMOVE_PARTICIPANT'),
    canManageRoles: hasConferencePermission(authorization, 'MANAGE_ROLES'),
    canManageTimer: hasConferencePermission(authorization, 'MANAGE_TIMER'),
    canStartRecording: hasConferencePermission(authorization, 'START_RECORDING'),
    canStopRecording: hasConferencePermission(authorization, 'STOP_RECORDING'),
    canLockRoom: hasConferencePermission(authorization, 'LOCK_ROOM'),
    canEndMeeting: hasConferencePermission(authorization, 'END_MEETING'),
  };
}
