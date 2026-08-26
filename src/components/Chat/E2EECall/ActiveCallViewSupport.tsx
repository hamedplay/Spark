import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import {
  ArrowLeftRight, Check, FlipHorizontal2 as FlipHorizontal, Info, Loader, Monitor,
  MonitorOff, PictureInPicture2, ShieldAlert, ShieldCheck, Volume2, VolumeX, Wifi,
  WifiOff, X,
} from 'lucide-react';
import type { PeerDiagnostics } from '../../../lib/webrtcDiagnostics';
import type { E2EEStatus } from './types';

export function getUserInitials(nameOrEmail: string | null | undefined): string {
  if (!nameOrEmail) return '?';
  const name = nameOrEmail.trim();
  if (!name) return '?';
  const parts = name.split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function useMediaStream(
  videoRef: RefObject<HTMLVideoElement | null>,
  streamRef: RefObject<MediaStream | null>,
  muted = false,
) {
  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video) return;
    if (video.srcObject !== stream) {
      video.srcObject = stream;
      if (stream) {
        video.muted = muted;
        video.play().catch(() => {});
      }
    }
  });
}

export function supportsStandardVideoPiP(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  if (typeof video.requestPictureInPicture !== 'function') return false;
  if (video.disablePictureInPicture) return false;
  return typeof document.pictureInPictureEnabled !== 'undefined' && !!document.pictureInPictureEnabled;
}

function supportsWebKitVideoPiP(video: HTMLVideoElement | null): boolean {
  if (!video) return false;
  const target = video as HTMLVideoElement & { webkitSupportsPresentationMode?: (mode: string) => boolean };
  return typeof target.webkitSupportsPresentationMode === 'function' && target.webkitSupportsPresentationMode('picture-in-picture');
}

export function supportsVideoPiP(video: HTMLVideoElement | null): boolean {
  return supportsStandardVideoPiP(video) || supportsWebKitVideoPiP(video);
}

const SUPPORTS_SCREEN_SHARE =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof navigator.mediaDevices.getDisplayMedia === 'function';

export type NetQuality = 'good' | 'poor' | 'offline';

export function getNetworkQuality(connDiag: PeerDiagnostics | null, isOffline: boolean): NetQuality {
  if (isOffline) return 'offline';
  if (!connDiag) return 'good';
  if ((connDiag.rttMs !== null && connDiag.rttMs > 400) ||
      (connDiag.packetLossPct !== null && connDiag.packetLossPct > 5)) return 'poor';
  return 'good';
}

export type PipCorner = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';

export const CORNER_STYLE: Record<PipCorner, CSSProperties> = {
  'top-right': { top: 12, right: 12, left: 'auto', bottom: 'auto' },
  'top-left': { top: 12, left: 12, right: 'auto', bottom: 'auto' },
  'bottom-right': { bottom: 88, right: 12, left: 'auto', top: 'auto' },
  'bottom-left': { bottom: 88, left: 12, right: 'auto', top: 'auto' },
};

interface CtrlBtnProps {
  icon: ReactNode;
  label: string;
  active?: boolean;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  large?: boolean;
  onClick: () => void;
}

export function CallControlButton({ icon, label, active, danger, loading, disabled, large, onClick }: CtrlBtnProps) {
  const size = large ? 'w-14 h-14 min-w-[52px] min-h-[52px]' : 'w-12 h-12 min-w-[44px] min-h-[44px]';
  let bg: string;
  if (danger) bg = 'bg-red-600 hover:bg-red-700 active:bg-red-800';
  else if (active) bg = 'bg-white/30 hover:bg-white/40';
  else bg = 'bg-black/40 hover:bg-black/60 active:bg-black/70';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      disabled={disabled || loading}
      className={[
        size,
        'rounded-full flex items-center justify-center transition-all backdrop-blur-sm',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
        bg,
        (disabled || loading) ? 'opacity-50 pointer-events-none' : '',
      ].join(' ')}
    >
      {loading ? <Loader aria-hidden="true" className="w-4 h-4 text-white animate-spin" /> : icon}
    </button>
  );
}

