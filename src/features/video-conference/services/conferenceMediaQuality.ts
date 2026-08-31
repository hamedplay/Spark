import {
  ScreenSharePresets,
  Track,
  VideoPresets,
  VideoQuality,
  type Room,
  type RoomOptions,
  type ScreenShareCaptureOptions,
  type TrackPublishOptions,
  type VideoCaptureOptions,
} from 'livekit-client';
import type {
  ConferenceCameraQuality,
  ConferenceMediaQualityProfile,
  ConferenceMediaQualitySettings,
  ConferenceScreenShareQuality,
} from '../types/conference.types';

const STORAGE_KEY = 'spark:conference-media-quality:v1';

export const CONFERENCE_MEDIA_QUALITY_PROFILES: ConferenceMediaQualityProfile[] = [
  'AUTO',
  'DATA_SAVER',
  'BALANCED',
  'HIGH',
];

export const CONFERENCE_CAMERA_QUALITIES: ConferenceCameraQuality[] = [
  '180p',
  '360p',
  '540p',
  '720p',
  '1080p',
];

export const CONFERENCE_SCREEN_SHARE_QUALITIES: ConferenceScreenShareQuality[] = [
  '720p',
  '1080p',
];

export const PROFILE_RECOMMENDED_CAMERA: Record<
  ConferenceMediaQualityProfile,
  ConferenceCameraQuality
> = {
  AUTO: '720p',
  DATA_SAVER: '360p',
  BALANCED: '540p',
  HIGH: '1080p',
};

export const DEFAULT_MEDIA_QUALITY_SETTINGS: ConferenceMediaQualitySettings = {
  profile: 'AUTO',
  cameraQuality: PROFILE_RECOMMENDED_CAMERA.AUTO,
  screenShareQuality: '1080p',
};

const CAMERA_PRESETS = {
  '180p': VideoPresets.h180,
  '360p': VideoPresets.h360,
  '540p': VideoPresets.h540,
  '720p': VideoPresets.h720,
  '1080p': VideoPresets.h1080,
} as const;

function isProfile(value: unknown): value is ConferenceMediaQualityProfile {
  return CONFERENCE_MEDIA_QUALITY_PROFILES.includes(value as ConferenceMediaQualityProfile);
}

function isCameraQuality(value: unknown): value is ConferenceCameraQuality {
  return CONFERENCE_CAMERA_QUALITIES.includes(value as ConferenceCameraQuality);
}

function isScreenShareQuality(value: unknown): value is ConferenceScreenShareQuality {
  return CONFERENCE_SCREEN_SHARE_QUALITIES.includes(value as ConferenceScreenShareQuality);
}

export function loadConferenceMediaQualitySettings(): ConferenceMediaQualitySettings {
  if (typeof window === 'undefined') return DEFAULT_MEDIA_QUALITY_SETTINGS;

  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}') as Partial<ConferenceMediaQualitySettings>;
    return {
      profile: isProfile(stored.profile) ? stored.profile : DEFAULT_MEDIA_QUALITY_SETTINGS.profile,
      cameraQuality: isCameraQuality(stored.cameraQuality)
        ? stored.cameraQuality
        : DEFAULT_MEDIA_QUALITY_SETTINGS.cameraQuality,
      screenShareQuality: isScreenShareQuality(stored.screenShareQuality)
        ? stored.screenShareQuality
        : DEFAULT_MEDIA_QUALITY_SETTINGS.screenShareQuality,
    };
  } catch {
    return DEFAULT_MEDIA_QUALITY_SETTINGS;
  }
}

export function saveConferenceMediaQualitySettings(
  settings: ConferenceMediaQualitySettings,
) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function cameraSimulcastLayers(quality: ConferenceCameraQuality) {
  if (quality === '180p') return [];
  if (quality === '360p') return [VideoPresets.h180];
  return [VideoPresets.h180, VideoPresets.h360];
}

export function cameraCaptureOptions(
  settings: ConferenceMediaQualitySettings,
  deviceId?: string,
): VideoCaptureOptions {
  const preset = CAMERA_PRESETS[settings.cameraQuality];
  return {
    ...(deviceId ? { deviceId } : {}),
    resolution: preset.resolution,
    frameRate: preset.encoding.maxFramerate || 30,
  };
}

