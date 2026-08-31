import type {
  ConferenceLayoutMode,
  ConferenceParticipant,
} from '../../types/conference.types';
import { LiveKitParticipantTile } from '../LiveKitParticipantTile';

interface Props {
  participants: ConferenceParticipant[];
  localIdentity?: string;
  activeSpeakerIdentity: string | null;
  pinnedIdentity: string | null;
  screenShareIdentity: string | null;
  layoutMode: ConferenceLayoutMode;
  speakerMuted: boolean;
  onPinnedIdentityChange: (identity: string | null) => void;
}

export function ParticipantGrid({
  participants,
  localIdentity,
  activeSpeakerIdentity,
  pinnedIdentity,
  screenShareIdentity,
  layoutMode,
  speakerMuted,
  onPinnedIdentityChange,
}: Props) {
  const gridClass = participants.length <= 1
    ? 'grid-cols-1'
    : participants.length <= 4
      ? 'grid-cols-2'
      : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  const focusIdentity =
    screenShareIdentity
    || pinnedIdentity
    || activeSpeakerIdentity
    || participants[0]?.identity
    || null;

  const orderedParticipants = focusIdentity
    ? [
        ...participants.filter(
          (participant) => participant.identity === focusIdentity,
        ),
        ...participants.filter(
          (participant) => participant.identity !== focusIdentity,
        ),
      ]
    : participants;

  const speakerMode = (
    layoutMode === 'speaker'
    || screenShareIdentity !== null
  );

  if (speakerMode && orderedParticipants.length > 0) {
    const [focus, ...rest] = orderedParticipants;

    return (
      <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 sm:gap-3 sm:p-4">
        <div className="min-h-0 flex-1">
          <LiveKitParticipantTile
            participant={focus}
            local={focus.identity === localIdentity}
            active={focus.identity === activeSpeakerIdentity}
            featured
            pinned={focus.identity === pinnedIdentity}
            preferScreenShare={focus.identity === screenShareIdentity}
            speakerMuted={speakerMuted}
            onTogglePin={() => onPinnedIdentityChange(
              focus.identity === pinnedIdentity ? null : focus.identity,
            )}
          />
        </div>

        {rest.length > 0 && (
          <div className="flex min-h-[168px] max-h-[190px] gap-2 overflow-x-auto pb-1">
            {rest.map((participant) => {
              const pinned = participant.identity === pinnedIdentity;
              return (
                <div
                  key={participant.identity}
                  className="h-[168px] min-w-[220px] max-w-[280px] flex-1"
                >
                  <LiveKitParticipantTile
                    participant={participant}
                    local={participant.identity === localIdentity}
                    active={participant.identity === activeSpeakerIdentity}
                    pinned={pinned}
                    preferScreenShare={
                      participant.identity === screenShareIdentity
                    }
                    speakerMuted={speakerMuted}
                    onTogglePin={() => onPinnedIdentityChange(
                      pinned ? null : participant.identity,
                    )}
                  />
                </div>
              );
            })}
          </div>
        )}
      </main>
    );
  }

  return (
    <main className="min-h-0 flex-1 overflow-y-auto p-2 sm:p-4">
      <div
        className={
          `mx-auto grid h-full max-w-[1600px] auto-rows-[minmax(160px,1fr)] gap-2 sm:gap-3 ${gridClass}`
        }
      >
        {orderedParticipants.map((participant) => {
          const pinned = participant.identity === pinnedIdentity;
          const featured =
            participant.identity === focusIdentity
            && participants.length > 1;

          return (
            <LiveKitParticipantTile
              key={participant.identity}
              participant={participant}
              local={participant.identity === localIdentity}
              active={participant.identity === activeSpeakerIdentity}
              featured={featured}
              pinned={pinned}
              preferScreenShare={
                participant.identity === screenShareIdentity
              }
              speakerMuted={speakerMuted}
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
