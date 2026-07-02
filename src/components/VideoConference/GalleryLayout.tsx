import { VideoTile } from './VideoTile';
import type { TileProps, DraggableProps } from './ConferenceLayout';

interface GalleryLayoutProps {
  tiles: TileProps[];
  pinnedPeerId: string | null;
  tileReactions: Map<string, string>;
  makeDraggable: (peerId: string) => DraggableProps;
  onPin: (peerId: string) => void;
}

export function GalleryLayout({ tiles, pinnedPeerId, tileReactions, makeDraggable, onPin }: GalleryLayoutProps) {
  const n = tiles.length;
  const cols =
    n === 1 ? 'grid-cols-1' :
    n === 2 ? 'grid-cols-1 sm:grid-cols-2' :
    n <= 4 ? 'grid-cols-2' :
    n <= 6 ? 'grid-cols-2 sm:grid-cols-3' :
    n <= 9 ? 'grid-cols-3' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';
  const shouldScroll = n > 9;

  return (
    <div className={`flex-1 grid gap-2 ${cols} ${shouldScroll ? 'auto-rows-[minmax(0,1fr)] overflow-y-auto' : 'grid-rows-[repeat(auto-fit,minmax(0,1fr))]'} min-h-0 w-full`}>
      {tiles.map(t => (
        <div key={t.peerId} className="min-h-0 min-w-0" {...makeDraggable(t.peerId)}>
          <VideoTile
            {...t}
            isPinned={pinnedPeerId === t.peerId}
            activeReaction={tileReactions.get(t.userId)}
            onPin={() => onPin(t.peerId)}
          />
        </div>
      ))}
    </div>
  );
}
