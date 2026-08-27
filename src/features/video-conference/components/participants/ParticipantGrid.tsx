import type { ConferenceParticipant } from '../../types/conference.types';
import { LiveKitParticipantTile } from '../LiveKitParticipantTile';

interface Props {
  participants: ConferenceParticipant[];
  localIdentity?: string;
  activeSpeakerIdentity: string | null;
}

export function ParticipantGrid({ participants, localIdentity, activeSpeakerIdentity }: Props) {
  const gridClass = participants.length <= 1
    ? 'grid-cols-1'
    : participants.length <= 4
      ? 'grid-cols-2'
      : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4">
      <div className={`mx-auto grid h-full max-w-[1600px] gap-2 sm:gap-3 ${gridClass}`}>
        {participants.map((participant) => (
          <LiveKitParticipantTile
            key={participant.identity}
            participant={participant}
            local={participant.identity === localIdentity}
            active={participant.identity === activeSpeakerIdentity}
          />
        ))}
      </div>
    </main>
  );
}
