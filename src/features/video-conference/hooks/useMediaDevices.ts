import { useCallback, useEffect, useState } from 'react';
import type { Room } from 'livekit-client';
import type { MediaDeviceOption } from '../types/conference.types';

function mapDevices(devices: MediaDeviceInfo[], kind: MediaDeviceKind): MediaDeviceOption[] {
  return devices.filter((device) => device.kind === kind).map((device, index) => ({
    deviceId: device.deviceId,
    label: device.label || `${kind === 'audioinput' ? 'میکروفون' : kind === 'videoinput' ? 'دوربین' : 'خروجی صدا'} ${index + 1}`,
  }));
}

export function useMediaDevices(room: Room) {
  const [audioInputs, setAudioInputs] = useState<MediaDeviceOption[]>([]);
  const [videoInputs, setVideoInputs] = useState<MediaDeviceOption[]>([]);
  const [audioOutputs, setAudioOutputs] = useState<MediaDeviceOption[]>([]);
  const [selectedMic, setSelectedMic] = useState('');
  const [selectedCamera, setSelectedCamera] = useState('');
  const [selectedSpeaker, setSelectedSpeaker] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    setAudioInputs(mapDevices(devices, 'audioinput'));
    setVideoInputs(mapDevices(devices, 'videoinput'));
    setAudioOutputs(mapDevices(devices, 'audiooutput'));
  }, []);

  useEffect(() => {
    void refreshDevices();
    const onDeviceChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onDeviceChange);
  }, [refreshDevices]);

  const switchDevice = useCallback(async (kind: MediaDeviceKind, deviceId: string) => {
    if (!deviceId) return;
    setBusy(true);
    try {
      await room.switchActiveDevice(kind, deviceId, true);
      if (kind === 'audioinput') setSelectedMic(deviceId);
      if (kind === 'videoinput') setSelectedCamera(deviceId);
      if (kind === 'audiooutput') setSelectedSpeaker(deviceId);
    } catch (error) {
      console.error('[VideoConference] device switch failed', { kind, error });
    } finally {
      setBusy(false);
    }
  }, [room]);

  return {
    audioInputs,
    videoInputs,
    audioOutputs,
    selectedMic,
    selectedCamera,
    selectedSpeaker,
    busy,
    switchDevice,
  };
}
