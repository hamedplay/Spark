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
  spotlightIdentities: string[];
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
  spotlightIdentities,
  layoutMode,
  speakerMuted,
  onPinnedIdentityChange,
}: Props) {
  const gridClass = participants.length <= 1
    ? 'grid-cols-1'
    : participants.length === 2
      ? 'grid-cols-1 sm:grid-cols-2'
      : participants.length <= 4
        ? 'grid-cols-2'
        : 'grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  const participantFocusIdentity =
    pinnedIdentity || activeSpeakerIdentity;

  const spotlightFocusIdentity =
    spotlightIdentities[0] || null;

  const focusIdentity =
    screenShareIdentity
    || spotlightFocusIdentity
    || participantFocusIdentity
    || participants[0]?.identity
    || null;

  const priorityIdentities = [
    screenShareIdentity,
    ...spotlightIdentities,
    participantFocusIdentity,
  ].filter((identity, index, values): identity is string => (
    Boolean(identity)
    && values.indexOf(identity) === index
  ));

  const prioritySet = new Set(priorityIdentities);
  const orderedParticipants = [
    ...priorityIdentities.flatMap((identity) =>
      participants.filter(
        (participant) => participant.identity === identity,
      ),
    ),
    ...participants.filter(
      (participant) => !prioritySet.has(participant.identity),
    ),
  ];

  const speakerMode = (
    layoutMode === 'speaker'
    || screenShareIdentity !== null
    || spotlightIdentities.length > 0
  );

  if (speakerMode && orderedParticipants.length > 0) {
    const focus = orderedParticipants[0]!;
    const rest = orderedParticipants.slice(1);

    return (
      <main className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-1.5 sm:gap-3 sm:p-4">
        <div className="min-h-0 flex-1">
          <LiveKitParticipantTile
            participant={focus}
            local={focus.identity === localIdentity}
            active={focus.identity === activeSpeakerIdentity}
            featured
            pinned={focus.identity === pinnedIdentity}
            spotlighted={spotlightIdentities.includes(focus.identity)}
            preferScreenShare={focus.identity === screenShareIdentity}
            speakerMuted={speakerMuted}
            onTogglePin={() => onPinnedIdentityChange(
              focus.identity === pinnedIdentity ? null : focus.identity,
            )}
          />
        </div>

        {rest.length > 0 && (
          <div className="flex min-h-[148px] max-h-[156px] gap-2 overflow-x-auto pb-1 sm:min-h-[168px] sm:max-h-[190px]">
            {rest.map((participant) => {
              const pinned = participant.identity === pinnedIdentity;
              return (
                <div
                  key={participant.identity}
                  className="h-[148px] min-w-[180px] max-w-[220px] flex-1 sm:h-[168px] sm:min-w-[220px] sm:max-w-[280px]"
                >
                  <LiveKitParticipantTile
                    participant={participant}
                    local={participant.identity === localIdentity}
                    active={participant.identity === activeSpeakerIdentity}
                    pinned={pinned}
                    spotlighted={spotlightIdentities.includes(
                      participant.identity,
                    )}
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
    <main className="min-h-0 flex-1 overflow-y-auto p-1.5 sm:p-4">
      <div
        className={
          `mx-auto grid h-full max-w-[1600px] auto-rows-[minmax(148px,1fr)] gap-1.5 sm:auto-rows-[minmax(160px,1fr)] sm:gap-3 ${gridClass}`
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
              spotlighted={spotlightIdentities.includes(
                participant.identity,
              )}
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
