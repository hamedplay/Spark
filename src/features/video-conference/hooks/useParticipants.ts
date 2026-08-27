import { useMemo } from 'react';
import { Track } from 'livekit-client';
import type { Room } from 'livekit-client';
import type { ConferenceParticipant } from '../types/conference.types';

export function useParticipants(room: Room | null, revision: number) {
  const participants = useMemo<ConferenceParticipant[]>(() => {
    void revision;
    if (!room) return [];
    return [room.localParticipant, ...Array.from(room.remoteParticipants.values())];
  }, [revision, room]);

  const screenSharer = useMemo(() => participants.find((participant) => {
    const publication = participant.getTrackPublication(Track.Source.ScreenShare);
    return Boolean(publication?.track && !publication.isMuted);
  }), [participants]);

  return { participants, screenSharer };
}
