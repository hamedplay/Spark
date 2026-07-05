import type { RefObject } from 'react';
import {
  Mic, MicOff, Video, VideoOff, PhoneOff, ShieldCheck, ShieldAlert,
  Loader, Check, Wifi, WifiOff, Volume2, VolumeX, Monitor, MonitorOff,
} from 'lucide-react';
import type { PeerDiagnostics } from '../../../lib/webrtcDiagnostics';
import type { CallPhase, E2EEStatus, UserProfile } from './types';

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
    icon = <ShieldCheck className="w-3.5 h-3.5" />;
    label = 'E2EE تأییدشده';
    cls = 'bg-emerald-900/80 text-emerald-300';
  } else if (status === 'active_unverified') {
    icon = <ShieldAlert className="w-3.5 h-3.5" />;
    label = 'E2EE — هویت تأییدنشده';
    cls = 'bg-amber-900/80 text-amber-300';
  } else if (status === 'error') {
    icon = <ShieldAlert className="w-3.5 h-3.5" />;
    label = 'خطای رمزنگاری';
    cls = 'bg-red-900/80 text-red-300';
  } else {
    icon = <Loader className="w-3.5 h-3.5 animate-spin" />;
    label = 'در انتظار کلید رمزنگاری...';
    cls = 'bg-gray-800/80 text-gray-300';
  }

  return (
    <button
      onClick={onClick}
      className={`absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${cls}`}
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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm space-y-4" dir="rtl">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-5 h-5 text-emerald-400" />
          <h3 className="font-bold text-white">Safety Number جلسه</h3>
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
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          این کد فقط برای این جلسه معتبر است و هر بار تغییر می‌کند.
          Metadata تماس (IP، مدت، codec) توسط E2EE محافظت نمی‌شود.
        </p>
        <div className="flex gap-2">
          <button
            onClick={onVerify}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-medium transition-colors flex items-center justify-center gap-1"
          >
            <Check className="w-4 h-4" /> مطابقت دارد
          </button>
          <button
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

export function ActiveCallView({
  phase, targetUser, localVideoRef, remoteVideoRef,
  isMuted, isVideoOff, isRemoteMuted, isScreenSharing,
  connDiag, isOffline, e2eeStatus, safetyNums, showSafety,
  onToggleMute, onToggleVideo, onToggleScreenShare, onHangup,
  onToggleRemoteMute, onShowSafety, onCloseSafety, onVerifySafety,
}: Props) {
  return (
    <>
      <div className="relative h-[460px] sm:h-[540px] bg-gray-950 rounded-2xl overflow-hidden">
        {/* Remote video */}
        <video ref={remoteVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

        {/* Connecting overlay */}
        {phase === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-gray-950/80">
            <Loader className="w-8 h-8 text-emerald-400 animate-spin" />
            <span className="text-white text-sm">در حال اتصال...</span>
          </div>
        )}

        {/* Local PiP */}
        <div className="absolute bottom-20 right-3 w-28 h-20 sm:w-36 sm:h-24 rounded-xl overflow-hidden border-2 border-white/20 shadow-xl bg-gray-900">
          <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        </div>

        {/* E2EE badge */}
        {phase === 'connected' && (
          <E2EEBadge status={e2eeStatus} onClick={onShowSafety} />
        )}

        {/* Peer name */}
        {targetUser && (
          <div className="absolute top-3 right-3 text-white/70 text-sm font-medium drop-shadow-sm">
            {targetUser.full_name || targetUser.email || 'مخاطب'}
          </div>
        )}

        {/* Network / QoS */}
        {phase === 'connected' && (
          <div className="absolute top-10 right-3 flex items-center gap-1.5">
            {isOffline ? (
              <span className="flex items-center gap-1 text-[10px] text-red-400 bg-black/50 px-2 py-0.5 rounded-full">
                <WifiOff className="w-3 h-3" /> قطع
              </span>
            ) : connDiag ? (
              <span className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-black/50 ${connDiag.rttMs !== null && connDiag.rttMs > 400 ? 'text-amber-400' : 'text-emerald-400'}`}>
                <Wifi className="w-3 h-3" />
                {connDiag.selectedCandidatePair?.localType === 'relay' ? 'TURN' : 'P2P'}
                {connDiag.rttMs !== null ? ` · ${connDiag.rttMs}ms` : ''}
              </span>
            ) : null}
          </div>
        )}

        {/* Controls */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3">
          <button
            onClick={onToggleMute}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isMuted ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`}
          >
            {isMuted ? <MicOff className="w-5 h-5 text-white" /> : <Mic className="w-5 h-5 text-white" />}
          </button>

          <button
            onClick={onToggleScreenShare}
            title={isScreenSharing ? 'توقف اشتراک صفحه' : 'اشتراک‌گذاری صفحه'}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isScreenSharing ? 'bg-blue-600 hover:bg-blue-700' : 'bg-white/20 hover:bg-white/30'}`}
          >
            {isScreenSharing ? <MonitorOff className="w-5 h-5 text-white" /> : <Monitor className="w-5 h-5 text-white" />}
          </button>

          <button
            onClick={onHangup}
            className="w-14 h-14 rounded-full bg-red-600 hover:bg-red-700 flex items-center justify-center transition-colors"
          >
            <PhoneOff className="w-6 h-6 text-white" />
          </button>

          <button
            onClick={onToggleVideo}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isVideoOff ? 'bg-red-600 hover:bg-red-700' : 'bg-white/20 hover:bg-white/30'}`}
          >
            {isVideoOff ? <VideoOff className="w-5 h-5 text-white" /> : <Video className="w-5 h-5 text-white" />}
          </button>

          <button
            onClick={onToggleRemoteMute}
            title={isRemoteMuted ? 'فعال کردن صدای طرف مقابل' : 'بی‌صدا کردن طرف مقابل'}
            className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${isRemoteMuted ? 'bg-amber-500 hover:bg-amber-600' : 'bg-white/20 hover:bg-white/30'}`}
          >
            {isRemoteMuted ? <VolumeX className="w-5 h-5 text-white" /> : <Volume2 className="w-5 h-5 text-white" />}
          </button>
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
