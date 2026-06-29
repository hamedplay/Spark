// Shared types for VideoConference layout components
import type { PeerConnection } from './types';

export interface TileProps {
  peerId: string;
  userId: string;
  displayName: string;
  stream: MediaStream | null;
  isMuted: boolean;
  isVideoOff: boolean;
  isHandRaised: boolean;
  isLocal: boolean;
  isHost: boolean;
  isScreenSharing?: boolean;
  networkQuality: PeerConnection['networkQuality'];
  avatarUrl?: string;
  pingMs?: number;
}

export interface DraggableProps {
  draggable: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  style: React.CSSProperties;
}
