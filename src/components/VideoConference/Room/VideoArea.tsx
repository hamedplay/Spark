import { GalleryLayout } from '../GalleryLayout';
import { SpeakerLayout } from '../SpeakerLayout';
import { SidebarLayout } from '../SidebarLayout';
import { VideoTile } from '../VideoTile';

export interface TileData {
  peerId: string;
  userId: string;
  displayName: string;
  stream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isHandRaised: boolean;
  isLocal: boolean;
  isHost: boolean;
  networkQuality: 'excellent' | 'good' | 'fair' | 'poor';
  avatarUrl?: string;
  pingMs?: number;
  isScreenSharing?: boolean;
}

export function VideoArea(props: {
  allTiles: TileData[];
  tileOrder: string[];
  setTileOrder: React.Dispatch<React.SetStateAction<string[]>>;
  pinnedPeerId: string | null;
  setPinnedPeerId: React.Dispatch<React.SetStateAction<string | null>>;
  layoutMode: 'gallery' | 'speaker' | 'sidebar';
  tileReactions: Map<string, string>;
  dragSrcRef: React.MutableRefObject<string | null>;
}) {
  const { allTiles, tileOrder, setTileOrder, pinnedPeerId, setPinnedPeerId, layoutMode, tileReactions, dragSrcRef } = props;

  // Compute ordered tiles — respect saved drag order, fill in any new peers at the end
  const rawTiles = allTiles;
  const orderedTiles = [
    ...tileOrder.map(id => rawTiles.find(t => t.peerId === id)).filter(Boolean) as typeof rawTiles,
    ...rawTiles.filter(t => !tileOrder.includes(t.peerId)),
  ];

  // When someone is screen sharing, elevate their tile to the front
  // (only when no explicit pin is active and no manual drag order includes them)
  const screenShareTile = orderedTiles.find(t => t.isScreenSharing);
  const displayTiles = screenShareTile && !pinnedPeerId
    ? [screenShareTile, ...orderedTiles.filter(t => t.peerId !== screenShareTile.peerId)]
    : orderedTiles;

  // DnD handlers
  const onDragStart = (_peerId: string) => { dragSrcRef.current = _peerId; };
  const onDragOver = (_e: React.DragEvent, peerId: string) => {
    _e.preventDefault();
    _e.dataTransfer.dropEffect = 'move';
  };
  const onDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const srcId = dragSrcRef.current;
    if (!srcId || srcId === targetId) return;
    const ids = orderedTiles.map(t => t.peerId);
    const si = ids.indexOf(srcId);
    const ti = ids.indexOf(targetId);
    if (si === -1 || ti === -1) return;
    const next = [...ids];
    next.splice(si, 1);
    next.splice(ti, 0, srcId);
    setTileOrder(next);
    dragSrcRef.current = null;
  };

  const makeDraggable = (peerId: string) => ({
    draggable: true,
    onDragStart: () => onDragStart(peerId),
    onDragOver: (e: React.DragEvent) => onDragOver(e, peerId),
    onDrop: (e: React.DragEvent) => onDrop(e, peerId),
    style: { cursor: 'grab' } as React.CSSProperties,
  });

  if (pinnedPeerId) {
    return (
      <div className="flex flex-col flex-1 gap-2 min-h-0">
        <div className="flex-1 min-h-0">
          {displayTiles.filter(t => t.peerId === pinnedPeerId).map(t => (
            <VideoTile key={t.peerId} {...t} isPinned isHost={t.isHost} activeReaction={tileReactions.get(t.userId)} onPin={() => setPinnedPeerId(null)} />
          ))}
        </div>
        <div className="flex gap-2 flex-shrink-0 overflow-x-auto pb-1">
          {displayTiles.filter(t => t.peerId !== pinnedPeerId).map(t => (
            <div key={t.peerId} className="w-36 sm:w-44 flex-shrink-0 aspect-video" {...makeDraggable(t.peerId)}>
              <VideoTile {...t} isPinned={false} isHost={t.isHost} activeReaction={tileReactions.get(t.userId)} onPin={() => setPinnedPeerId(t.peerId)} small />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const promoteTile = (peerId: string) => setTileOrder(prev => {
          const ids = orderedTiles.map(x => x.peerId);
          const si = ids.indexOf(peerId);
          if (si <= 0) return prev;
          const next = [...ids];
          next.splice(si, 1);
          next.unshift(peerId);
          return next;
        });

  // ── Gallery ────────────────────────────────────────────────────────
  if (layoutMode === 'gallery') {
    return (
      <GalleryLayout
        tiles={displayTiles}
        pinnedPeerId={pinnedPeerId}
        tileReactions={tileReactions}
        makeDraggable={makeDraggable}
        onPin={peerId => setPinnedPeerId(p => p === peerId ? null : peerId)}
      />
    );
  }

  // ── Speaker ────────────────────────────────────────────────────────
  if (layoutMode === 'speaker') {
    return (
      <SpeakerLayout
        tiles={displayTiles}
        tileReactions={tileReactions}
        makeDraggable={makeDraggable}
        onPinSpeaker={peerId => setPinnedPeerId(peerId)}
        onPromoteThumbnail={promoteTile}
      />
    );
  }

  // ── Sidebar ────────────────────────────────────────────────────────
  return (
    <SidebarLayout
      tiles={displayTiles}
      tileReactions={tileReactions}
      makeDraggable={makeDraggable}
      onPinMain={peerId => setPinnedPeerId(p => p === peerId ? null : peerId)}
      onPromoteSidebar={promoteTile}
    />
  );
}
