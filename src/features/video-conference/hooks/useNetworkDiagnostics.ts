import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectionQuality, type Room } from 'livekit-client';
import {
  collectConferenceNetworkDiagnostics,
} from '../services/conferenceDiagnostics';
import type {
  ConferenceNetworkDiagnostics,
  ConferenceNetworkDiagnosticsController,
  ConferenceUiState,
} from '../types/conference.types';

const EMPTY_DIAGNOSTICS: ConferenceNetworkDiagnostics = {
  sampledAt: '',
  health: 'GOOD',
  connectionQuality: 'unknown',
  rttMs: null,
  packetLossPercent: null,
  jitterMs: null,
  bitrateKbps: 0,
  codecs: [],
  resolution: null,
  fps: null,
  iceState: 'unknown',
  candidateType: 'unknown',
  remoteCandidateType: 'unknown',
  transportProtocol: null,
  relayProtocol: null,
  turnInUse: false,
  reconnectCount: 0,
  tracks: [],
};

export function useNetworkDiagnostics(
  room: Room | null,
  uiState: ConferenceUiState,
  quality: ConnectionQuality | 'unknown',
  reconnectCount: number,
  revision: number,
): ConferenceNetworkDiagnosticsController {
  const [diagnostics, setDiagnostics] = useState<ConferenceNetworkDiagnostics>(
    EMPTY_DIAGNOSTICS,
  );
  const collectingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!room || collectingRef.current) return;

    collectingRef.current = true;
    try {
      setDiagnostics(await collectConferenceNetworkDiagnostics(
        room,
        uiState,
        quality,
        reconnectCount,
      ));
    } catch (error) {
      console.debug('[VideoConference] network diagnostics sample skipped', error);
    } finally {
      collectingRef.current = false;
    }
  }, [quality, reconnectCount, room, uiState]);

  useEffect(() => {
    void revision;
    if (!room) {
      setDiagnostics({
        ...EMPTY_DIAGNOSTICS,
        reconnectCount,
      });
      return undefined;
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => window.clearInterval(timer);
  }, [reconnectCount, refresh, revision, room]);

  return { diagnostics, refresh };
}
