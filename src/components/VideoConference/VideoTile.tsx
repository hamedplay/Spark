import React, { useEffect, useRef, useState, memo } from 'react';
import { Crown, Hand, MicOff, VideoOff, Pin, ScreenShare, Play } from 'lucide-react';
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
  audioLevel?: number;
  onPin: () => void;
  small?: boolean;
}

function safeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

export const VideoTile = memo(function VideoTile({
  stream, displayName, isMuted, isVideoOff, isHandRaised, isLocal, isPinned,
  isHost, isScreenSharing, networkQuality, audioLevel = 0, onPin, small = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // fix #1: autoplay rejection (Safari/iOS)
  const [needsPlayGesture, setNeedsPlayGesture] = useState(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;

    el.srcObject = stream;
    el.play().then(() => {
      setNeedsPlayGesture(false);
    }).catch((err: Error) => {
      if (err.name === 'NotAllowedError') setNeedsPlayGesture(true);
    });

    // fix #3: handle track changes (addtrack + removetrack)
    const syncStream = () => {
      el.srcObject = null;
      el.srcObject = stream;
      el.play().catch((err: Error) => {
        if (err.name === 'NotAllowedError') setNeedsPlayGesture(true);
      });
    };
    stream.addEventListener('addtrack', syncStream);
    stream.addEventListener('removetrack', syncStream);

    return () => {
      stream.removeEventListener('addtrack', syncStream);
      stream.removeEventListener('removetrack', syncStream);
      // fix #2: clear srcObject on cleanup to release media resources
      el.srcObject = null;
    };
  }, [stream]);

  // Re-sync when isVideoOff changes (track may have been added/removed)
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream || isVideoOff) return;
    el.play().catch((err: Error) => {
      if (err.name === 'NotAllowedError') setNeedsPlayGesture(true);
    });
  }, [isVideoOff, stream]);

  const handlePlayGesture = () => {
    videoRef.current?.play().then(() => setNeedsPlayGesture(false)).catch(() => {});
  };

  const initials = safeInitials(displayName);
  const ring = isHandRaised ? 'ring-2 ring-yellow-400' : isPinned ? 'ring-2 ring-teal-400' : '';

  // fix #8: only mirror local camera, not screen share
  const shouldMirror = isLocal && !isScreenSharing;

  // active speaker glow when audioLevel > threshold
  const speakerGlow = !isMuted && audioLevel > 0.15 ? 'ring-2 ring-green-400' : '';
  const ringClass = ring || speakerGlow;

  const showVideo = !isVideoOff && stream;

  return (
    <div
      className={`relative bg-gray-900 rounded-2xl overflow-hidden aspect-video ${ringClass}`}
      role="group"
      aria-label={`تایل ویدیو ${isLocal ? `(شما) ${displayName}` : displayName}`}
    >
      {/* Video element — always mounted so srcObject assignment works */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-full ${isScreenSharing ? 'object-contain' : 'object-cover'} ${shouldMirror ? 'scale-x-[-1]' : ''} ${showVideo ? '' : 'hidden'}`}
      />

      {/* Avatar fallback */}
      {!showVideo && (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950">
          <div className={`rounded-full flex items-center justify-center font-bold text-white bg-gradient-to-br from-teal-600 to-teal-800 ${small ? 'w-10 h-10 text-base' : 'w-20 h-20 text-3xl'}`}>
            {initials}
          </div>
        </div>
      )}

      {/* fix #1: autoplay blocked overlay */}
      {needsPlayGesture && (
        <button
          onClick={handlePlayGesture}
          aria-label="کلیک برای پخش ویدیو"
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-20 gap-2 cursor-pointer"
        >
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
            <Play className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xs">کلیک برای پخش</span>
        </button>
      )}

      {/* Screen share badge */}
      {isScreenSharing && !small && (
        <div className="absolute top-2 right-2 bg-teal-600/90 rounded-lg px-1.5 py-0.5 flex items-center gap-1 z-10">
          <ScreenShare className="w-3 h-3 text-white" />
          <span className="text-white text-[10px] font-medium">ارائه</span>
        </div>
      )}

      {/* Pin button (hover, top-left corner) */}
      {!small && (
        <button
          onClick={onPin}
          aria-label={isPinned ? 'لغو پین' : 'پین کردن'}
          aria-pressed={isPinned}
          className={`absolute top-2 left-2 z-10 rounded-lg p-1 transition-opacity ${
            isPinned
              ? 'bg-teal-500/90 opacity-100'
              : 'bg-black/40 opacity-0 hover:opacity-100 focus:opacity-100 group-hover:opacity-100'
          }`}
          onKeyDown={e => e.key === 'Enter' && onPin()}
        >
          <Pin className="w-3 h-3 text-white" />
        </button>
      )}

      {/* Bottom bar */}
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
    </div>
  );
});

export { VideoTile, QualityDot }