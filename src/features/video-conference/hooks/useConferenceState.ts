import { useCallback, useState } from 'react';
import { ConnectionQuality } from 'livekit-client';
import type { ConferenceRole, ConferenceUiState } from '../types/conference.types';

export function useConferenceState() {
  const [uiState, setUiState] = useState<ConferenceUiState>('joining');
  const [errorMessage, setErrorMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [role, setRole] = useState<ConferenceRole>('member');
  const [quality, setQuality] = useState<ConnectionQuality | 'unknown'>('unknown');
  const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState<string | null>(null);
  const [reaction, setReaction] = useState<string | null>(null);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  const showReaction = useCallback((emoji: string) => {
    setReaction(emoji);
    window.setTimeout(() => setReaction(null), 2500);
  }, []);

  const fail = useCallback((message: string) => {
    setUiState('failed');
    setErrorMessage(message);
  }, []);

  return {
    uiState,
    setUiState,
    errorMessage,
    setErrorMessage,
    revision,
    role,
    setRole,
    quality,
    setQuality,
    activeSpeakerIdentity,
    setActiveSpeakerIdentity,
    reaction,
    refresh,
    showReaction,
    fail,
  };
}
