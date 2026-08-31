import { useCallback, useEffect, useState } from 'react';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import {
  loadConferenceRecordingConsent,
  setConferenceRecordingConsent,
} from '../services/conferenceRecordingConsent';
import type {
  ConferenceRecordingConsentController,
  ConferenceRecordingConsentState,
} from '../types/conference.types';

const EMPTY: ConferenceRecordingConsentState = {
  loaded: false,
  required: false,
  recordingEnabled: false,
  myStatus: 'pending',
  accepted: false,
  recordingActive: false,
  policyVersion: 1,
  busy: false,
  errorMessage: '',
};

export function useConferenceRecordingConsent(
  client: ConferenceSupabaseClient,
  roomId: string,
): ConferenceRecordingConsentController {
  const [state, setState] = useState<ConferenceRecordingConsentState>(EMPTY);

  const refresh = useCallback(async () => {
    try {
      const next = await loadConferenceRecordingConsent(client, roomId);
      setState((current) => ({
        ...current,
        ...next,
        errorMessage: '',
      }));
    } catch (error) {
      console.error('[VideoConference] recording consent load failed', error);
      setState((current) => ({
        ...current,
        loaded: true,
        errorMessage: 'دریافت وضعیت رضایت ضبط ناموفق بود.',
      }));
    }
  }, [client, roomId]);

  useEffect(() => {
    void refresh();

    const channel = client
      .channel(`conference-recording-consent-${roomId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conference_recordings',
          filter: `room_id=eq.${roomId}`,
        },
        () => void refresh(),
      )
      .subscribe();

    const timer = window.setInterval(() => void refresh(), 5000);
    return () => {
      window.clearInterval(timer);
      void client.removeChannel(channel);
    };
  }, [client, refresh, roomId]);

  const setConsent = useCallback(async (accepted: boolean) => {
    if (state.busy) return false;

    setState((current) => ({
      ...current,
      busy: true,
      errorMessage: '',
    }));

    try {
      await setConferenceRecordingConsent(client, roomId, accepted);
      await refresh();
      return true;
    } catch (error) {
      console.error('[VideoConference] recording consent save failed', error);
      setState((current) => ({
        ...current,
        errorMessage: 'ثبت رضایت ضبط ناموفق بود.',
      }));
      return false;
    } finally {
      setState((current) => ({
        ...current,
        busy: false,
      }));
    }
  }, [client, refresh, roomId, state.busy]);

  return {
    ...state,
    refresh,
    setConsent,
  };
}
