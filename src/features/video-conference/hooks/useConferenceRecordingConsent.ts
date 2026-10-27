import { useConferenceLiveData } from './useConferenceLiveData';
import { useCallback, useState } from 'react';
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

  useConferenceLiveData(['conference_recordings', 'conference_recording_consents', 'conference_rooms'], refresh, client, roomId, true);

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
