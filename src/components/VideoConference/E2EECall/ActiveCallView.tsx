import {
  useState, useEffect, useRef, useCallback, type RefObject,
} from 'react';
import { Mic, MicOff, Video, VideoOff, PhoneOff, ShieldCheck, ShieldAlert, Loader, Check, Wifi, WifiOff, Volume2, VolumeX, Monitor, MonitorOff, ArrowLeftRight, Info, PictureInPicture2, FlipHorizontal2 as FlipHorizontal, MoveHorizontal as MoreHorizontal, X } from 'lucide-react';
import type { PeerDiagnostics } from '../../../lib/webrtcDiagnostics';
import type { CallPhase, E2EEStatus, UserProfile } from './types';
import toast from 'react-hot-toast';

// ── Shared utility ────────────────────────────────────────────────────────

export function getUserInitials(nameOrEmail: string | null | undefined): string {
  if (!nameOrEmail) return '?';
  const name = nameOrEmail.trim();
  if (!name) return '?';
  const parts = name.split(/\s+/);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

// ── PiP capability detection ──────────────────────────────────────────────

function supportsStandardVideoPiP(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  if (typeof video.requestPictureInPicture !== 'function') return false;
  if (video.disablePictureInPicture) return false;
  return typeof document.pictureInPictureEnabled !== 'undefined' && !!document.pictureInPictureEnabled;
}

function supportsWebKitVideoPiP(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  const v = video as HTMLVideoElement & { webkitSupportsPresentationMode?: (m: string) => boolean };
  return typeof v.webkitSupportsPresentationMode === 'function' &&
    v.webkitSupportsPresentationMode('picture-in-picture');
}

function supportsVideoPiP(video: HTMLVideoElement | null): boolean {
  return supportsStandardVideoPiP(video) || supportsWebKitVideoPiP(video);
}

// ── Screen share capability ───────────────────────────────────────────────

const SUPPORTS_SCREEN_SHARE =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getDisplayMedia === 'function';

// ── Network quality ───────────────────────────────────────────────────────

type NetQuality = 'good' | 'poor' | 'offline';

function getNetworkQuality(connDiag: PeerDiagnostics | null, isOffline: boolean): NetQuality {
  if (isOffline) return 'offline';
  if (!connDiag) return 'good';
  if ((connDiag.rttMs !== null && connDiag.rttMs > 400) ||
      (connDiag.packetLossPct !== null && connDiag.packetLossPct > 5)) return 'poor';
  return 'good';
}

// ── Corner snap ───────────────────────────────────────────────────────────

type PipCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

const CORNER_STYLE: Record<PipCorner, React.CSSProperties> = {
  'top-right':    { top: 12,   right: 12,  left: 'auto',  bottom: 'auto' },
  'top-left':     { top: 12,   left:  12,  right: 'auto', bottom: 'auto' },
  'bottom-right': { bottom: 88, right: 12, left: 'auto',  top: 'auto'   },
  'bottom-left':  { bottom: 88, left:  12, right: 'auto', top: 'auto'   },
};

// ── CallControlButton ─────────────────────────────────────────────────────

interface CtrlBtnProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  large?: boolean;
  onClick: () => void;
}

function CallControlButton({ icon, label, active, danger, loading, disabled, large, onClick }: CtrlBtnProps) {
  const size = large ? 'w-14 h-14 min-w-[52px] min-h-[52px]' : 'w-12 h-12 min-w-[44px] min-h-[44px]';
  let bg: string;
  if (danger)      bg = 'bg-red-600 hover:bg-red-700 active:bg-red-800';
  else if (active) bg = 'bg-white/30 hover:bg-white/40';
  else             bg = 'bg-black/40 hover:bg-black/60 active:bg-black/70';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled || loading}
      className={[
        size, 'rounded-full flex items-center justify-center transition-all backdrop-blur-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        bg, (disabled || loading) ? 'opacity-50 pointer-events-none' : '',
      ].join(' ')}
    >
      {loading
        ? <Loader aria-hidden="true" className="w-4 h-4 text-white animate-spin" />
        : icon
      }
    </button>
  );
}

// ── SafetyModal ───────────────────────────────────────────────────────────

