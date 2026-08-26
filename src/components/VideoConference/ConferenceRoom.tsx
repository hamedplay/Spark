import { LiveKitConferenceRoom } from '../../features/video-conference/components/LiveKitConferenceRoom';
import { ConferenceRoomView as LegacyConferenceRoomView } from './ConferenceRoomCore';
import type { ConferenceRoom } from './types';

interface Props {
  room: ConferenceRoom;
  currentUserId: string;
  currentUserName: string;
  myPeerId: string;
  localStream: MediaStream;
  onLeave: () => void;
  onInvite?: () => void;
  loadRTCConfig: () => Promise<RTCConfiguration>;
}

export function ConferenceRoomView(props: Props) {
  if (props.room.media_topology === 'sfu') {
    return (
      <LiveKitConferenceRoom
        room={props.room}
        currentUserId={props.currentUserId}
        currentUserName={props.currentUserName}
        localStream={props.localStream}
        onLeave={props.onLeave}
      />
    );
  }

  return <LegacyConferenceRoomView {...props} />;
}
