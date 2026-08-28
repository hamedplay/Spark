import { useEffect, useState } from 'react';
import { Loader2, Lock } from 'lucide-react';
import type { Room } from 'livekit-client';
import { useConferenceClient } from '../../../../components/VideoConference/conferenceClient';
import { useConferenceWhiteboard } from '../../hooks/useConferenceWhiteboard';
import type {
  ConferenceAuthorization,
  ConferenceWhiteboardElement,
  ConferenceWhiteboardPoint,
  ConferenceWhiteboardTool,
} from '../../types/conference.types';
import { ConferenceWhiteboardCanvas } from './ConferenceWhiteboardCanvas';
import { ConferenceWhiteboardToolbar } from './ConferenceWhiteboardToolbar';

interface Props {
  room: Room;
  roomId: string;
  currentUserId: string;
  currentUserName: string;
  authorization: ConferenceAuthorization;
}

export function ConferenceWhiteboardPanel({
  room,
  roomId,
  currentUserId,
  currentUserName,
  authorization,
}: Props) {
  const client = useConferenceClient();
  const whiteboard = useConferenceWhiteboard({
    client,
    room,
    roomId,
    currentUserId,
    currentUserName,
    authorization,
  });
  const [tool, setTool] = useState<ConferenceWhiteboardTool>('pen');
  const [color, setColor] = useState('#111827');
  const [width, setWidth] = useState(4);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<ConferenceWhiteboardPoint>({ x: 0, y: 0 });

  useEffect(() => {
    if (!whiteboard.canEdit && tool !== 'pan' && tool !== 'laser') {
      setTool('pan');
    }
  }, [tool, whiteboard.canEdit]);

  if (!whiteboard.snapshot.loaded || !whiteboard.currentPage) {
    return (
      <div className="flex min-h-[50dvh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  const createElement = async (element: ConferenceWhiteboardElement) => {
    if (!whiteboard.currentPage) return;
    await whiteboard.upsertElement(whiteboard.currentPage.id, element);
  };

  const deleteElement = async (element: ConferenceWhiteboardElement) => {
    if (!whiteboard.currentPage) return;
    await whiteboard.deleteElement(whiteboard.currentPage.id, element);
  };

  const uploadImage = async (file: File) => {
    const page = whiteboard.currentPage;
    if (!page) return;

    const start = {
      x: Math.max(20, (80 - pan.x) / zoom),
      y: Math.max(20, (80 - pan.y) / zoom),
    };
    const end = { x: start.x + 320, y: start.y + 220 };
    try {
      await whiteboard.uploadImage(page.id, file, [start, end]);
    } catch (error) {
      console.error('[VideoConference] whiteboard image upload failed', error);
    }
  };

  return (
    <div className="flex h-[min(72dvh,760px)] min-h-[480px] flex-col overflow-hidden bg-slate-900">
      <ConferenceWhiteboardToolbar
        pages={whiteboard.snapshot.pages}
        selectedPageId={whiteboard.selectedPageId}
        tool={tool}
        color={color}
        width={width}
        zoom={zoom}
        canUse={whiteboard.canUse}
        canEdit={whiteboard.canEdit}
        canManage={whiteboard.canManage}
        locked={whiteboard.snapshot.boardLocked}
        busy={whiteboard.busy}
        canUndo={whiteboard.canUndo}
        canRedo={whiteboard.canRedo}
        onSelectPage={whiteboard.selectPage}
        onToolChange={setTool}
        onColorChange={setColor}
        onWidthChange={setWidth}
        onZoomChange={setZoom}
        onResetView={() => {
          setZoom(1);
          setPan({ x: 0, y: 0 });
        }}
        onUndo={whiteboard.undo}
        onRedo={whiteboard.redo}
        onAddPage={() => whiteboard.addPage()}
        onDeletePage={whiteboard.deletePage}
        onRenamePage={whiteboard.renamePage}
        onClearPage={whiteboard.clearPage}
        onToggleLock={whiteboard.toggleLock}
        onImageFile={uploadImage}
      />

      {whiteboard.snapshot.boardLocked && !whiteboard.canManage && (
        <div className="flex items-center gap-2 border-b border-amber-500/20 bg-amber-950/50 px-3 py-2 text-[10px] text-amber-200">
          <Lock className="h-3.5 w-3.5" />
          تخته توسط مدیر جلسه قفل شده است؛ مشاهده، جابه‌جایی و بزرگ‌نمایی همچنان فعال است.
        </div>
      )}

      {whiteboard.errorMessage && (
        <div className="border-b border-rose-500/20 bg-rose-950/60 px-3 py-2 text-[10px] text-rose-200" role="status">
          {whiteboard.errorMessage}
        </div>
      )}

      <div className="min-h-0 flex-1 p-2">
        <ConferenceWhiteboardCanvas
          page={whiteboard.currentPage}
          tool={tool}
          color={color}
          width={width}
          zoom={zoom}
          pan={pan}
          canEdit={whiteboard.canEdit}
          presence={whiteboard.presence}
          assetUrls={whiteboard.assetUrls}
          onPanChange={setPan}
          onZoomChange={setZoom}
          onCreateElement={createElement}
          onDeleteElement={deleteElement}
          onPresence={(point, laser) => {
            if (whiteboard.currentPage) {
              whiteboard.publishPresence(whiteboard.currentPage.id, point, laser);
            }
          }}
        />
      </div>
    </div>
  );
}