function SafetyModal({ safetyNums, onVerify, onClose }: {
  safetyNums: string[];
  onVerify: () => void;
  onClose: () => void;
}) {
  const firstBtnRef = useRef<HTMLButtonElement>(null);
  const modalRef    = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    firstBtnRef.current?.focus();
    return () => { prev?.focus(); };
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const els   = modal.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    const first = els[0]; const last = els[els.length - 1];
    const trap  = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else            { if (document.activeElement === last)  { e.preventDefault(); first.focus(); } }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="safety-title"
        className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto" dir="rtl">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="w-5 h-5 text-emerald-400" />
          <h3 id="safety-title" className="font-bold text-white">شماره اطمینان</h3>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">
          این کد را از طریق کانالی مستقل با مخاطب مقایسه کنید. اگر یکسان بود، تبادل کلید بدون واسطه انجام شده است.
        </p>
        <div className="grid grid-cols-2 gap-2">
          {safetyNums.map((g, i) => (
            <div key={i} className="bg-gray-800 rounded-lg px-3 py-2 text-center font-mono text-sm tracking-widest text-gray-200">{g}</div>
          ))}
        </div>
        <p className="text-xs text-amber-400 flex items-center gap-1">
          <ShieldAlert aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
          این کد فقط برای این جلسه معتبر است.
        </p>
        <div className="flex gap-2">
          <button ref={firstBtnRef} type="button" onClick={onVerify}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1">
            <Check aria-hidden="true" className="w-4 h-4" /> مطابقت دارد
          </button>
          <button type="button" onClick={onClose}
            className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-xl text-sm transition-colors">
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

// ── MorePanel (bottom sheet) ──────────────────────────────────────────────

interface MorePanelProps {
  isScreenSharing: boolean;
  isStartingScreenShare: boolean;
  isSwitchingCamera: boolean;
  isRemoteMuted: boolean;
  isSwapped: boolean;
  showStats: boolean;
  isNativePip: boolean;
  supportsPiP: boolean;
  onToggleScreenShare: () => void;
  onSwitchCamera: () => void;
  onToggleRemoteMute: () => void;
  onSwap: () => void;
  onToggleStats: () => void;
  onNativePip: () => void;
  onClose: () => void;
}

function MorePanel({
  isScreenSharing, isStartingScreenShare, isSwitchingCamera,
  isRemoteMuted, isSwapped, showStats, isNativePip, supportsPiP,
  onToggleScreenShare, onSwitchCamera, onToggleRemoteMute,
  onSwap, onToggleStats, onNativePip, onClose,
}: MorePanelProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const row = 'flex items-center gap-3 w-full px-4 py-3.5 text-right rounded-xl transition-colors hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-40 disabled:pointer-events-none';
  const ic  = 'w-5 h-5 shrink-0';

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog" aria-modal="true" aria-label="گزینه‌های بیشتر"
        dir="rtl"
        className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900/97 border-t border-white/10 rounded-t-2xl pt-4 px-3 space-y-1 max-h-[70vh] overflow-y-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
      >
        <div className="flex items-center justify-between px-2 pb-3 border-b border-white/10">
          <span className="text-white font-semibold text-sm">گزینه‌های بیشتر</span>
          <button type="button" onClick={onClose} aria-label="بستن"
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none">
            <X aria-hidden="true" className="w-4 h-4" />
          </button>
        </div>

        {SUPPORTS_SCREEN_SHARE && (
          <button type="button" onClick={() => { onToggleScreenShare(); onClose(); }}
            disabled={isStartingScreenShare} className={row}>
            {isStartingScreenShare
              ? <Loader aria-hidden="true" className={`${ic} text-blue-400 animate-spin`} />
              : isScreenSharing
                ? <MonitorOff aria-hidden="true" className={`${ic} text-blue-400`} />
                : <Monitor    aria-hidden="true" className={`${ic} text-gray-300`} />
            }
            <span className="text-sm text-gray-200">
              {isStartingScreenShare ? 'در حال شروع...' : isScreenSharing ? 'توقف اشتراک صفحه' : 'اشتراک‌گذاری صفحه'}
            </span>
          </button>
        )}

        <button type="button"
          onClick={() => { if (!isScreenSharing) { onSwitchCamera(); onClose(); } }}
          disabled={isSwitchingCamera || isScreenSharing}
          className={row}
        >
          {isSwitchingCamera
            ? <Loader        aria-hidden="true" className={`${ic} text-gray-400 animate-spin`} />
            : <FlipHorizontal aria-hidden="true" className={`${ic} text-gray-300`} />
          }
          <span className="text-sm text-gray-200 flex-1">
            {isSwitchingCamera ? 'در حال تغییر...' : 'تغییر دوربین'}
          </span>
          {isScreenSharing && <span className="text-xs text-gray-500">در حین اشتراک غیرفعال</span>}
        </button>

        <button type="button" onClick={() => { onToggleRemoteMute(); onClose(); }} className={row}>
          {isRemoteMuted
            ? <VolumeX aria-hidden="true" className={`${ic} text-amber-400`} />
            : <Volume2 aria-hidden="true" className={`${ic} text-gray-300`} />
          }
          <span className="text-sm text-gray-200">
            {isRemoteMuted ? 'فعال کردن صدای طرف مقابل' : 'بی‌صدا کردن طرف مقابل'}
          </span>
        </button>

        <button type="button" onClick={() => { onSwap(); onClose(); }} className={row}>
          <ArrowLeftRight aria-hidden="true" className={`${ic} ${isSwapped ? 'text-blue-400' : 'text-gray-300'}`} />
          <span className="text-sm text-gray-200">تعویض موقعیت ویدیوها</span>
        </button>

        <button type="button" onClick={() => { onToggleStats(); onClose(); }} className={row}>
          <Info aria-hidden="true" className={`${ic} ${showStats ? 'text-blue-400' : 'text-gray-300'}`} />
          <span className="text-sm text-gray-200">آمار تماس</span>
        </button>

        {supportsPiP && (
          <button type="button" onClick={() => { onNativePip(); onClose(); }} className={row}>
            <PictureInPicture2 aria-hidden="true" className={`${ic} ${isNativePip ? 'text-blue-400' : 'text-gray-300'}`} />
            <span className="text-sm text-gray-200">
              {isNativePip ? 'خروج از تصویر در تصویر' : 'تصویر در تصویر'}
            </span>
          </button>
        )}
      </div>
    </>
  );
}

