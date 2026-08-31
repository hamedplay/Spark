import { useCallback, useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import {
  DEFAULT_MEDIA_QUALITY_SETTINGS,
  PROFILE_RECOMMENDED_CAMERA,
  applyLocalConferenceCameraQuality,
  applyRemoteConferenceMediaQuality,
  loadConferenceMediaQualitySettings,
  saveConferenceMediaQualitySettings,
} from '../services/conferenceMediaQuality';
import type {
  ConferenceCameraQuality,
  ConferenceMediaQualityController,
  ConferenceMediaQualityProfile,
  ConferenceMediaQualitySettings,
  ConferenceScreenShareQuality,
} from '../types/conference.types';

export function useConferenceMediaQuality(
  room: Room | null,
  revision: number,
  focusIdentity: string | null,
): ConferenceMediaQualityController {
  const [settings, setSettings] = useState<ConferenceMediaQualitySettings>(
    () => loadConferenceMediaQualitySettings(),
  );

  const update = useCallback((next: ConferenceMediaQualitySettings) => {
    setSettings(next);
    saveConferenceMediaQualitySettings(next);
  }, []);

  const setProfile = useCallback((profile: ConferenceMediaQualityProfile) => {
    setSettings((current) => {
      const next = {
        ...current,
        profile,
        cameraQuality: PROFILE_RECOMMENDED_CAMERA[profile],
      };
      saveConferenceMediaQualitySettings(next);
      return next;
    });
  }, []);

  const setCameraQuality = useCallback((cameraQuality: ConferenceCameraQuality) => {
    setSettings((current) => {
      const next = { ...current, cameraQuality };
      saveConferenceMediaQualitySettings(next);
      return next;
    });
  }, []);

  const setScreenShareQuality = useCallback((
    screenShareQuality: ConferenceScreenShareQuality,
  ) => {
    setSettings((current) => {
      const next = { ...current, screenShareQuality };
      saveConferenceMediaQualitySettings(next);
      return next;
    });
  }, []);

  useEffect(() => {
    void revision;
    if (!room) return;
    applyRemoteConferenceMediaQuality(room, settings, focusIdentity);
  }, [focusIdentity, revision, room, settings]);

  useEffect(() => {
    if (!room || !room.localParticipant.isCameraEnabled) return;

    void applyLocalConferenceCameraQuality(room, settings).catch((error) => {
      console.error('[VideoConference] camera quality apply failed', error);
    });
  }, [room, settings.cameraQuality]);

  useEffect(() => {
    // Normalize any stale/invalid persisted value without requiring a DB write.
    if (!settings.profile || !settings.cameraQuality || !settings.screenShareQuality) {
      update(DEFAULT_MEDIA_QUALITY_SETTINGS);
    }
  }, [settings, update]);

  return {
    ...settings,
    setProfile,
    setCameraQuality,
    setScreenShareQuality,
  };
}
