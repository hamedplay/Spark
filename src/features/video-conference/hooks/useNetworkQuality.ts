import { useMemo } from 'react';
import { ConnectionQuality } from 'livekit-client';
import type { ConferenceUiState } from '../types/conference.types';

export function useNetworkQuality(
  uiState: ConferenceUiState,
  quality: ConnectionQuality | 'unknown',
) {
  return useMemo(() => {
    if (uiState === 'reconnecting' || uiState === 'failed') return 'Poor';
    if (quality === ConnectionQuality.Excellent) return 'Excellent';
    if (quality === ConnectionQuality.Good) return 'Good';
    if (quality === ConnectionQuality.Poor) return 'Weak';
    if (quality === ConnectionQuality.Lost) return 'Poor';
    return 'Good';
  }, [quality, uiState]);
}
