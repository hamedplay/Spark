import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  getConferencePhaseSnapshot,
  runConferencePhaseAction,
} from '../services/conferencePhase';
import type {
  ConferencePhaseAction,
  ConferencePhasePolicy,
  ConferencePhaseSnapshot,
  MeetingPhase,
} from '../types/conference.types';

const EMPTY_PHASE: ConferencePhaseSnapshot = {
  loaded: false,
  serverTime: new Date(0).toISOString(),
  currentPhase: 'LIVE',
  phaseStartedAt: new Date(0).toISOString(),
  phaseEndsAt: null,
  revision: 0,
  allowMic: true,
  allowCamera: true,
  allowChat: true,
  canManage: false,
};

interface Params {
  client: ConferenceSupabaseClient;
  roomId: string;
  currentUserId: string;
}

export function calculateConferencePhaseRemainingSeconds(
  phaseEndsAt: string | null,
  synchronizedNowMs: number,
): number | null {
  if (!phaseEndsAt) return null;
  return Math.max(
    0,
    Math.ceil(
      (new Date(phaseEndsAt).getTime() - synchronizedNowMs) / 1000,
    ),
  );
}

export function conferencePhaseHidesMedia(
  phase: MeetingPhase,
): boolean {
  return phase === 'COUNTDOWN' || phase === 'RESUMING';
}

export function useConferencePhase({ client, roomId, currentUserId }: Params) {
  const [snapshot, setSnapshot] = useState<ConferencePhaseSnapshot>(EMPTY_PHASE);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [displayTick, setDisplayTick] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getConferencePhaseSnapshot(client, roomId);
      setSnapshot(next);
      setServerOffsetMs(new Date(next.serverTime).getTime() - Date.now());
    } catch (error) {
      console.error('[VideoConference] phase snapshot failed', error);
      setSnapshot((current) => ({ ...current, loaded: true }));
    }
  }, [client, roomId]);

  useEffect(() => {
    void refresh();

    const channel = client.channel(`conference-phase-${roomId}-${currentUserId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conference_rooms',
        filter: `id=eq.${roomId}`,
      }, () => void refresh())
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [client, currentUserId, refresh, roomId]);

  useEffect(() => {
    const timer = window.setInterval(() => setDisplayTick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);

  const synchronizedNowMs = displayTick + serverOffsetMs;
  const remainingSeconds = useMemo(
    () => calculateConferencePhaseRemainingSeconds(
      snapshot.phaseEndsAt,
      synchronizedNowMs,
    ),
    [snapshot.phaseEndsAt, synchronizedNowMs],
  );

  useEffect(() => {
    const timerExpired = remainingSeconds === 0
      && snapshot.phaseEndsAt !== null
      && (
        snapshot.currentPhase === 'COUNTDOWN'
        || snapshot.currentPhase === 'BREAK'
        || snapshot.currentPhase === 'RESUMING'
      );

    if (!timerExpired) return;

    let cancelled = false;
    let timeout: number | null = null;
    let attempts = 0;

    const reconcile = async () => {
      if (cancelled) return;

      await refresh();
      attempts += 1;

      if (!cancelled && attempts < 10) {
        timeout = window.setTimeout(() => {
          void reconcile();
        }, 1000);
      }
    };

    timeout = window.setTimeout(() => {
      void reconcile();
    }, 500);

    return () => {
      cancelled = true;
      if (timeout !== null) {
        window.clearTimeout(timeout);
      }
    };
  }, [
    refresh,
    remainingSeconds,
    snapshot.currentPhase,
    snapshot.phaseEndsAt,
  ]);

  const mediaHidden = conferencePhaseHidesMedia(snapshot.currentPhase);

  const runAction = useCallback(async (
    action: ConferencePhaseAction,
    durationSeconds?: number,
    policy?: ConferencePhasePolicy,
  ) => {
    setBusy(true);
    try {
      const result = await runConferencePhaseAction(
        client,
        roomId,
        action,
        durationSeconds,
        policy,
      );
      await refresh();
      return result;
    } finally {
      setBusy(false);
    }
  }, [client, refresh, roomId]);

  return {
    ...snapshot,
    remainingSeconds,
    mediaHidden,
    busy,
    refresh,
    runAction,
  };
}
