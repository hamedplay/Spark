import { useCallback, useState } from 'react';
import type { Room } from 'livekit-client';
import { setConferenceScreenShare } from '../services/conferenceMedia';

export function useScreenShare(room: Room | null) {
  const [screenEnabled, setScreenEnabled] = useState(false);

  const toggleScreen = useCallback(async () => {
    if (!room || !navigator.mediaDevices?.getDisplayMedia) return;
    const next = !screenEnabled;
    try {
      await setConferenceScreenShare(room, next);
      setScreenEnabled(next);
    } catch (error) {
      console.error('[VideoConference] screen share failed', error);
    }
  }, [room, screenEnabled]);

  return { screenEnabled, toggleScreen };
}