export function SafetyModal({ safetyNums, onVerify, onClose }: {
  safetyNums: string[];
  onVerify: () => void;
  onClose: () => void;
}) {
  const firstBtnRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    firstBtnRef.current?.focus();
    return () => { previous?.focus(); };
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    const elements = modal.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])');
    const first = elements[0];
    const last = elements[elements.length - 1];
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      if (event.shiftKey) {
        if (document.activeElement === first) { event.preventDefault(); last.focus(); }
      } else if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => document.removeEventListener('keydown', trap);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="safety-title" className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm space-y-4 max-h-[90vh] overflow-y-auto" dir="rtl">
        <div className="flex items-center gap-2">
          <ShieldCheck aria-hidden="true" className="w-5 h-5 text-emerald-400" />
          <h3 id="safety-title" className="font-bold text-white">شماره اطمینان</h3>
        </div>
        <p className="text-sm text-gray-400 leading-relaxed">این کد را از طریق کانالی مستقل با مخاطب مقایسه کنید. اگر یکسان بود، تبادل کلید بدون واسطه انجام شده است.</p>
        <div className="grid grid-cols-2 gap-2">
          {safetyNums.map((group, index) => <div key={index} className="bg-gray-800 rounded-lg px-3 py-2 text-center font-mono text-sm tracking-widest text-gray-200">{group}</div>)}
        </div>
        <p className="text-xs text-amber-400 flex items-center gap-1"><ShieldAlert aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />این کد فقط برای این جلسه معتبر است.</p>
        <div className="flex gap-2">
          <button ref={firstBtnRef} type="button" onClick={onVerify} className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1"><Check aria-hidden="true" className="w-4 h-4" /> مطابقت دارد</button>
          <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-xl text-sm transition-colors">بستن</button>
        </div>
      </div>
    </div>
  );
}

interface MorePanelProps {
  isScreenSharing: boolean;
  isStartingScreenShare: boolean;
  isSwitchingCamera: boolean;
  isRemoteMuted: boolean;
  isSwapped: boolean;
  showStats: boolean;
  isNativePip: boolean;
  supportsPiP: boolean;
  moreBtnRef: RefObject<HTMLButtonElement | null>;
  onToggleScreenShare: () => void;
  onSwitchCamera: () => void;
  onToggleRemoteMute: () => void;
  onSwap: () => void;
  onToggleStats: () => void;
  onNativePip: () => void;
  onClose: () => void;
}

export function MorePanel({
  isScreenSharing, isStartingScreenShare, isSwitchingCamera,
  isRemoteMuted, isSwapped, showStats, isNativePip, supportsPiP, moreBtnRef,
  onToggleScreenShare, onSwitchCamera, onToggleRemoteMute, onSwap, onToggleStats,
  onNativePip, onClose,
}: MorePanelProps) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); moreBtnRef.current?.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose, moreBtnRef]);

  const row = 'flex w-full items-center gap-3 px-4 py-3.5 text-right rounded-xl transition-colors hover:bg-white/10 active:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:opacity-40 disabled:pointer-events-none';
  const iconClass = 'w-5 h-5 shrink-0';

  return (
    <>
      <div className="absolute inset-0 z-40 bg-black/50 backdrop-blur-sm sm:bg-transparent sm:backdrop-blur-none" onClick={() => { onClose(); moreBtnRef.current?.focus(); }} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="کنترل‌های بیشتر"
        id="more-controls-panel"
        className="absolute z-50 bg-gray-900/95 border border-white/10 overflow-y-auto left-0 right-0 bottom-0 rounded-t-2xl pt-4 px-3 max-h-[70vh] sm:left-auto sm:right-3 sm:bottom-[76px] sm:rounded-2xl sm:w-[min(20rem,calc(100vw-1.5rem))] sm:max-h-[calc(100%-96px)] sm:shadow-2xl sm:shadow-black/60"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)' }}
      >
        <div className="flex items-center justify-between px-2 pb-3 border-b border-white/10" dir="rtl">
          <span className="text-white font-semibold text-sm">کنترل‌های بیشتر</span>
          <button type="button" onClick={() => { onClose(); moreBtnRef.current?.focus(); }} aria-label="بستن" className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-white hover:bg-white/10 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"><X aria-hidden="true" className="w-4 h-4" /></button>
        </div>
        <div className="space-y-0.5" dir="rtl">
          {SUPPORTS_SCREEN_SHARE && (
            <button type="button" onClick={() => { onToggleScreenShare(); onClose(); }} disabled={isStartingScreenShare} className={row}>
              {isStartingScreenShare ? <Loader aria-hidden="true" className={`${iconClass} text-blue-400 animate-spin`} /> : isScreenSharing ? <MonitorOff aria-hidden="true" className={`${iconClass} text-blue-400`} /> : <Monitor aria-hidden="true" className={`${iconClass} text-gray-300`} />}
              <span className="flex-1 min-w-0 text-sm text-gray-200">{isStartingScreenShare ? 'در حال شروع...' : isScreenSharing ? 'توقف اشتراک صفحه' : 'اشتراک‌گذاری صفحه'}</span>
            </button>
          )}
          <button type="button" onClick={() => { if (!isScreenSharing) { onSwitchCamera(); onClose(); } }} disabled={isSwitchingCamera || isScreenSharing} className={row}>
            {isSwitchingCamera ? <Loader aria-hidden="true" className={`${iconClass} text-gray-400 animate-spin`} /> : <FlipHorizontal aria-hidden="true" className={`${iconClass} text-gray-300`} />}
            <span className="flex-1 min-w-0 text-sm text-gray-200">{isSwitchingCamera ? 'در حال تغییر...' : 'تغییر دوربین'}</span>
            {isScreenSharing && <span className="text-xs text-gray-500 shrink-0">در حین اشتراک غیرفعال</span>}
          </button>
          <button type="button" onClick={() => { onToggleRemoteMute(); onClose(); }} className={row}>
            {isRemoteMuted ? <VolumeX aria-hidden="true" className={`${iconClass} text-amber-400`} /> : <Volume2 aria-hidden="true" className={`${iconClass} text-gray-300`} />}
            <span className="flex-1 min-w-0 text-sm text-gray-200">{isRemoteMuted ? 'فعال کردن صدای طرف مقابل' : 'بی‌صدا کردن طرف مقابل'}</span>
          </button>
          <button type="button" onClick={() => { onSwap(); onClose(); }} className={row}>
            <ArrowLeftRight aria-hidden="true" className={`${iconClass} ${isSwapped ? 'text-blue-400' : 'text-gray-300'}`} />
            <span className="flex-1 min-w-0 text-sm text-gray-200">تعویض موقعیت ویدیوها</span>
          </button>
          <button type="button" onClick={() => { onToggleStats(); onClose(); }} className={row}>
            <Info aria-hidden="true" className={`${iconClass} ${showStats ? 'text-blue-400' : 'text-gray-300'}`} />
            <span className="flex-1 min-w-0 text-sm text-gray-200">آمار تماس</span>
          </button>
          {supportsPiP && (
            <button type="button" onClick={() => { onNativePip(); onClose(); }} className={row}>
              <PictureInPicture2 aria-hidden="true" className={`${iconClass} ${isNativePip ? 'text-blue-400' : 'text-gray-300'}`} />
              <span className="flex-1 min-w-0 text-sm text-gray-200">{isNativePip ? 'خروج از تصویر در تصویر' : 'تصویر در تصویر'}</span>
            </button>
          )}
        </div>
      </div>
    </>
  );
}

