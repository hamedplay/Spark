import React, { useEffect, useRef } from 'react';
import { Crown, Hand, MicOff, VideoOff, Pin, ScreenShare } from 'lucide-react';
import type { PeerConnection } from './types';

function QualityDot({ quality }: { quality: PeerConnection['networkQuality'] }) {
  const c = { excellent: 'bg-green-500', good: 'bg-teal-400', fair: 'bg-amber-400', poor: 'bg-red-500' };
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c[quality] ?? 'bg-gray-400'}`} />;
}

export { QualityDot };

interface VideoTileProps {
  stream: MediaStream | null;
  displayName: string;
  isMuted: boolean;
  isVideoOff: boolean;
  isHandRaised: boolean;
  isLocal: boolean;
  isPinned: boolean;
  isHost: boolean;
  isScreenSharing?: boolean;
  networkQuality: PeerConnection['networkQuality'];
  onPin: () => void;
  small?: boolean;
}

export function VideoTile({
  stream, displayName, isMuted, isVideoOff, isHandRaised, isLocal, isPinned,
  isHost, isScreenSharing, networkQuality, onPin, small = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;
    el.srcObject = stream;
    el.play().catch(() => {});

    const onAddTrack = () => {
      el.srcObject = null;
      el.srcObject = stream;
      el.play().catch(() => {});
    };
    stream.addEventListener('addtrack', onAddTrack);
    return () => stream.removeEventListener('addtrack', onAddTrack);
  }, [stream]);

  const initials = displayName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
  const ring = isHandRaised ? 'ring-2 ring-yellow-400' : isPinned ? 'ring-2 ring-teal-400' : '';

  return (
    <div
      className={`relative bg-gray-900 rounded-2xl overflow-hidden cursor-pointer aspect-video ${ring}`}
      onClick={onPin}
    >
      {!isVideoOff && stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={isLocal}
          className={`w-full h-full object-cover ${isLocal ? 'scale-x-[-1]' : ''}`}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950">
          <div className={`rounded-full flex items-center justify-center font-bold text-white bg-gradient-to-br from-teal-600 to-teal-800 ${small ? 'w-10 h-10 text-base' : 'w-20 h-20 text-3xl'}`}>
            {initials}
          </div>
        </div>
      )}

      {/* Screen share badge on tile */}
      {isScreenSharing && !small && (
        <div className="absolute top-2 right-2 bg-teal-600/90 rounded-lg px-1.5 py-0.5 flex items-center gap-1 z-10">
          <ScreenShare className="w-3 h-3 text-white" />
          <span className="text-white text-[10px] font-medium">ارائه</span>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
        <div className="flex items-center gap-1.5">
          <QualityDot quality={networkQuality} />
          <span className={`text-white font-medium truncate flex-1 ${small ? 'text-xs' : 'text-sm'}`}>
            {isLocal ? `${displayName} (شما)` : displayName}
          </span>
          {isHost && <Crown className={`text-amber-400 flex-shrink-0 ${small ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
          {isHandRaised && <Hand className={`text-yellow-400 animate-bounce flex-shrink-0 ${small ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
          {isMuted && <MicOff className={`text-red-400 flex-shrink-0 ${small ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
          {isVideoOff && <VideoOff className={`text-red-400 flex-shrink-0 ${small ? 'w-3 h-3' : 'w-3.5 h-3.5'}`} />}
        </div>
      </div>
      {isPinned && !small && (
        <div className="absolute top-2 left-2 bg-teal-500/90 rounded-lg p-1">
          <Pin className="w-3 h-3 text-white" />
        </div>
      )}
    </div>
  );
}
