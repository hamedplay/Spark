import React from 'react';
import { VideoTile } from './VideoTile';
import type { TileProps, DraggableProps } from './ConferenceLayout';

interface SpeakerLayoutProps {
  tiles: TileProps[];
  tileReactions: Map<string, string>;
  makeDraggable: (peerId: string) => DraggableProps;
  onPinSpeaker: (peerId: string) => void;
  onPromoteThumbnail: (peerId: string) => void;
}

export function SpeakerLayout({ tiles, tileReactions, makeDraggable, onPinSpeaker, onPromoteThumbnail }: SpeakerLayoutProps) {
  if (!tiles.length) return null;
  const [speaker, ...rest] = tiles;

  return (
    <div className="flex flex-col flex-1 gap-2 min-h-0">
      <div className="flex-1 min-h-0" {...makeDraggable(speaker.peerId)}>
        <VideoTile
          {...speaker}
          isPinned={false}
          activeReaction={tileReactions.get(speaker.userId)}
          onPin={() => onPinSpeaker(speaker.peerId)}
        />
      </div>
      {rest.length > 0 && (
        <div className="flex gap-2 flex-shrink-0 overflow-x-auto pb-1">
          {rest.map(t => (
            <div key={t.peerId} className="w-36 sm:w-44 flex-shrink-0 aspect-video" {...makeDraggable(t.peerId)}>
              <VideoTile
                {...t}
                isPinned={false}
                activeReaction={tileReactions.get(t.userId)}
                onPin={() => onPromoteThumbnail(t.peerId)}
                small
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