export function cameraPublishOptions(
  settings: ConferenceMediaQualitySettings,
): TrackPublishOptions {
  const preset = CAMERA_PRESETS[settings.cameraQuality];
  return {
    simulcast: true,
    videoEncoding: preset.encoding,
    videoSimulcastLayers: cameraSimulcastLayers(settings.cameraQuality),
    degradationPreference: 'balanced',
  };
}

export function roomMediaOptions(
  settings: ConferenceMediaQualitySettings,
): Pick<RoomOptions, 'adaptiveStream' | 'dynacast' | 'videoCaptureDefaults' | 'publishDefaults'> {
  const cameraPreset = CAMERA_PRESETS[settings.cameraQuality];
  const screenPreset = settings.screenShareQuality === '720p'
    ? ScreenSharePresets.h720fps15
    : ScreenSharePresets.h1080fps15;

  return {
    adaptiveStream: {
      pauseVideoInBackground: true,
      // For a 20-person grid, DPR amplification can make small tiles request
      // unnecessarily large layers. Tile dimensions remain authoritative.
      pixelDensity: 1,
    },
    dynacast: true,
    videoCaptureDefaults: {
      resolution: cameraPreset.resolution,
    },
    publishDefaults: {
      simulcast: true,
      videoEncoding: cameraPreset.encoding,
      videoSimulcastLayers: cameraSimulcastLayers(settings.cameraQuality),
      screenShareEncoding: screenPreset.encoding,
      screenShareSimulcastLayers: settings.screenShareQuality === '720p'
        ? [ScreenSharePresets.h360fps15]
        : [ScreenSharePresets.h360fps15, ScreenSharePresets.h720fps15],
    },
  };
}

export function screenShareOptions(
  settings: ConferenceMediaQualitySettings,
): {
  capture: ScreenShareCaptureOptions;
  publish: TrackPublishOptions;
} {
  const preset = settings.screenShareQuality === '720p'
    ? ScreenSharePresets.h720fps15
    : ScreenSharePresets.h1080fps15;

  return {
    capture: {
      resolution: preset.resolution,
      contentHint: 'detail',
    },
    publish: {
      simulcast: true,
      screenShareEncoding: preset.encoding,
      screenShareSimulcastLayers: settings.screenShareQuality === '720p'
        ? [ScreenSharePresets.h360fps15]
        : [ScreenSharePresets.h360fps15, ScreenSharePresets.h720fps15],
      degradationPreference: 'maintain-resolution',
    },
  };
}

function gridQuality(profile: ConferenceMediaQualityProfile): VideoQuality {
  if (profile === 'DATA_SAVER') return VideoQuality.LOW;
  return VideoQuality.MEDIUM;
}

function focusQuality(profile: ConferenceMediaQualityProfile): VideoQuality {
  if (profile === 'DATA_SAVER') return VideoQuality.MEDIUM;
  return VideoQuality.HIGH;
}

export function applyRemoteConferenceMediaQuality(
  room: Room,
  settings: ConferenceMediaQualitySettings,
  focusIdentity: string | null,
) {
  for (const participant of room.remoteParticipants.values()) {
    const camera = participant.getTrackPublication(Track.Source.Camera);
    if (camera?.kind === Track.Kind.Video && 'setVideoQuality' in camera) {
      camera.setVideoQuality(
        participant.identity === focusIdentity
          ? focusQuality(settings.profile)
          : gridQuality(settings.profile),
      );
    }

    const screen = participant.getTrackPublication(Track.Source.ScreenShare);
    if (screen?.kind === Track.Kind.Video && 'setVideoQuality' in screen) {
      // Screen-share quality is controlled independently from camera profile.
      screen.setVideoQuality(VideoQuality.HIGH);
    }
  }
}

export async function applyLocalConferenceCameraQuality(
  room: Room,
  settings: ConferenceMediaQualitySettings,
) {
  const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
  const track = publication?.videoTrack;

  if (!track || !('restartTrack' in track)) return;

  const deviceId = typeof track.getDeviceId === 'function'
    ? track.getDeviceId()
    : undefined;

  await track.restartTrack(cameraCaptureOptions(
    settings,
    typeof deviceId === 'string' ? deviceId : undefined,
  ));

  if ('setPublishingQuality' in track) {
    track.setPublishingQuality(VideoQuality.HIGH);
  }
}
