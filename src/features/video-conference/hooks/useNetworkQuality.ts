import { useMemo } from 'react';
import { ConnectionQuality } from 'livekit-client';
import type { ConferenceUiState } from '../types/conference.types';

export function useNetworkQuality(uiState: ConferenceUiState, quality: ConnectionQuality | 'unknown') {
  return useMemo(() => {
    if (uiState === 'reconnecting') return 'در حال اتصال مجدد';
    if (quality === ConnectionQuality.Poor) return 'شبکه ضعیف';
    return 'متصل';
  }, [quality, uiState]);
}