// ── VideoPlaceholder ──────────────────────────────────────────────────────

function VideoPlaceholder({ initials, name, label }: { initials: string; name?: string; label?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900 pointer-events-none">
      <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center text-white text-2xl font-bold shadow-lg">
        {initials}
      </div>
      {name  && <p className="text-white text-sm font-medium">{name}</p>}
      {label && <p className="text-gray-400 text-xs">{label}</p>}
    </div>
  );
}

// ── E2EEBadge ─────────────────────────────────────────────────────────────

function E2EEBadge({ status, onClick }: { status: E2EEStatus; onClick: () => void }) {
  let icon: React.ReactNode, label: string, cls: string;
  if (status === 'active_verified')   { icon = <ShieldCheck aria-hidden="true" className="w-3 h-3" />; label = 'E2EE تأییدشده';      cls = 'bg-emerald-900/80 text-emerald-300 border-emerald-700/50'; }
  else if (status === 'active_unverified') { icon = <ShieldAlert aria-hidden="true" className="w-3 h-3" />; label = 'E2EE';           cls = 'bg-amber-900/80 text-amber-300 border-amber-700/50'; }
  else if (status === 'error')        { icon = <ShieldAlert aria-hidden="true" className="w-3 h-3" />; label = 'خطای رمزنگاری';      cls = 'bg-red-900/80 text-red-300 border-red-700/50'; }
  else                                { icon = <Loader aria-hidden="true" className="w-3 h-3 animate-spin" />; label = 'رمزنگاری...'; cls = 'bg-gray-800/80 text-gray-300 border-gray-600/50'; }
  return (
    <button type="button" onClick={onClick} aria-label={`وضعیت رمزنگاری: ${label}`}
      className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border backdrop-blur-sm hover:opacity-80 transition-opacity ${cls}`}>
      {icon} {label}
    </button>
  );
}

// ── NetworkBadge ──────────────────────────────────────────────────────────

function NetworkBadge({ quality, connDiag }: { quality: NetQuality; connDiag: PeerDiagnostics | null }) {
  if (quality === 'offline') {
    return (
      <span className="flex items-center gap-1 text-[11px] text-red-300 bg-red-900/70 border border-red-700/50 px-2 py-0.5 rounded-full backdrop-blur-sm">
        <WifiOff aria-hidden="true" className="w-3 h-3" /> قطع
      </span>
    );
  }
  const poor = quality === 'poor';
  const type = connDiag?.selectedCandidatePair?.localType === 'relay' ? 'TURN' : 'P2P';
  const rtt  = connDiag?.rttMs != null ? ` · ${connDiag.rttMs}ms` : '';
  return (
    <span className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border backdrop-blur-sm ${poor ? 'text-amber-300 bg-amber-900/70 border-amber-700/50' : 'text-emerald-300 bg-emerald-900/70 border-emerald-700/50'}`}>
      <Wifi aria-hidden="true" className="w-3 h-3" />{type}{rtt}
    </span>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────

interface Props {
  phase: CallPhase;
  targetUser: UserProfile | null;
  localVideoRef: RefObject<HTMLVideoElement>;
  remoteVideoRef: RefObject<HTMLVideoElement>;
  isMuted: boolean;
  isVideoOff: boolean;
  isRemoteMuted: boolean;
  isScreenSharing: boolean;
  isSwitchingCamera: boolean;
  isStartingScreenShare: boolean;
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

// ── ActiveCallView ────────────────────────────────────────────────────────
//
// Architecture:
//   The primary video layer always contains both video elements (localVideoRef
//   and remoteVideoRef) with CSS controlling which is visible as the full-bleed
//   background.
//
//   The floating tile uses its OWN two <video> elements (floatLocalRef,
//   floatRemoteRef). Their srcObject is synced from the primary refs via an
//   effect that watches the primary video's srcObject.
//
//   isSwapped determines:
//     !isSwapped → primary shows remote, floating shows local
//      isSwapped → primary shows local,  floating shows remote
//
//   The floating tile's wrapper (floatingRef) is STABLE — it never unmounts
//   on swap. Only the inner video visibility changes.
//   This means drag state, pointer capture, and position all survive swap.

export function ActiveCallView({
  phase, targetUser, localVideoRef, remoteVideoRef,
  isMuted, isVideoOff, isRemoteMuted, isScreenSharing,
  isSwitchingCamera, isStartingScreenShare,
  connDiag, isOffline, e2eeStatus, safetyNums, showSafety,
  onToggleMute, onToggleVideo, onToggleScreenShare, onSwitchCamera, onHangup,
  onToggleRemoteMute, onShowSafety, onCloseSafety, onVerifySafety,
}: Props) {
  const [needsAudioTap,  setNeedsAudioTap]  = useState(false);
  const [isDragging,     setIsDragging]     = useState(false);
  const [pipCorner,      setPipCorner]      = useState<PipCorner>('bottom-right');
  const [isSwapped,      setIsSwapped]      = useState(false);
  const [showStats,      setShowStats]      = useState(false);
  const [isNativePip,    setIsNativePip]    = useState(false);
  const [supportsPiP,    setSupportsPiP]    = useState(false);
  const [showMore,       setShowMore]       = useState(false);
  const [remoteHasFrame, setRemoteHasFrame] = useState(false);

  // Floating tile video elements — their own refs, srcObject synced from primary refs
  const floatLocalRef  = useRef<HTMLVideoElement>(null);
  const floatRemoteRef = useRef<HTMLVideoElement>(null);

  // Draggable container for the floating tile — STABLE, never unmounted
  const floatingRef    = useRef<HTMLDivElement>(null);
  const dragOffsetRef  = useRef({ x: 0, y: 0 });
  const activePointerRef = useRef<number | null>(null);

  // ── Sync floating tile srcObjects from primary video elements ────────
  // This runs whenever phase changes (media streams attach during phase change)
  // and on an interval to pick up srcObject changes (e.g. screen share, camera switch)
  useEffect(() => {
    if (phase !== 'connecting' && phase !== 'connected') return;

    const sync = () => {
      const localSrc  = localVideoRef.current?.srcObject  ?? null;
      const remoteSrc = remoteVideoRef.current?.srcObject ?? null;

      if (floatLocalRef.current && floatLocalRef.current.srcObject !== localSrc) {
        floatLocalRef.current.srcObject = localSrc;
        floatLocalRef.current.play().catch(() => {});
      }
      if (floatRemoteRef.current && floatRemoteRef.current.srcObject !== remoteSrc) {
        floatRemoteRef.current.srcObject = remoteSrc;
        floatRemoteRef.current.play().catch(() => {});
      }
    };

    sync();
    // Poll for srcObject changes (screen share, camera switch update srcObject)
    const id = setInterval(sync, 1000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── Remote playback ──────────────────────────────────────────────────
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || (phase !== 'connecting' && phase !== 'connected')) return;
    video.muted = isRemoteMuted;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
      setNeedsAudioTap(true);
    });
    // Also sync muted state on floating remote
    if (floatRemoteRef.current) {
      floatRemoteRef.current.muted = isRemoteMuted;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRemoteMuted, phase]);

  useEffect(() => {
    if (phase !== 'connecting' && phase !== 'connected') setNeedsAudioTap(false);
  }, [phase]);

  // ── Remote frame detection ───────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'connected') { setRemoteHasFrame(false); return; }
    const check = () => {
      const v = remoteVideoRef.current;
      if (v && v.videoWidth > 0) { setRemoteHasFrame(true); return true; }
      return false;
    };
    if (check()) return;
    const id = setInterval(() => { if (check()) clearInterval(id); }, 500);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── PiP support detection (after video element mounts) ───────────────
  useEffect(() => {
    // Re-check now that the video element is live in DOM
    const primaryVideo = isSwapped ? localVideoRef.current : remoteVideoRef.current;
    setSupportsPiP(supportsVideoPiP(primaryVideo));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, isSwapped]);

  // ── PiP leave event ──────────────────────────────────────────────────
  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video) return;
    const h = () => setIsNativePip(false);
    video.addEventListener('leavepictureinpicture', h);
    return () => video.removeEventListener('leavepictureinpicture', h);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── On swap: release pointer capture, reset inline position ──────────
  // Note: we do NOT unmount/remount the floating wrapper.
  // We only release capture and reset inline styles so corner classes take over.
  useEffect(() => {
    setIsDragging(false);
    const el = floatingRef.current;
    if (!el) return;
    try {
      if (activePointerRef.current != null) el.releasePointerCapture(activePointerRef.current);
    } catch { /* already released */ }
    activePointerRef.current = null;
    // Clear inline position so CSS corner classes apply
    el.style.left = el.style.top = el.style.right = el.style.bottom = '';
  }, [isSwapped]);

  // ── Drag handlers ────────────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    activePointerRef.current = e.pointerId;
    setIsDragging(true);
    const rect = e.currentTarget.getBoundingClientRect();
    dragOffsetRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !floatingRef.current) return;
    const container = floatingRef.current.parentElement;
    if (!container) return;
    const cR = container.getBoundingClientRect();
    const pR = floatingRef.current.getBoundingClientRect();
    const TOOLBAR = 88;
    let x = e.clientX - cR.left - dragOffsetRef.current.x;
    let y = e.clientY - cR.top  - dragOffsetRef.current.y;
    x = Math.max(8, Math.min(x, cR.width  - pR.width  - 8));
    y = Math.max(8, Math.min(y, cR.height - pR.height - TOOLBAR));
    floatingRef.current.style.left   = `${x}px`;
    floatingRef.current.style.top    = `${y}px`;
    floatingRef.current.style.right  = 'auto';
    floatingRef.current.style.bottom = 'auto';
  }, [isDragging]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    activePointerRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!floatingRef.current) return;
    const container = floatingRef.current.parentElement;
    if (!container) return;
    const cR = container.getBoundingClientRect();
    const pR = floatingRef.current.getBoundingClientRect();
    const cx = pR.left + pR.width  / 2 - cR.left;
    const cy = pR.top  + pR.height / 2 - cR.top;
    const corner: PipCorner =
      cy < cR.height / 2
        ? cx < cR.width / 2 ? 'top-left'    : 'top-right'
        : cx < cR.width / 2 ? 'bottom-left' : 'bottom-right';
    setPipCorner(corner);
    floatingRef.current.style.left = floatingRef.current.style.top =
      floatingRef.current.style.right = floatingRef.current.style.bottom = '';
  }, []);

  // ── Native PiP ───────────────────────────────────────────────────────
  // Always targets the PRIMARY (full-bleed) video element
  const handleNativePip = async () => {
    const primaryVideo = isSwapped ? localVideoRef.current : remoteVideoRef.current;
    if (!primaryVideo || !supportsVideoPiP(primaryVideo)) {
      toast.error('حالت تصویر در تصویر در این مرورگر در دسترس نیست');
      return;
    }
    try {
      if (supportsStandardVideoPiP(primaryVideo)) {
        if (document.pictureInPictureElement) {
          await document.exitPictureInPicture();
          setIsNativePip(false);
        } else {
          await primaryVideo.requestPictureInPicture();
          setIsNativePip(true);
          primaryVideo.addEventListener('leavepictureinpicture', () => setIsNativePip(false), { once: true });
        }
        return;
      }
      // WebKit
      const v = primaryVideo as HTMLVideoElement & {
        webkitSupportsPresentationMode?: (m: string) => boolean;
        webkitPresentationMode?: string;
        webkitSetPresentationMode?: (m: string) => void;
      };
      if (v.webkitSupportsPresentationMode?.('picture-in-picture') && v.webkitSetPresentationMode) {
        const inPip = v.webkitPresentationMode === 'picture-in-picture';
        v.webkitSetPresentationMode(inPip ? 'inline' : 'picture-in-picture');
        setIsNativePip(!inPip);
      }
    } catch (err) {
      console.error('[pip] failed', err);
      toast.error('حالت تصویر در تصویر فعال نشد');
    }
  };

  const peerName   = targetUser?.full_name || targetUser?.email || 'مخاطب';
  const peerInit   = getUserInitials(peerName);
  const netQuality = getNetworkQuality(connDiag, isOffline);

  const floatingStyle: React.CSSProperties = isDragging
    ? { touchAction: 'none', transition: 'none' }
    : { ...CORNER_STYLE[pipCorner], touchAction: 'none', transition: 'all 0.2s ease' };

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {e2eeStatus === 'active_verified'   && 'رمزنگاری تأییدشده'}
        {e2eeStatus === 'active_unverified' && 'رمزنگاری فعال، هویت تأییدنشده'}
        {e2eeStatus === 'error'             && 'خطای رمزنگاری'}
        {isOffline                          && 'اتصال قطع شد'}
      </div>

      {/* ── Call stage ────────────────────────────────────────────────── */}
      <div className="relative w-full h-full min-h-0 bg-gray-950 overflow-hidden select-none">

        {/* Primary video layer — full bleed */}
        <div className="absolute inset-0 z-0">
          {/* Remote primary — visible when !isSwapped */}
          <video
            ref={remoteVideoRef}
            autoPlay playsInline
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${isSwapped ? 'opacity-0' : 'opacity-100'}`}
          />
          {/* Local primary — visible when isSwapped */}
          <video
            ref={localVideoRef}
            autoPlay playsInline muted
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${!isSwapped ? 'opacity-0' : 'opacity-100'}`}
          />

          {/* Remote placeholder in primary slot */}
          {!isSwapped && !remoteHasFrame && (
            <VideoPlaceholder
              initials={peerInit}
              name={peerName}
              label={phase === 'connecting' ? 'در حال اتصال...' : 'در انتظار تصویر...'}
            />
          )}
          {/* Local camera-off placeholder in primary slot */}
          {isSwapped && isVideoOff && (
            <VideoPlaceholder initials="شما" label="دوربین خاموش است" />
          )}
        </div>

        {/* ── Floating tile — ALWAYS this wrapper ──────────────────────── */}
        {/* isSwapped only swaps which video is VISIBLE inside the tile    */}
        <div
          ref={floatingRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="absolute z-10 w-24 h-32 sm:w-32 sm:h-44 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl cursor-move"
          style={floatingStyle}
        >
          {/* Floating local video — visible when !isSwapped */}
          <video
            ref={floatLocalRef}
            autoPlay playsInline muted
            className={`absolute inset-0 w-full h-full object-cover ${isSwapped ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          />
          {/* Camera-off overlay for floating local */}
          {!isSwapped && isVideoOff && (
            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center z-10">
              <VideoOff aria-hidden="true" className="w-5 h-5 text-gray-500" />
            </div>
          )}

          {/* Floating remote video — visible when isSwapped */}
          <video
            ref={floatRemoteRef}
            autoPlay playsInline
            className={`absolute inset-0 w-full h-full object-cover ${!isSwapped ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
          />
          {/* No-frame overlay for floating remote */}
          {isSwapped && !remoteHasFrame && (
            <div className="absolute inset-0 bg-gray-800 flex items-center justify-center z-10">
              <span className="text-gray-400 text-sm font-bold">{peerInit}</span>
            </div>
          )}
        </div>

        {/* Connecting overlay */}
        {phase === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/80 z-30">
            <Loader aria-hidden="true" className="w-8 h-8 text-emerald-400 animate-spin" />
            <span className="text-white text-sm">در حال اتصال...</span>
          </div>
        )}

        {/* Tap-to-unmute */}
        {needsAudioTap && (
          <button type="button"
            onClick={() => { const v = remoteVideoRef.current; if (v) { v.muted = false; v.play().catch(() => {}); } setNeedsAudioTap(false); }}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-blue-600/90 hover:bg-blue-600 text-white text-sm px-4 py-2.5 rounded-full shadow-lg z-30 whitespace-nowrap">
            <Volume2 aria-hidden="true" className="w-4 h-4" />
            ضربه بزنید برای فعال‌سازی صدا
          </button>
        )}

        {/* Stats overlay */}
        {showStats && connDiag && (
          <div className="absolute top-14 left-3 bg-black/75 text-white p-3 rounded-lg text-xs z-30 font-mono space-y-0.5 min-w-[140px]" dir="ltr">
            <div>Type: {connDiag.selectedCandidatePair?.localType === 'relay' ? 'TURN' : 'P2P'}</div>
            {connDiag.rttMs               !== null && <div>RTT: {connDiag.rttMs}ms</div>}
            {connDiag.inboundBitrateKbps  !== null && <div>↓ {connDiag.inboundBitrateKbps} kbps</div>}
            {connDiag.outboundBitrateKbps !== null && <div>↑ {connDiag.outboundBitrateKbps} kbps</div>}
            {connDiag.packetLossPct       !== null && <div>Loss: {connDiag.packetLossPct}%</div>}
          </div>
        )}

        {/* Top-left: E2EE badge */}
        {(phase === 'connecting' || phase === 'connected') && (
          <div className="absolute top-3 left-3 z-20">
            <E2EEBadge status={e2eeStatus} onClick={onShowSafety} />
          </div>
        )}

        {/* Top-right: peer name + network quality */}
        <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5">
          {targetUser && <span className="text-white/90 text-sm font-semibold drop-shadow-md">{peerName}</span>}
          {phase === 'connected' && <NetworkBadge quality={netQuality} connDiag={connDiag} />}
        </div>

        {/* Bottom controls */}
        <div
          className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-3 px-4 pt-3"
          style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pointer-events-none" />
          <div className="relative flex items-center gap-3">
            <CallControlButton
              icon={isMuted ? <MicOff aria-hidden="true" className="w-5 h-5 text-white" /> : <Mic aria-hidden="true" className="w-5 h-5 text-white" />}
              label={isMuted ? 'فعال‌سازی صدا' : 'خاموش کردن صدا'}
              active={isMuted}
              onClick={onToggleMute}
            />
            <CallControlButton
              icon={isVideoOff ? <VideoOff aria-hidden="true" className="w-5 h-5 text-white" /> : <Video aria-hidden="true" className="w-5 h-5 text-white" />}
              label={isVideoOff ? 'روشن کردن دوربین' : 'خاموش کردن دوربین'}
              active={isVideoOff}
              onClick={onToggleVideo}
            />
            <CallControlButton
              icon={<PhoneOff aria-hidden="true" className="w-6 h-6 text-white" />}
              label="پایان تماس"
              danger large
              onClick={onHangup}
            />
            <CallControlButton
              icon={<MoreHorizontal aria-hidden="true" className="w-5 h-5 text-white" />}
              label="گزینه‌های بیشتر"
              active={showMore}
              onClick={() => setShowMore(true)}
            />
          </div>
        </div>
      </div>

      {/* More panel */}
      {showMore && (
        <MorePanel
          isScreenSharing={isScreenSharing}
          isStartingScreenShare={isStartingScreenShare}
          isSwitchingCamera={isSwitchingCamera}
          isRemoteMuted={isRemoteMuted}
          isSwapped={isSwapped}
          showStats={showStats}
          isNativePip={isNativePip}
          supportsPiP={supportsPiP}
          onToggleScreenShare={onToggleScreenShare}
          onSwitchCamera={onSwitchCamera}
          onToggleRemoteMute={onToggleRemoteMute}
          onSwap={() => setIsSwapped(v => !v)}
          onToggleStats={() => setShowStats(v => !v)}
          onNativePip={handleNativePip}
          onClose={() => setShowMore(false)}
        />
      )}

      {/* Safety modal */}
      {showSafety && safetyNums && (
        <SafetyModal safetyNums={safetyNums} onVerify={onVerifySafety} onClose={onCloseSafety} />
      )}
    </>
  );
}
