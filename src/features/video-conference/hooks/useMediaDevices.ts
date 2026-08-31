import { useCallback, useEffect, useState } from 'react';
import {
  RoomEvent,
  supportsAudioOutputSelection,
  type Room,
} from 'livekit-client';
import type { MediaDeviceOption } from '../types/conference.types';

function mapDevices(
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind,
): MediaDeviceOption[] {
  return devices
    .filter((device) => device.kind === kind)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || (
        kind === 'audioinput'
          ? 'میکروفون ' + (index + 1)
          : kind === 'videoinput'
            ? 'دوربین ' + (index + 1)
            : 'خروجی صدا ' + (index + 1)
      ),
    }));
}

export function useMediaDevices(room: Room) {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceOption[]>([]);
  const [selectedMic, setSelectedMic] = useState(
    () => room.getActiveDevice('audioinput') || '',
  );
  const [selectedCamera, setSelectedCamera] = useState(
    () => room.getActiveDevice('videoinput') || '',
  );
  const [selectedSpeaker, setSelectedSpeaker] = useState(
    () => room.getActiveDevice('audiooutput') || '',
  );
  const [busy, setBusy] = useState(false);
  const speakerSelectionSupported = supportsAudioOutputSelection();

  const syncSelectedDevices = useCallback(() => {
    setSelectedMic(room.getActiveDevice('audioinput') || '');
    setSelectedCamera(room.getActiveDevice('videoinput') || '');
    setSelectedSpeaker(room.getActiveDevice('audiooutput') || '');
  }, [room]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    setAudioInputs(mapDevices(devices, 'audioinput'));
    setVideoInputs(mapDevices(devices, 'videoinput'));
    setAudioOutputs(
      speakerSelectionSupported
        ? mapDevices(devices, 'audiooutput')
        : [],
    );
    syncSelectedDevices();
  }, [speakerSelectionSupported, syncSelectedDevices]);

  useEffect(() => {
    void refreshDevices();

    const onDeviceChange = () => void refreshDevices();
    const onActiveDeviceChanged = (
      kind: MediaDeviceKind,
      deviceId: string,
    ) => {
      if (kind === 'audioinput') setSelectedMic(deviceId);
      if (kind === 'videoinput') setSelectedCamera(deviceId);
      if (kind === 'audiooutput') setSelectedSpeaker(deviceId);
    };

    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    room.on(RoomEvent.ActiveDeviceChanged, onActiveDeviceChanged);

    return () => {
      navigator.mediaDevices?.removeEventListener?.(
        'devicechange',
        onDeviceChange,
      );
      room.off(RoomEvent.ActiveDeviceChanged, onActiveDeviceChanged);
    };
  }, [refreshDevices, room]);

  const switchDevice = useCallback(async (
    kind: MediaDeviceKind,
    deviceId: string,
  ) => {
    if (!deviceId) return;

    if (
      kind === 'audiooutput'
      && !speakerSelectionSupported
    ) return;

    setBusy(true);
    try {
      await room.switchActiveDevice(kind, deviceId, true);
      syncSelectedDevices();
    } catch (error) {
      console.error('[VideoConference] device switch failed', {
        kind,
        error,
      });
      throw error;
    } finally {
      setBusy(false);
    }
  }, [room, speakerSelectionSupported, syncSelectedDevices]);

  const switchCamera = useCallback(async () => {
    if (videoInputs.length < 2) return;

    const current = room.getActiveDevice('videoinput') || selectedCamera;
    const index = videoInputs.findIndex(
      (device) => device.deviceId === current,
    );
    const next = videoInputs[
      index >= 0
        ? (index + 1) % videoInputs.length
        : 0
    ];

    if (next) {
      await switchDevice('videoinput', next.deviceId);
    }
  }, [room, selectedCamera, switchDevice, videoInputs]);

  return {
    audioInputs,
    videoInputs,
    audioOutputs,
    selectedMic,
    selectedCamera,
    selectedSpeaker,
    speakerSelectionSupported,
    canSwitchCamera: videoInputs.length > 1,
    busy,
    switchDevice,
    switchCamera,
    refreshDevices,
  };
}
