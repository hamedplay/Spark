import React from 'react';
import { VideoTile } from './VideoTile';
import type { TileProps, DraggableProps } from './ConferenceLayout';

interface SidebarLayoutProps {
  tiles: TileProps[];
  tileReactions: Map<string, string>;
  makeDraggable: (peerId: string) => DraggableProps;
  onPinMain: (peerId: string) => void;
  onPromoteSidebar: (peerId: string) => void;
}

export function SidebarLayout({ tiles, tileReactions, makeDraggable, onPinMain, onPromoteSidebar }: SidebarLayoutProps) {
  if (!tiles.length) return null;
  const [main, ...others] = tiles;

  return (
    <div className="flex flex-1 gap-2 min-h-0 flex-row-reverse">
      <div className="w-32 sm:w-44 flex-shrink-0 flex flex-col gap-2 overflow-y-auto">
        {others.map(t => (
          <div key={t.peerId} className="flex-shrink-0 aspect-video" {...makeDraggable(t.peerId)}>
            <VideoTile
              {...t}
              isPinned={false}
              activeReaction={tileReactions.get(t.userId)}
              onPin={() => onPromoteSidebar(t.peerId)}
              small
            />
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-0" {...makeDraggable(main.peerId)}>
        <VideoTile
          {...main}
          isPinned={false}
          activeReaction={tileReactions.get(main.userId)}
          onPin={() => onPinMain(main.peerId)}
        />
      </div>
    </div>
  );
}
