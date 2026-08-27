import { useCallback, useState } from 'react';
import { ConnectionQuality } from 'livekit-client';
import type {
  ConferenceReactionEvent,
  ConferenceRole,
  ConferenceUiState,
} from '../types/conference.types';

export function useConferenceState() {
  const [uiState, setUiState] = useState<ConferenceUiState>('joining');
  const [errorMessage, setErrorMessage] = useState('');
  const [revision, setRevision] = useState(0);
  const [role, setRole] = useState<ConferenceRole>('member');
  const [quality, setQuality] = useState<ConnectionQuality | 'unknown'>('unknown');
  const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState<string | null>(null);
  const [reactions, setReactions] = useState<ConferenceReactionEvent[]>([]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  const showReaction = useCallback((event: ConferenceReactionEvent) => {
    setReactions((current) => {
      if (current.some((item) => item.id === event.id)) return current;
      return [...current, event].slice(-12);
    });

    window.setTimeout(() => {
      setReactions((current) => current.filter((item) => item.id !== event.id));
    }, 3200);
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
    reactions,
    refresh,
    showReaction,
    fail,
  };
}