export function VideoPlaceholder({ initials, name, label }: { initials: string; name?: string; label?: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-900 pointer-events-none">
      <div className="w-20 h-20 rounded-full bg-gray-700 flex items-center justify-center text-white text-2xl font-bold shadow-lg">{initials}</div>
      {name && <p className="text-white text-sm font-medium">{name}</p>}
      {label && <p className="text-gray-400 text-xs">{label}</p>}
    </div>
  );
}

export function E2EEBadge({ status, onClick }: { status: E2EEStatus; onClick: () => void }) {
  let icon: ReactNode;
  let label: string;
  let className: string;
  if (status === 'active_verified') { icon = <ShieldCheck aria-hidden="true" className="w-3 h-3" />; label = 'E2EE تأییدشده'; className = 'bg-emerald-900/80 text-emerald-300 border-emerald-700/50'; }
  else if (status === 'active_unverified') { icon = <ShieldAlert aria-hidden="true" className="w-3 h-3" />; label = 'E2EE'; className = 'bg-amber-900/80 text-amber-300 border-amber-700/50'; }
  else if (status === 'error') { icon = <ShieldAlert aria-hidden="true" className="w-3 h-3" />; label = 'خطای رمزنگاری'; className = 'bg-red-900/80 text-red-300 border-red-700/50'; }
  else { icon = <Loader aria-hidden="true" className="w-3 h-3 animate-spin" />; label = 'رمزنگاری...'; className = 'bg-gray-800/80 text-gray-300 border-gray-600/50'; }
  return <button type="button" onClick={onClick} aria-label={`وضعیت رمزنگاری: ${label}`} className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border backdrop-blur-sm hover:opacity-80 transition-opacity ${className}`}>{icon} {label}</button>;
}

export function NetworkBadge({ quality, connDiag }: { quality: NetQuality; connDiag: PeerDiagnostics | null }) {
  if (quality === 'offline') {
    return <span className="flex items-center gap-1 text-[11px] text-red-300 bg-red-900/70 border border-red-700/50 px-2 py-0.5 rounded-full backdrop-blur-sm"><WifiOff aria-hidden="true" className="w-3 h-3" /> قطع</span>;
  }
  const poor = quality === 'poor';
  const type = connDiag?.selectedCandidatePair?.localType === 'relay' ? 'TURN' : 'P2P';
  const rtt = connDiag?.rttMs != null ? ` · ${connDiag.rttMs}ms` : '';
  return <span className={`flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border backdrop-blur-sm ${poor ? 'text-amber-300 bg-amber-900/70 border-amber-700/50' : 'text-emerald-300 bg-emerald-900/70 border-emerald-700/50'}`}><Wifi aria-hidden="true" className="w-3 h-3" />{type}{rtt}</span>;
}
