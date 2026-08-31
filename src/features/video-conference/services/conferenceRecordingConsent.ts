import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import type {
  ConferenceRecordingConsentState,
  ConferenceRecordingConsentStatus,
} from '../types/conference.types';

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object'
    ? value as Record<string, unknown>
    : null;
}

function consentStatus(value: unknown): ConferenceRecordingConsentStatus {
  if (value === 'accepted' || value === 'declined') return value;
  return 'pending';
}

export async function loadConferenceRecordingConsent(
  client: ConferenceSupabaseClient,
  roomId: string,
): Promise<Omit<ConferenceRecordingConsentState, 'busy' | 'errorMessage'>> {
  const { data, error } = await client.rpc(
    'get_conference_recording_consent_state',
    { p_room_id: roomId },
  );
  if (error) throw error;

  const payload = objectValue(data);
  if (!payload || payload.ok !== true) {
    throw new Error(String(payload?.reason || 'RECORDING_CONSENT_LOAD_FAILED'));
  }

  return {
    loaded: true,
    required: payload.required === true,
    recordingEnabled: payload.recordingEnabled === true,
    myStatus: consentStatus(payload.myStatus),
    accepted: payload.accepted === true,
    recordingActive: payload.recordingActive === true,
    policyVersion: Math.max(1, Number(payload.policyVersion || 1)),
  };
}

export async function setConferenceRecordingConsent(
  client: ConferenceSupabaseClient,
  roomId: string,
  accepted: boolean,
) {
  const { data, error } = await client.rpc(
    'set_conference_recording_consent',
    {
      p_room_id: roomId,
      p_consented: accepted,
    },
  );
  if (error) throw error;

  const payload = objectValue(data);
  if (!payload || payload.ok !== true) {
    throw new Error(String(payload?.reason || 'RECORDING_CONSENT_SAVE_FAILED'));
  }

  return payload;
}
