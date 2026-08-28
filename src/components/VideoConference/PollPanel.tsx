import { useConferenceClient } from './conferenceClient';
import { useConferenceAuthorization } from '../../features/video-conference/hooks/useConferenceAuthorization';
import { ConferencePollPanel } from '../../features/video-conference/components/polls/ConferencePollPanel';

interface PollPanelProps {
  roomId: string;
  userId: string;
  isHost: boolean;
}

export function PollPanel({ roomId, userId }: PollPanelProps) {
  const client = useConferenceClient();
  const { authorization } = useConferenceAuthorization({
    client,
    roomId,
    currentUserId: userId,
  });

  return (
    <ConferencePollPanel
      roomId={roomId}
      currentUserId={userId}
      authorization={authorization}
    />
  );
}
