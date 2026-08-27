import { ConferenceRoomPage } from './room/ConferenceRoomPage';
import type { ConferenceRoomShape } from '../types/conference.types';

interface Props {
  room: ConferenceRoomShape;
  currentUserId: string;
  currentUserName: string;
  localStream: MediaStream;
  onLeave: () => void;
}

export function LiveKitConferenceRoom(props: Props) {
  return <ConferenceRoomPage {...props} />;
}
