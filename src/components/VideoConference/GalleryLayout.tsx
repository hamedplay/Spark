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

  // Screen sharing tile goes first so it's always in the top-left position
  const sorted = [...tiles].sort((a, b) => {
    if (a.isScreenSharing && !b.isScreenSharing) return -1;
    if (!a.isScreenSharing && b.isScreenSharing) return 1;
    return 0;
  });

  const cols =
    n === 1 ? 'grid-cols-1' :
    n === 2 ? 'grid-cols-1 sm:grid-cols-2' :
    n <= 4 ? 'grid-cols-2' :
    n <= 6 ? 'grid-cols-2 sm:grid-cols-3' :
    n <= 9 ? 'grid-cols-3' :
    'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4';

  // For >9 participants allow scroll; otherwise fill available height with equal rows
  const shouldScroll = n > 9;

  // Number of rows needed — used to set explicit grid-template-rows so tiles fill height
  const numCols = n === 1 ? 1 : n === 2 ? 2 : n <= 4 ? 2 : 3;
  const numRows = Math.ceil(n / numCols);

  return (
    <div
      className={`flex-1 grid gap-2 ${cols} min-h-0 w-full ${shouldScroll ? 'auto-rows-fr overflow-y-auto' : 'overflow-hidden'}`}
      style={shouldScroll ? undefined : { gridTemplateRows: `repeat(${numRows}, minmax(0, 1fr))` }}
    >
      {sorted.map(t => (
        <div key={t.peerId} className="min-h-0 min-w-0 h-full" {...makeDraggable(t.peerId)}>
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
