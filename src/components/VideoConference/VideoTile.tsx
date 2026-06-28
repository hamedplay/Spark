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
  /** @deprecated audioLevel is measured internally via WebAudioContext; this prop is ignored */
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

// Measure audio level from a MediaStream using WebAudio AnalyserNode.
// Returns a value 0–1. Only runs when stream has audio tracks and isMuted=false.
function useAudioLevel(stream: MediaStream | null, isMuted: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number>(0);
  const ctxRef = useRef<AudioContext | null>(null);

  useEffect(() => {
    if (!stream || isMuted) {
      setLevel(0);
      return;
    }
    if (!stream.getAudioTracks().length) return;

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return; // WebAudio not available (e.g., headless environment)
    }
    ctxRef.current = ctx;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / (data.length * 255);
      setLevel(avg);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ctx.close().catch(() => {});
      ctxRef.current = null;
      setLevel(0);
    };
  }, [stream, isMuted]);

  return level;
}

export const VideoTile = memo(function VideoTile({
  stream, displayName, isMuted, isVideoOff, isHandRaised, isLocal, isPinned,
  isHost, isScreenSharing, networkQuality, onPin, small = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  // fix: autoplay rejection (Safari/iOS)
  const [needsPlayGesture, setNeedsPlayGesture] = useState(false);
  const [playError, setPlayError] = useState(false);

  // Real audio level measurement — works for both local and remote streams
  const audioLevel = useAudioLevel(stream, isMuted);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !stream) return;

    el.srcObject = stream;
    el.play().then(() => {
      setNeedsPlayGesture(false);
      setPlayError(false);
    }).catch((err: Error) => {
      if (err.name === 'NotAllowedError') setNeedsPlayGesture(true);
    });

    // fix: handle track changes (addtrack + removetrack)
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
      // fix: clear srcObject on cleanup to release media resources
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
    setPlayError(false);
    videoRef.current?.play()
      .then(() => { setNeedsPlayGesture(false); setPlayError(false); })
      .catch(() => { setPlayError(true); });
  };

  const initials = safeInitials(displayName);
  const ring = isHandRaised ? 'ring-2 ring-yellow-400' : isPinned ? 'ring-2 ring-teal-400' : '';

  // fix: only mirror local camera, not screen share
  const shouldMirror = isLocal && !isScreenSharing;

  // active speaker glow — driven by real WebAudio measurement
  const speakerGlow = !isMuted && audioLevel > 0.05 ? 'ring-2 ring-green-400' : '';
  const ringClass = ring || speakerGlow;

  const showVideo = !isVideoOff && stream;

  return (
    <div
      className={`relative bg-gray-900 rounded-2xl overflow-hidden aspect-video ${ringClass}`}
      role="group"
      aria-label={isLocal ? `${displayName} (شما)` : displayName}
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

      {/* fix: autoplay blocked overlay — shows error feedback if retry also fails */}
      {needsPlayGesture && (
        <button
          onClick={handlePlayGesture}
          aria-label="کلیک برای پخش ویدیو"
          className="absolute inset-0 flex flex-col items-center justify-center bg-black/70 z-20 gap-2 cursor-pointer"
        >
          <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
            <Play className="w-6 h-6 text-white" />
          </div>
          <span className="text-white text-xs">
            {playError ? 'پخش ممکن نیست — لطفاً مرورگر را بررسی کنید' : 'کلیک برای پخش'}
          </span>
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
