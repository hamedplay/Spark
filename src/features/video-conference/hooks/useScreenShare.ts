import { useCallback, useEffect, useState } from 'react';
import { RoomEvent, Track, type Room } from 'livekit-client';
import { setConferenceScreenShare } from '../services/conferenceMedia';

function isScreenShareEnabled(room: Room | null): boolean {
  if (!room) return false;
  const publication = room.localParticipant.getTrackPublication(
    Track.Source.ScreenShare,
  );
  return Boolean(publication?.track && !publication.isMuted);
}

export function useScreenShare(room: Room | null) {
  const [screenEnabled, setScreenEnabled] = useState(
    () => isScreenShareEnabled(room),
  );

  const sync = useCallback(() => {
    setScreenEnabled(isScreenShareEnabled(room));
  }, [room]);

  useEffect(() => {
    if (!room) {
      setScreenEnabled(false);
      return;
    }

    sync();
    room.on(RoomEvent.LocalTrackPublished, sync);
    room.on(RoomEvent.LocalTrackUnpublished, sync);
    room.on(RoomEvent.TrackMuted, sync);
    room.on(RoomEvent.TrackUnmuted, sync);
    room.on(RoomEvent.ParticipantPermissionsChanged, sync);

    return () => {
      room.off(RoomEvent.LocalTrackPublished, sync);
      room.off(RoomEvent.LocalTrackUnpublished, sync);
      room.off(RoomEvent.TrackMuted, sync);
      room.off(RoomEvent.TrackUnmuted, sync);
      room.off(RoomEvent.ParticipantPermissionsChanged, sync);
    };
  }, [room, sync]);

  const toggleScreen = useCallback(async () => {
    if (!room || !navigator.mediaDevices?.getDisplayMedia) return;

    const next = !isScreenShareEnabled(room);
    try {
      await setConferenceScreenShare(room, next);
    } catch (error) {
      console.error('[VideoConference] screen share failed', error);
      throw error;
    } finally {
      sync();
    }
  }, [room, sync]);

  return { screenEnabled, toggleScreen };
}
