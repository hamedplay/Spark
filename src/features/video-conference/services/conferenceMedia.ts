import type { Room } from 'livekit-client';

export async function setConferenceMicrophone(room: Room, enabled: boolean) {
  await room.localParticipant.setMicrophoneEnabled(enabled);
}

export async function setConferenceCamera(room: Room, enabled: boolean) {
  await room.localParticipant.setCameraEnabled(enabled, undefined, enabled ? { simulcast: true } : undefined);
}

export async function setConferenceScreenShare(room: Room, enabled: boolean) {
  await room.localParticipant.setScreenShareEnabled(enabled);
}

export async function publishConferenceReaction(room: Room, emoji: string) {
  await room.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({ emoji, at: Date.now() })),
    { reliable: false, topic: 'spark-reaction' },
  );
}
