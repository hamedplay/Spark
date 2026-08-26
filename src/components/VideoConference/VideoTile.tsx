import { useEffect, useRef, useState, memo } from 'react';
import { Crown, Hand, MicOff, VideoOff, Pin, ScreenShare, Play } from 'lucide-react';
import type { PeerConnection } from './types';

function QualityDot({ quality, pingMs }: { quality: PeerConnection['networkQuality']; pingMs?: number }) {
  const c = { excellent: 'bg-green-500', good: 'bg-teal-400', fair: 'bg-amber-400', poor: 'bg-red-500' };
  const title = pingMs !== undefined ? `تأخیر: ${Math.round(pingMs)}ms` : undefined;
  return (
    <span
      className={`w-2 h-2 rounded-full flex-shrink-0 ${c[quality] ?? 'bg-gray-400'}`}
      title={title}
      aria-label={title}
    />
  );
}

export { QualityDot };

// فقط URL های ایمن (https یا blob) را می‌پذیریم
function isSafeAvatarUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'blob:';
  } catch {
    return false;
  }
}

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
  avatarUrl?: string;
  pingMs?: number;
  activeReaction?: string | null;
  onPin: () => void;
  small?: boolean;
}

function safeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0][0].toUpperCase();
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// اندازه‌گیری سطح صدا از MediaStream با AnalyserNode
// وقتی isMuted=true یا track وجود ندارد، مقدار ۰ برمی‌گردد.
function useAudioLevel(stream: MediaStream | null, isMuted: boolean): number {
  const [level, setLevel] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    if (!stream || isMuted || !stream.getAudioTracks().length) {
      setLevel(0);
      return;
    }

    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    let alive = true;
    const tick = () => {
      if (!alive) return;
      analyser.getByteFrequencyData(data);
      const avg = data.reduce((a, b) => a + b, 0) / (data.length * 255);
      setLevel(avg);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      alive = false;
      cancelAnimationFrame(rafRef.current);
      // قبل از بستن context، source را disconnect می‌کنیم تا نشت جلوگیری شود
      source.disconnect();
      ctx.close().catch(() => {});
      setLevel(0);
    };
  }, [stream, isMuted]);

  return level;
}

export const VideoTile = memo(function VideoTile({
  stream, displayName, isMuted, isVideoOff, isHandRaised, isLocal, isPinned,
  isHost, isScreenSharing, networkQuality, avatarUrl, pingMs, activeReaction, onPin, small = false,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [needsPlayGesture, setNeedsPlayGesture] = useState(false);
  const [playError, setPlayError] = useState(false);
  const [imgError, setImgError] = useState(false);

  // وقتی آدرس avatar عوض می‌شود، خطای قبلی را ریست می‌کنیم
  useEffect(() => { setImgError(false); }, [avatarUrl]);

  const audioLevel = useAudioLevel(stream, isMuted);

  // --- stream sync ---
  // از یک flag debounce برای جلوگیری از re-attach همزمان در addtrack/removetrack استفاده می‌کنیم
  const syncPendingRef = useRef(false);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (!stream) { el.srcObject = null; return; }

    el.srcObject = stream;
    el.play().then(() => {
      setNeedsPlayGesture(false);
      setPlayError(false);
    }).catch((err: Error) => {
      if (err.name === 'NotAllowedError') setNeedsPlayGesture(true);
    });

    const syncStream = () => {
      if (syncPendingRef.current) return;
      syncPendingRef.current = true;
      // یک tick صبر می‌کنیم تا رویدادهای addtrack/removetrack متعدد در یک فریم ادغام شوند
      requestAnimationFrame(() => {
        syncPendingRef.current = false;
        const vid = videoRef.current;
        if (!vid) return;
        vid.srcObject = null;
        vid.srcObject = stream;
        vid.play().catch((err: Error) => {
          if (err.name === 'NotAllowedError') setNeedsPlayGesture(true);
        });
      });
    };

    stream.addEventListener('addtrack', syncStream);
    stream.addEventListener('removetrack', syncStream);

    return () => {
      stream.removeEventListener('addtrack', syncStream);
      stream.removeEventListener('removetrack', syncStream);
      el.srcObject = null;
    };
  }, [stream]);

  // وقتی isVideoOff از true به false تغییر می‌کند، ویدیو را play می‌کنیم
  // اما فقط اگر stream موجود باشد و srcObject قبلاً set شده باشد
  useEffect(() => {
    if (isVideoOff) return;
    const el = videoRef.current;
    if (!el || !stream) return;
    // اگر srcObject هنوز set نشده، effect قبلی آن را set خواهد کرد
    if (!el.srcObject) return;
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
  const shouldMirror = isLocal && !isScreenSharing;
  const speakerGlow = !isMuted && audioLevel > 0.05 ? 'ring-2 ring-green-400' : '';
  const ringClass = ring || speakerGlow;
  const showVideo = !isVideoOff && stream;
  const showAvatarImg = !showVideo && isSafeAvatarUrl(avatarUrl) && !imgError;

  return (
    <div
      className={`relative bg-gray-900 rounded-2xl overflow-hidden h-full w-full ${ringClass}`}
      role="group"
      aria-label={isLocal ? `${displayName} (شما)` : displayName}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isLocal}
        className={`w-full h-full ${isScreenSharing ? 'object-contain' : 'object-cover'} ${shouldMirror ? 'scale-x-[-1]' : ''} ${showVideo ? '' : 'hidden'}`}
      />

      {/* آواتار fallback — عکس پروفایل یا حروف اول نام */}
      {!showVideo && (
        <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-800 to-gray-950">
          {showAvatarImg ? (
            <img
              src={avatarUrl}
              alt={displayName}
              className={`rounded-full object-cover ${small ? 'w-10 h-10' : 'w-20 h-20'}`}
              onError={() => setImgError(true)}
            />
          ) : (
            <div className={`rounded-full flex items-center justify-center font-bold text-white bg-gradient-to-br from-teal-600 to-teal-800 ${small ? 'w-10 h-10 text-base' : 'w-20 h-20 text-3xl'}`}>
              {initials}
            </div>
          )}
        </div>
      )}

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

      {isScreenSharing && !small && (
        <div className="absolute top-2 right-2 bg-teal-600/90 rounded-lg px-1.5 py-0.5 flex items-center gap-1 z-10">
          <ScreenShare className="w-3 h-3 text-white" />
          <span className="text-white text-[10px] font-medium">ارائه</span>
        </div>
      )}

      {/* دکمه Pin — روی کیبورد با focus-within قابل دسترس */}
      {!small && (
        <button
          onClick={onPin}
          aria-label={isPinned ? 'لغو پین' : 'پین کردن'}
          aria-pressed={isPinned}
          className={`absolute top-2 left-2 z-10 rounded-lg p-1 transition-opacity
            ${isPinned
              ? 'bg-teal-500/90 opacity-100'
              : 'bg-black/40 opacity-0 hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100'}
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400`}
        >
          <Pin className="w-3 h-3 text-white" />
        </button>
      )}

      {activeReaction && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30"
          style={{ animation: 'tile-reaction 3s ease-out forwards' }}>
          <span className={`${small ? 'text-4xl' : 'text-6xl'} drop-shadow-lg`}>{activeReaction}</span>
        </div>
      )}

      <div className="absolute bottom-0 left-0 right-0 px-2.5 py-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
        <div className="flex items-center gap-1.5">
          <QualityDot quality={networkQuality} pingMs={pingMs} />
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
