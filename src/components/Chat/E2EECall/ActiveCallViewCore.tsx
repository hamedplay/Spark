import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties, type MutableRefObject, type PointerEvent, type RefObject,
} from 'react';
import {
  Bug, Loader, Mic, MicOff, MoveHorizontal as MoreHorizontal, PhoneOff,
  Video, VideoOff, Volume2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type { PeerDiagnostics } from '../../../lib/webrtcDiagnostics';
import type { CallPhase, E2EEStatus, UserProfile } from './types';
import type { PortRecord } from './transforms';
import type { MediaHealthClassification } from './callDebugStore';
import { isCallDebugEnabled } from './callDebugStore';
import { CallDebugCenter } from './CallDebugCenter';
import {
  CallControlButton, CORNER_STYLE, E2EEBadge, MorePanel, NetworkBadge, SafetyModal,
  VideoPlaceholder, getNetworkQuality, getUserInitials, supportsStandardVideoPiP,
  supportsVideoPiP, useMediaStream, type PipCorner,
} from './ActiveCallViewSupport';

interface Props {
  phase: CallPhase;
  targetUser: UserProfile | null;
  localVideoRef: RefObject<HTMLVideoElement>;
  remoteVideoRef: RefObject<HTMLVideoElement>;
  localStreamRef: RefObject<MediaStream | null>;
  remoteStreamRef: RefObject<MediaStream | null>;
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
  onRemoteElementMount?: (element: HTMLVideoElement | null) => void;
  portRecordsRef?: RefObject<PortRecord[]>;
  myRole?: 'caller' | 'callee' | null;
  sessionId?: string;
  peerConnectionId?: string;
  mediaHealth?: MediaHealthClassification[];
  onRunSelfTest?: () => Promise<MediaHealthClassification[]>;
}

export function ActiveCallView({
  phase, targetUser, localVideoRef, remoteVideoRef,
  localStreamRef, remoteStreamRef,
  isMuted, isVideoOff, isRemoteMuted, isScreenSharing,
  isSwitchingCamera, isStartingScreenShare,
  connDiag, isOffline, e2eeStatus, safetyNums, showSafety,
  onToggleMute, onToggleVideo, onToggleScreenShare, onSwitchCamera, onHangup,
  onToggleRemoteMute, onShowSafety, onCloseSafety, onVerifySafety,
  onRemoteElementMount,
  portRecordsRef, myRole, sessionId, peerConnectionId, mediaHealth, onRunSelfTest,
}: Props) {
  const [needsAudioTap, setNeedsAudioTap] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [pipCorner, setPipCorner] = useState<PipCorner>('bottom-right');
  const [dragPosition, setDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [isSwapped, setIsSwapped] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [isNativePip, setIsNativePip] = useState(false);
  const [supportsPiP, setSupportsPiP] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [remoteHasFrame, setRemoteHasFrame] = useState(false);
  const [showDebug, setShowDebug] = useState(false);

  const floatLocalRef = useRef<HTMLVideoElement>(null);
  const floatRemoteRef = useRef<HTMLVideoElement>(null);
  const floatingRef = useRef<HTMLDivElement>(null);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const activePointerRef = useRef<number | null>(null);
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const presentedFrameCountRef = useRef<number>(0);

  const remoteRefCallback = useCallback((element: HTMLVideoElement | null) => {
    (remoteVideoRef as MutableRefObject<HTMLVideoElement | null>).current = element;
    onRemoteElementMount?.(element);

    if (isCallDebugEnabled() && element) {
      presentedFrameCountRef.current = 0;
      const tick: VideoFrameRequestCallback = () => {
        presentedFrameCountRef.current += 1;
        const video = element as HTMLVideoElement & { requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number };
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(tick);
      };
      const video = element as HTMLVideoElement & { requestVideoFrameCallback?: (callback: VideoFrameRequestCallback) => number };
      if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(tick);
    }
  }, [onRemoteElementMount, remoteVideoRef]);

  useMediaStream(floatLocalRef, localStreamRef, true);
  useMediaStream(floatRemoteRef, remoteStreamRef, false);

  useEffect(() => {
    const video = remoteVideoRef.current;
    if (!video || (phase !== 'connecting' && phase !== 'connected')) return;
    video.muted = isRemoteMuted;
    video.play().catch(() => {
      video.muted = true;
      video.play().catch(() => {});
      setNeedsAudioTap(true);
    });
    if (floatRemoteRef.current) floatRemoteRef.current.muted = isRemoteMuted;
  }, [isRemoteMuted, phase, remoteVideoRef]);

  useEffect(() => {
    if (phase !== 'connecting' && phase !== 'connected') setNeedsAudioTap(false);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'connected') {
      setRemoteHasFrame(false);
      return;
    }
    const check = () => !!remoteVideoRef.current && remoteVideoRef.current.videoWidth > 0;
    if (check()) {
      setRemoteHasFrame(true);
      return;
    }
    const id = setInterval(() => {
      if (check()) {
        setRemoteHasFrame(true);
        clearInterval(id);
      }
    }, 500);
    return () => clearInterval(id);
  }, [phase, remoteVideoRef]);

  const getPrimaryVideoElement = useCallback((): HTMLVideoElement | null => (
    isSwapped ? localVideoRef.current : remoteVideoRef.current
  ), [isSwapped, localVideoRef, remoteVideoRef]);

  useEffect(() => {
    const primaryVideo = getPrimaryVideoElement();
    const recheck = () => setSupportsPiP(supportsVideoPiP(getPrimaryVideoElement()));
    recheck();
    primaryVideo?.addEventListener('loadedmetadata', recheck);
    return () => primaryVideo?.removeEventListener('loadedmetadata', recheck);
  }, [phase, isSwapped, getPrimaryVideoElement]);

  useEffect(() => {
    const primaryVideo = getPrimaryVideoElement();
    if (!primaryVideo) return;

    const onEnter = () => setIsNativePip(true);
    const onLeave = () => setIsNativePip(false);
    primaryVideo.addEventListener('enterpictureinpicture', onEnter);
    primaryVideo.addEventListener('leavepictureinpicture', onLeave);

    const video = primaryVideo as HTMLVideoElement & { webkitPresentationMode?: string };
    const onWebKitChange = () => setIsNativePip(video.webkitPresentationMode === 'picture-in-picture');
    primaryVideo.addEventListener('webkitpresentationmodechanged', onWebKitChange);

    return () => {
      primaryVideo.removeEventListener('enterpictureinpicture', onEnter);
      primaryVideo.removeEventListener('leavepictureinpicture', onLeave);
      primaryVideo.removeEventListener('webkitpresentationmodechanged', onWebKitChange);
    };
  }, [isSwapped, phase, getPrimaryVideoElement]);

  useEffect(() => {
    setIsDragging(false);
    const element = floatingRef.current;
    if (!element) return;
    try {
      if (activePointerRef.current != null) element.releasePointerCapture(activePointerRef.current);
    } catch {
      // Pointer capture was already released.
    }
    activePointerRef.current = null;
  }, [isSwapped]);

  const handlePointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    setIsDragging(true);
    const rect = event.currentTarget.getBoundingClientRect();
    dragOffsetRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !floatingRef.current) return;
    const container = floatingRef.current.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const pipRect = floatingRef.current.getBoundingClientRect();
    const toolbar = 88;
    let x = event.clientX - containerRect.left - dragOffsetRef.current.x;
    let y = event.clientY - containerRect.top - dragOffsetRef.current.y;
    x = Math.max(8, Math.min(x, containerRect.width - pipRect.width - 8));
    y = Math.max(8, Math.min(y, containerRect.height - pipRect.height - toolbar));
    setDragPosition({ x, y });
  }, [isDragging]);

  const handlePointerUp = useCallback((event: PointerEvent<HTMLDivElement>) => {
    setIsDragging(false);
    activePointerRef.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* ignore */ }
    if (!floatingRef.current) return;
    const container = floatingRef.current.parentElement;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const pipRect = floatingRef.current.getBoundingClientRect();
    const centerX = pipRect.left + pipRect.width / 2 - containerRect.left;
    const centerY = pipRect.top + pipRect.height / 2 - containerRect.top;
    const corner: PipCorner = centerY < containerRect.height / 2
      ? centerX < containerRect.width / 2 ? 'top-left' : 'top-right'
      : centerX < containerRect.width / 2 ? 'bottom-left' : 'bottom-right';
    setPipCorner(corner);
    setDragPosition(null);
  }, []);

  const getPiPTarget = useCallback((): HTMLVideoElement | null => {
    const preferred = isSwapped ? localVideoRef.current : remoteVideoRef.current;
    const fallback = isSwapped ? remoteVideoRef.current : localVideoRef.current;

    const isUsable = (video: HTMLVideoElement | null): video is HTMLVideoElement => {
      if (!video || video.readyState < 1 || video.ended) return false;
      const stream = video.srcObject instanceof MediaStream ? video.srcObject : null;
      if (!stream) return false;
      return stream.getVideoTracks().some(track => track.readyState === 'live');
    };

    if (isUsable(preferred)) return preferred;
    if (isUsable(fallback)) return fallback;
    return null;
  }, [isSwapped, localVideoRef, remoteVideoRef]);

  const handleNativePip = useCallback(() => {
    const target = getPiPTarget();

    if (import.meta.env.DEV) {
      const webkitTarget = target as (HTMLVideoElement & {
        webkitSupportsPresentationMode?: (mode: string) => boolean;
        webkitPresentationMode?: string;
      }) | null;
      console.debug('[pip] click', {
        target,
        readyState: target?.readyState,
        paused: target?.paused,
        ended: target?.ended,
        srcObject: target?.srcObject instanceof MediaStream,
        videoTracks: target?.srcObject instanceof MediaStream
          ? target.srcObject.getVideoTracks().map(track => ({ readyState: track.readyState, enabled: track.enabled, muted: track.muted }))
          : [],
        standardAPI: typeof target?.requestPictureInPicture === 'function',
        pictureInPictureEnabled: document.pictureInPictureEnabled,
        webkitSupportsPresentationMode: typeof webkitTarget?.webkitSupportsPresentationMode === 'function',
        webkitPresentationMode: webkitTarget?.webkitPresentationMode,
        displayModeStandalone: window.matchMedia('(display-mode: standalone)').matches,
      });
    }

    if (!target) {
      toast.error('ویدیو هنوز برای تصویر در تصویر آماده نیست.');
      return;
    }

    if (supportsStandardVideoPiP(target)) {
      const run = async () => {
        try {
          const pipElement = document.pictureInPictureElement;
          if (pipElement) {
            if (pipElement === target) {
              await document.exitPictureInPicture();
              return;
            }
            await document.exitPictureInPicture();
          }
          if (target.paused) await target.play();
          await target.requestPictureInPicture();
        } catch (error) {
          const name = error instanceof DOMException ? error.name : undefined;
          const message = error instanceof Error ? error.message : String(error);
          console.error('[pip] standard failed', { name, message, error });
          if (name === 'NotSupportedError') {
            toast.error('حالت تصویر در تصویر در این مرورگر در دسترس نیست.');
          } else if (name === 'NotAllowedError') {
            const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
              (navigator as Navigator & { standalone?: boolean }).standalone === true;
            toast.error(isStandalone
              ? 'تصویر در تصویر در حالت فعلی برنامه فعال نشد. برنامه را در Safari باز کنید و دوباره امتحان کنید.'
              : 'فعال‌سازی تصویر در تصویر انجام نشد.');
          } else {
            toast.error('فعال‌سازی تصویر در تصویر انجام نشد.');
          }
        }
      };
      void run();
      return;
    }

    const webkitVideo = target as HTMLVideoElement & {
      webkitSupportsPresentationMode?: (mode: string) => boolean;
      webkitPresentationMode?: string;
      webkitSetPresentationMode?: (mode: string) => void;
    };
    if (typeof webkitVideo.webkitSetPresentationMode === 'function' && webkitVideo.webkitSupportsPresentationMode?.('picture-in-picture')) {
      try {
        const inPip = webkitVideo.webkitPresentationMode === 'picture-in-picture';
        webkitVideo.webkitSetPresentationMode(inPip ? 'inline' : 'picture-in-picture');
      } catch (error) {
        const name = error instanceof DOMException ? error.name : undefined;
        const message = error instanceof Error ? error.message : String(error);
        console.error('[pip] webkit failed', { name, message, error });
        const isStandalone = window.matchMedia('(display-mode: standalone)').matches ||
          (navigator as Navigator & { standalone?: boolean }).standalone === true;
        toast.error(isStandalone
          ? 'تصویر در تصویر در حالت فعلی برنامه فعال نشد. برنامه را در Safari باز کنید و دوباره امتحان کنید.'
          : 'فعال‌سازی تصویر در تصویر انجام نشد.');
      }
      return;
    }

    toast.error('حالت تصویر در تصویر در این مرورگر در دسترس نیست.');
  }, [getPiPTarget]);

  const peerName = targetUser?.full_name || targetUser?.email || 'مخاطب';
  const peerInit = getUserInitials(peerName);
  const netQuality = getNetworkQuality(connDiag, isOffline);
  const floatingStyle: CSSProperties = dragPosition
    ? { left: dragPosition.x, top: dragPosition.y, right: 'auto', bottom: 'auto', touchAction: 'none', transition: 'none' }
    : { ...CORNER_STYLE[pipCorner], touchAction: 'none', transition: isDragging ? 'none' : 'all 0.2s ease' };

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {e2eeStatus === 'active_verified' && 'رمزنگاری تأییدشده'}
        {e2eeStatus === 'active_unverified' && 'رمزنگاری فعال، هویت تأییدنشده'}
        {e2eeStatus === 'error' && 'خطای رمزنگاری'}
        {isOffline && 'اتصال قطع شد'}
      </div>

      <div className="relative w-full h-full min-h-0 bg-gray-950 overflow-hidden select-none">
        <div className="absolute inset-0 z-0">
          <video ref={remoteRefCallback} autoPlay playsInline data-call-media="remote" className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${isSwapped ? 'opacity-0' : 'opacity-100'}`} />
          <video ref={localVideoRef} autoPlay playsInline muted data-call-media="local" className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-200 ${!isSwapped ? 'opacity-0' : 'opacity-100'}`} />
          {!isSwapped && !remoteHasFrame && <VideoPlaceholder initials={peerInit} name={peerName} label={phase === 'connecting' ? 'در حال اتصال...' : 'در انتظار تصویر...'} />}
          {isSwapped && isVideoOff && <VideoPlaceholder initials="شما" label="دوربین خاموش است" />}
        </div>

        <div
          ref={floatingRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="absolute z-10 w-24 h-32 sm:w-32 sm:h-44 rounded-xl overflow-hidden border-2 border-white/20 shadow-2xl cursor-move"
          style={floatingStyle}
        >
          <video ref={floatLocalRef} autoPlay playsInline muted data-call-media="local-float" className={`absolute inset-0 w-full h-full object-cover ${isSwapped ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} />
          {!isSwapped && isVideoOff && <div className="absolute inset-0 bg-gray-800 flex items-center justify-center z-10"><VideoOff aria-hidden="true" className="w-5 h-5 text-gray-500" /></div>}
          <video ref={floatRemoteRef} autoPlay playsInline data-call-media="remote-float" className={`absolute inset-0 w-full h-full object-cover ${!isSwapped ? 'opacity-0 pointer-events-none' : 'opacity-100'}`} />
          {isSwapped && !remoteHasFrame && <div className="absolute inset-0 bg-gray-800 flex items-center justify-center z-10"><span className="text-gray-400 text-sm font-bold">{peerInit}</span></div>}
        </div>

        {phase === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/80 z-30">
            <Loader aria-hidden="true" className="w-8 h-8 text-emerald-400 animate-spin" />
            <span className="text-white text-sm">در حال اتصال...</span>
          </div>
        )}

        {needsAudioTap && (
          <button
            type="button"
            onClick={() => {
              const video = remoteVideoRef.current;
              if (video) { video.muted = false; video.play().catch(() => {}); }
              setNeedsAudioTap(false);
            }}
            className="absolute bottom-28 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-blue-600/90 hover:bg-blue-600 text-white text-sm px-4 py-2.5 rounded-full shadow-lg z-30 whitespace-nowrap"
          >
            <Volume2 aria-hidden="true" className="w-4 h-4" /> ضربه بزنید برای فعال‌سازی صدا
          </button>
        )}

        {showStats && connDiag && (
          <div className="absolute top-14 left-3 bg-black/75 text-white p-3 rounded-lg text-xs z-30 font-mono space-y-0.5 min-w-[140px]" dir="ltr">
            <div>Type: {connDiag.selectedCandidatePair?.localType === 'relay' ? 'TURN' : 'P2P'}</div>
            {connDiag.rttMs !== null && <div>RTT: {connDiag.rttMs}ms</div>}
            {connDiag.inboundBitrateKbps !== null && <div>↓ {connDiag.inboundBitrateKbps} kbps</div>}
            {connDiag.outboundBitrateKbps !== null && <div>↑ {connDiag.outboundBitrateKbps} kbps</div>}
            {connDiag.packetLossPct !== null && <div>Loss: {connDiag.packetLossPct}%</div>}
          </div>
        )}

        {(phase === 'connecting' || phase === 'connected') && <div className="absolute top-3 left-3 z-20"><E2EEBadge status={e2eeStatus} onClick={onShowSafety} /></div>}
        <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5">
          {targetUser && <span className="text-white/90 text-sm font-semibold drop-shadow-md">{peerName}</span>}
          {phase === 'connected' && <NetworkBadge quality={netQuality} connDiag={connDiag} />}
        </div>

        <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center justify-center gap-3 px-4 pt-3" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)' }}>
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent pointer-events-none" />
          <div className="relative flex items-center gap-3">
            <CallControlButton icon={isMuted ? <MicOff aria-hidden="true" className="w-5 h-5 text-white" /> : <Mic aria-hidden="true" className="w-5 h-5 text-white" />} label={isMuted ? 'فعال‌سازی صدا' : 'خاموش کردن صدا'} active={isMuted} onClick={onToggleMute} />
            <CallControlButton icon={isVideoOff ? <VideoOff aria-hidden="true" className="w-5 h-5 text-white" /> : <Video aria-hidden="true" className="w-5 h-5 text-white" />} label={isVideoOff ? 'روشن کردن دوربین' : 'خاموش کردن دوربین'} active={isVideoOff} onClick={onToggleVideo} />
            <CallControlButton icon={<PhoneOff aria-hidden="true" className="w-6 h-6 text-white" />} label="پایان تماس" danger large onClick={onHangup} />
            <button
              ref={moreBtnRef}
              type="button"
              onClick={() => setShowMore(true)}
              aria-label="گزینه‌های بیشتر"
              aria-expanded={showMore}
              aria-controls="more-controls-panel"
              className={[
                'w-12 h-12 min-w-[44px] min-h-[44px] rounded-full flex items-center justify-center transition-all backdrop-blur-sm',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                showMore ? 'bg-white/30 hover:bg-white/40' : 'bg-black/40 hover:bg-black/60 active:bg-black/70',
              ].join(' ')}
            >
              <MoreHorizontal aria-hidden="true" className="w-5 h-5 text-white" />
            </button>
            {isCallDebugEnabled() && (
              <button
                type="button"
                onClick={() => setShowDebug(value => !value)}
                aria-label="Debug Center"
                className={[
                  'w-10 h-10 min-w-[36px] min-h-[36px] rounded-full flex items-center justify-center transition-all backdrop-blur-sm',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60',
                  showDebug ? 'bg-blue-600/80 hover:bg-blue-600' : 'bg-black/40 hover:bg-black/60 active:bg-black/70',
                ].join(' ')}
              >
                <Bug aria-hidden="true" className="w-4 h-4 text-white" />
              </button>
            )}
          </div>
        </div>

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
            moreBtnRef={moreBtnRef}
            onToggleScreenShare={onToggleScreenShare}
            onSwitchCamera={onSwitchCamera}
            onToggleRemoteMute={onToggleRemoteMute}
            onSwap={() => setIsSwapped(value => !value)}
            onToggleStats={() => setShowStats(value => !value)}
            onNativePip={handleNativePip}
            onClose={() => setShowMore(false)}
          />
        )}
      </div>

      {showSafety && safetyNums && <SafetyModal safetyNums={safetyNums} onVerify={onVerifySafety} onClose={onCloseSafety} />}

      {showDebug && isCallDebugEnabled() && portRecordsRef && onRunSelfTest && (
        <CallDebugCenter
          portRecordsRef={portRecordsRef}
          myRole={myRole ?? null}
          sessionId={sessionId ?? ''}
          peerConnectionId={peerConnectionId ?? ''}
          mediaHealth={mediaHealth ?? []}
          onRunSelfTest={onRunSelfTest}
          onClose={() => setShowDebug(false)}
          remoteVideoRef={remoteVideoRef}
          isSwapped={isSwapped}
          presentedFrameCountRef={presentedFrameCountRef}
        />
      )}
    </>
  );
}
