import { useState, useEffect, useRef, type RefObject } from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, ShieldCheck, ShieldAlert, Loader, Check, Wifi, WifiOff, Volume2, VolumeX, Monitor, MonitorOff, ArrowLeftRight, Info, PictureInPicture2, FlipHorizontal2 as FlipHorizontal } from 'lucide-react';
import type { PeerDiagnostics } from '../../../lib/webrtcDiagnostics';
import type { CallPhase, E2EEStatus, UserProfile } from './types';

type PipCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

interface Props {
  phase: CallPhase;
  targetUser: UserProfile | null;
  localVideoRef: RefObject<HTMLVideoElement>;
  remoteVideoRef: RefObject<HTMLVideoElement>;
  isMuted: boolean;
  isVideoOff: boolean;
  isRemoteMuted: boolean;
  isScreenSharing: boolean;
  connDiag: PeerDiagnostics | null;
  isOffline: boolean;
  e2eeStatus: E2EEStatus;
  safetyNums: string[] | null;
  showSafety: boolean;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleScreenShare: () => void;
  onSwitchCamera: () => void;
  onHangup: () => void;
  onToggleRemoteMute: () => void;
  onShowSafety: () => void;
  onCloseSafety: () => void;
  onVerifySafety: () => void;
}

function E2EEBadge({ status, onClick }: { status: E2EEStatus; onClick: () => void }) {
  let icon: React.ReactNode;
  let label: string;
  let cls: string;

  if (status === 'active_verified') {
    icon = <ShieldCheck aria-hidden="true" className="w-3.5 h-3.5" />;
    label = 'E2EE تأییدشده';
    cls = 'bg-emerald-900/80 text-emerald-300';
  } else if (status === 'active_unverified') {
    icon = <ShieldAlert aria-hidden="true" className="w-3.5 h-3.5" />;
    label = 'E2EE — هویت تأییدنشده';
    cls = 'bg-amber-900/80 text-amber-300';
  } else if (status === 'error') {
    icon = <ShieldAlert aria-hidden="true" className="w-3.5 h-3.5" />;
    label = 'خطای رمزنگاری';
    cls = 'bg-red-900/80 text-red-300';
  } else {
    icon = <Loader aria-hidden="true" className="w-3.5 h-3.5 animate-spin" />;
    label = 'در انتظار کلید رمزنگاری...';
    cls = 'bg-gray-800/80 text-gray-300';
  }

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`وضعیت رمزنگاری: ${label}`}
      className={`absolute top-3 left-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}
    >
      {icon} {label}
    </button>
  );
}

function SafetyModal({ safetyNums, onVerify, onClose }: {
  safetyNums: string[];
  onVerify: () => void;
  onClose: () => void;
}) {
  const firstButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Restore focus on unmount
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    firstButtonRef.current?.focus();
    return () => { previouslyFocused?.focus(); };
  }, []);

  // Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus trap
  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const focusable = modal.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-modal-title"
        className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto"
        dir="rtl"
      >
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="w-5 h-5 text-emerald-400" />
          <h3 id="safety-modal-title" className="font-bold text-white">شماره اطمینان</h3>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          این کد را از طریق کانالی مستقل (تلفن یا ملاقات حضوری) با مخاطب مقایسه کنید.
          اگر یکسان بود، هیچ MITM در تبادل کلید وجود نداشته است.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {safetyNums.map((g, i) => (
            <div key={i} className="bg-gray-800 rounded-lg px-3 py-2 text-center font-mono text-sm tracking-widest text-gray-200">
              {g}
            </div>
          ))}
        </div>
        <p className="text-xs text-amber-400 flex items-center gap-1">
          <ShieldAlert aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
          این کد فقط برای این جلسه معتبر است و هر بار تغییر می‌کند.
          Metadata تماس (IP، مدت، codec) توسط E2EE محافظت نمی‌شود.
        </p>
        <div className="flex gap-2">
          <button
            ref={firstButtonRef}
            type="button"
            onClick={onVerify}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1"
          >
            <Check aria-hidden="true" className="w-4 h-4" /> مطابقت دارد
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-xl text-sm transition-colors"
          >
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

const PIP_CORNER_CLASSES: Record<PipCorner, string> = {
  'top-right':    'top-3 right-3',
  'top-left':     'top-3 left-3',
  'bottom-right': 'bottom-20 right-3',
  'bottom-left':  'bottom-20 left-3',
};

export function ActiveCallView({
  phase, targetUser, localVideoRef, remoteVideoRef,
  isMuted, isVideoOff, isRemoteMuted, isScreenSharing,
  connDiag, isOffline, e2eeStatus, safetyNums, showSafety,
  onToggleMute, onToggleVideo, onToggleScreenShare, onSwitchCamera, onHangup,
  onToggleRemoteMute, onShowSafety, onCloseSafety, onVerifySafety,
}: Props) {
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [pipCorner, setPipCorner] = useState<PipCorner>('bottom-right');
  const [isDragging, setIsDragging] = useState(false);
  const [isSwapped, setIsSwapped] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isNativePip, setIsNativePip] = useState(false);

  const pipRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });

  // Manage remote video playback — muted prop has a known React bug, use imperative API
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || (phase !== 'connecting' && phase !== 'connected')) return;
    video.muted = isRemoteMuted;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
      setNeedsAudioTap(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRemoteMuted, phase]);

  // Reset needsAudioTap when phase ends
  useEffect(() => {
    if (phase !== 'connecting' && phase !== 'connected') setNeedsAudioTap(false);
  }, [phase]);

  // Native PiP leave event — fires on the video element, not document
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    const handleLeave = () => setIsNativePip(false);
    video.addEventListener('leavepictureinpicture', handleLeave);
    return () => video.removeEventListener('leavepictureinpicture', handleLeave);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Drag handlers ────────────────────────────────────────────────────────

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !pipRef.current) return;
    const container = pipRef.current.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const pipRect = pipRef.current.getBoundingClientRect();
    let x = e.clientX - containerRect.left - dragOffsetRef.current.x;
    let y = e.clientY - containerRect.top - dragOffsetRef.current.y;
    x = Math.max(8, Math.min(x, containerRect.width - pipRect.width - 8));
    y = Math.max(8, Math.min(y, containerRect.height - pipRect.height - 8));
    pipRef.current.style.left = `${x}px`;
    pipRef.current.style.top = `${y}px`;
    pipRef.current.style.right = 'auto';
    pipRef.current.style.bottom = 'auto';
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !pipRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDragging(false);
    const container = pipRef.current.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const pipRect = pipRef.current.getBoundingClientRect();
    const centerX = pipRect.left + pipRect.width / 2 - containerRect.left;
    const centerY = pipRect.top + pipRect.height / 2 - containerRect.top;
    const isLeft = centerX < containerRect.width / 2;
    const isTop = centerY < containerRect.height / 2;
    const corner: PipCorner =
      isTop && isLeft ? 'top-left' :
      isTop ? 'top-right' :
      isLeft ? 'bottom-left' : 'bottom-right';
    setPipCorner(corner);
    pipRef.current.style.left = '';
    pipRef.current.style.top = '';
    pipRef.current.style.right = '';
    pipRef.current.style.bottom = '';
  };

  // ── Native PiP ────────────────────────────────────────────────────────────

  const [supportsPiP, setSupportsPiP] = useState(false);
  useEffect(() => {
    const video = remoteVideoRef.current;
    const v = video as (HTMLVideoElement & { webkitSupportsPresentationMode?: (m: string) => boolean }) | null;
    setSupportsPiP(
      !!document.pictureInPictureEnabled ||
      !!v?.webkitSupportsPresentationMode?.('picture-in-picture')
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const handleNativePip = async () => {
    const video = remoteVideoRef.current;
    if (!video) return;
    try {
      // Standard API (Chrome, Android, Firefox)
      if (document.pictureInPictureEnabled) {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          setIsNativePip(false);
        } else {
          await video.requestPictureInPicture();
          setIsNativePip(true);
        }
        return;
      }
      // Webkit API (iOS Safari)
      const v = video as HTMLVideoElement & {
        webkitSupportsPresentationMode?: (m: string) => boolean;
        webkitPresentationMode?: string;
        webkitSetPresentationMode?: (m: string) => void;
      };
      if (v.webkitSupportsPresentationMode?.('picture-in-picture') && v.webkitSetPresentationMode) {
        const isPiP = v.webkitPresentationMode === 'picture-in-picture';
        v.webkitSetPresentationMode(isPiP ? 'inline' : 'picture-in-picture');
        setIsNativePip(!isPiP);
      }
    } catch { /* denied or unsupported */ }
  };

  // ── Layout ────────────────────────────────────────────────────────────────

  // Remote video: full-screen when not swapped, PiP corner when swapped
  const remoteVideoClass = isSwapped
    ? `absolute ${PIP_CORNER_CLASSES[pipCorner]} w-28 h-36 sm:w-32 sm:h-40 rounded-xl border-2 border-blue-500/50 object-cover z-10 overflow-hidden`
    : 'absolute inset-0 w-full h-full object-cover z-0';

  // PiP wrapper for local video: active when not swapped; local fills bg when swapped
  const pipWrapperClass = isSwapped
    ? 'absolute inset-0 w-full h-full z-0 overflow-hidden'
    : [
        'absolute z-10 overflow-hidden rounded-xl border-2 border-blue-500/50 shadow-xl cursor-move',
        'w-28 h-36 sm:w-32 sm:h-40',
        !isDragging ? 'transition-all duration-200' : '',
        PIP_CORNER_CLASSES[pipCorner],
      ].join(' ');

  return (
    <>
      {/* Screen reader status announcements */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {e2eeStatus === 'active_verified' && 'رمزنگاری تأییدشده'}
        {e2eeStatus === 'active_unverified' && 'رمزنگاری فعال، هویت تأییدنشده'}
        {e2eeStatus === 'error' && 'خطای رمزنگاری'}
        {isOffline && 'اتصال قطع شد'}
      </div>

      <div className="relative h-[calc(100dvh-8rem)] sm:h-[540px] bg-gray-950 rounded-2xl overflow-hidden">

        {/* Remote video — position determined by isSwapped */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className={remoteVideoClass}
        />

        {/* Local video — draggable PiP by default, full-bg when swapped */}
        <div
          ref={!isSwapped ? pipRef : undefined}
          onPointerDown={!isSwapped ? handlePointerDown : undefined}
          onPointerMove={!isSwapped ? handlePointerMove : undefined}
          onPointerUp={!isSwapped ? handlePointerUp : undefined}
          className={pipWrapperClass}
          style={!isSwapped ? { touchAction: 'none' } : undefined}
        >
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        </div>

        {/* Connecting overlay */}
        {phase === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/80 z-30">
            <Loader aria-hidden="true" className="w-8 h-8 text-emerald-400 animate-spin" />
            <span className="text-white text-sm">در حال اتصال...</span>
          </div>
        )}

        {/* Tap to unmute overlay */}
        {needsAudioTap && (
          <button
            type="button"
            onClick={() => {
              const v = remoteVideoRef.current;
              if (v) { v.muted = false; v.play().catch(() => {}); }
              setNeedsAudioTap(false);
            }}
            className="absolute bottom-24 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-blue-600/90 hover:bg-blue-600 text-white text-sm px-4 py-2.5 rounded-full shadow-lg z-30 whitespace-nowrap"
          >
            <Volume2 aria-hidden="true" className="w-4 h-4" />
            ضربه بزنید برای فعال‌سازی صدا
          </button>
        )}

        {/* Stats overlay */}
        {showStats && connDiag && (
          <div className="absolute top-12 left-3 bg-black/75 text-white p-3 rounded-lg text-xs z-30 font-mono space-y-0.5 min-w-[140px]">
            <div>نوع: {connDiag.selectedCandidatePair?.localType === 'relay' ? 'TURN' : 'P2P'}</div>
            {connDiag.rttMs !== null && <div>RTT: {connDiag.rttMs}ms</div>}
            {connDiag.inboundBitrateKbps !== null && <div>↓ {connDiag.inboundBitrateKbps} kbps</div>}
            {connDiag.outboundBitrateKbps !== null && <div>↑ {connDiag.outboundBitrateKbps} kbps</div>}
            {connDiag.packetLossPct !== null && <div>Loss: {connDiag.packetLossPct}%</div>}
          </div>
        )}

        {/* E2EE badge */}
        {(phase === 'connecting' || phase === 'connected') && (
          <E2EEBadge status={e2eeStatus} onClick={onShowSafety} />
        )}

        {/* Peer name */}
        {targetUser && (
          <div className="absolute top-3 right-3 text-white/70 text-sm font-medium drop-shadow-sm z-20">
            {targetUser.full_name || targetUser.email || 'مخاطب'}
          </div>
        )}

        {/* Network / QoS */}
        {phase === 'connected' && (
          <div className="absolute top-10 right-3 flex items-center gap-1.5 z-20">
            {isOffline ? (
              <span className="flex items-center gap-1 text-[10px] text-red-400 bg-black/50 px-2 py-0.5 rounded-full">
                <WifiOff aria-hidden="true" className="w-3 h-3" /> قطع
              </span>
            ) : connDiag ? (
              <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-black/50 ${connDiag.rttMs !== null && connDiag.rttMs > 400 ? 'text-amber-400' : 'text-emerald-400'}`}>
                <Wifi aria-hidden="true" className="w-3 h-3" />
                {connDiag.selectedCandidatePair?.localType === 'relay' ? 'TURN' : 'P2P'}
                {connDiag.rttMs !== null ? ` · ${connDiag.rttMs}ms` : ''}
              </span>
            ) : null}
          </div>
        )}

        {/* Controls */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 z-20 flex-wrap justify-center px-2">
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={isMuted ? 'فعال‌سازی صدا' : 'خاموش کردن صدا'}
            className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`}
          >
            {isMuted ? <MicOff aria-hidden="true" className="w-5 h-5 text-white" /> : <Mic aria-hidden="true" className="w-5 h-5 text-white" />}
          </button>

          <button
            type="button"
            onClick={onToggleScreenShare}
            aria-label={isScreenSharing ? 'توقف اشتراک صفحه' : 'اشتراک‌گذاری صفحه'}
            className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors ${isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'}`}
          >
            {isScreenSharing ? <MonitorOff aria-hidden="true" className="w-5 h-5 text-white" /> : <Monitor aria-hidden="true" className="w-5 h-5 text-white" />}
          </button>

          <button
            type="button"
            onClick={onHangup}
            aria-label="پایان تماس"
            className="w-14 h-14 min-w-[52px] min-h-[52px] rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors"
          >
            <PhoneOff aria-hidden="true" className="w-6 h-6 text-white" />
          </button>

          <button
            type="button"
            onClick={onToggleVideo}
            aria-label={isVideoOff ? 'روشن کردن دوربین' : 'خاموش کردن دوربین'}
            className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`}
          >
            {isVideoOff ? <VideoOff aria-hidden="true" className="w-5 h-5 text-white" /> : <Video aria-hidden="true" className="w-5 h-5 text-white" />}
          </button>

          <button
            type="button"
            onClick={onSwitchCamera}
            aria-label="تغییر دوربین"
            className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors bg-white/20 hover:bg-white/30"
          >
            <FlipHorizontal aria-hidden="true" className="w-5 h-5 text-white" />
          </button>

          <button
            type="button"
            onClick={onToggleRemoteMute}
            aria-label={isRemoteMuted ? 'فعال کردن صدای طرف مقابل' : 'بی‌صدا کردن طرف مقابل'}
            className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors ${isRemoteMuted ? 'bg-amber-500 hover:bg-amber-600' : 'bg-white/20 hover:bg-white/30'}`}
          >
            {isRemoteMuted ? <VolumeX aria-hidden="true" className="w-5 h-5 text-white" /> : <Volume2 aria-hidden="true" className="w-5 h-5 text-white" />}
          </button>

          <button
            type="button"
            onClick={() => setIsSwapped(v => !v)}
            aria-label="تعویض موقعیت ویدیوها"
            className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors ${isSwapped ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'}`}
          >
            <ArrowLeftRight aria-hidden="true" className="w-4 h-4 text-white" />
          </button>

          <button
            type="button"
            onClick={() => setShowStats(v => !v)}
            aria-label="نمایش آمار تماس"
            className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors ${showStats ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'}`}
          >
            <Info aria-hidden="true" className="w-4 h-4 text-white" />
          </button>

          {supportsPiP && (
            <button
              type="button"
              onClick={handleNativePip}
              aria-label="حالت تصویر در تصویر"
              className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-colors ${isNativePip ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'}`}
            >
              <PictureInPicture2 aria-hidden="true" className="w-4 h-4 text-white" />
            </button>
          )}
        </div>
      </div>

      {/* Safety Number Modal */}
      {showSafety && safetyNums && (
        <SafetyModal
          safetyNums={safetyNums}
          onVerify={onVerifySafety}
          onClose={onCloseSafety}
        />
      )}
    </>
  );
}
