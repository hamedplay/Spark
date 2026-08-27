import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  getConferenceSpeakerTimerSnapshot,
  runConferenceSpeakerTimerAction,
} from '../services/conferenceSpeakerTimer';
import type {
  SpeakerSessionRow,
  SpeakerTimerAction,
  SpeakerTimerSnapshot,
} from '../types/conference.types';

const EMPTY_SNAPSHOT: SpeakerTimerSnapshot = {
  loaded: false,
  serverTime: new Date(0).toISOString(),
  canManage: false,
  sessions: [],
};

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
}

function remainingSeconds(
  session: SpeakerSessionRow,
  synchronizedNowMs: number,
): number {
  if (session.status === 'PAUSED') {
    return Math.max(0, session.allocated_seconds - session.used_seconds);
  }
  if (session.status !== 'ACTIVE' || !session.expires_at) return 0;
  return Math.max(
    0,
    Math.ceil((new Date(session.expires_at).getTime() - synchronizedNowMs) / 1000),
  );
}

export function useConferenceSpeakerTimer({ client, roomId, currentUserId }: Params) {
  const [snapshot, setSnapshot] = useState<SpeakerTimerSnapshot>(EMPTY_SNAPSHOT);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [displayTick, setDisplayTick] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const next = await getConferenceSpeakerTimerSnapshot(client, roomId);
      setSnapshot(next);
      setServerOffsetMs(new Date(next.serverTime).getTime() - Date.now());
    } catch (error) {
      console.error('[VideoConference] speaker timer snapshot failed', error);
      setSnapshot((current) => ({ ...current, loaded: true }));
    }
  }, [client, roomId]);

  useEffect(() => {
    void refresh();

    const channel = client.channel(`speaker-timer-${roomId}-${currentUserId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conference_speaker_sessions',
        filter: `room_id=eq.${roomId}`,
      }, () => void refresh())
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [client, currentUserId, refresh, roomId]);

  useEffect(() => {
    const timer = window.setInterval(() => setDisplayTick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const sessionsByUser = useMemo(() => {
    const result: Record<string, SpeakerSessionRow> = {};
    for (const session of snapshot.sessions) result[session.user_id] = session;
    return result;
  }, [snapshot.sessions]);

  const synchronizedNowMs = displayTick + serverOffsetMs;

  const remainingByUser = useMemo(() => {
    const result: Record<string, number> = {};
    for (const session of snapshot.sessions) {
      result[session.user_id] = remainingSeconds(session, synchronizedNowMs);
    }
    return result;
  }, [snapshot.sessions, synchronizedNowMs]);

  const ownSession = sessionsByUser[currentUserId] ?? null;
  const ownRemainingSeconds = ownSession
    ? remainingSeconds(ownSession, synchronizedNowMs)
    : null;
  const microphoneBlocked = Boolean(
    ownSession && (
      ownSession.status === 'PAUSED'
      || ownSession.status === 'EXPIRED'
      || ownSession.status === 'COMPLETED'
      || (ownSession.status === 'ACTIVE' && ownRemainingSeconds === 0)
    ),
  );

  const runAction = useCallback(async (
    targetUserId: string,
    action: SpeakerTimerAction,
    seconds?: number,
  ) => {
    const result = await runConferenceSpeakerTimerAction(
      client,
      roomId,
      targetUserId,
      action,
      seconds,
    );
    await refresh();
    return result;
  }, [client, refresh, roomId]);

  return {
    ...snapshot,
    sessionsByUser,
    remainingByUser,
    ownSession,
    ownRemainingSeconds,
    microphoneBlocked,
    refresh,
    runAction,
  };
}
