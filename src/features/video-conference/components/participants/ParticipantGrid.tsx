import type { ConferenceParticipant } from '../../types/conference.types';
import { LiveKitParticipantTile } from '../LiveKitParticipantTile';

interface Props {
  participants: ConferenceParticipant[];
  localIdentity?: string;
  activeSpeakerIdentity: string | null;
  pinnedIdentity: string | null;
  onPinnedIdentityChange: (identity: string | null) => void;
}

export function ParticipantGrid({
  participants,
  localIdentity,
  activeSpeakerIdentity,
  pinnedIdentity,
  onPinnedIdentityChange,
}: Props) {
  const gridClass = participants.length <= 1
    ? 'grid-cols-1'
    : participants.length <= 4
      ? 'grid-cols-2'
      : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  const focusIdentity = pinnedIdentity || activeSpeakerIdentity;
  const orderedParticipants = focusIdentity
    ? [
        ...participants.filter((participant) => participant.identity === focusIdentity),
        ...participants.filter((participant) => participant.identity !== focusIdentity),
      ]
    : participants;

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4">
      <div className={`mx-auto grid h-full max-w-[1600px] auto-rows-[minmax(160px,1fr)] gap-2 sm:gap-3 ${gridClass}`}>
        {orderedParticipants.map((participant) => {
          const pinned = participant.identity === pinnedIdentity;
          const featured = participant.identity === focusIdentity && participants.length > 1;
          return (
            <LiveKitParticipantTile
              key={participant.identity}
              participant={participant}
              local={participant.identity === localIdentity}
              active={participant.identity === activeSpeakerIdentity}
              featured={featured}
              pinned={pinned}
              onTogglePin={() => onPinnedIdentityChange(
                pinned ? null : participant.identity,
              )}
            />
          );
        })}
      </div>
    </main>
  );
}
