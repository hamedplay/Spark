import { ShieldCheck, ShieldAlert, PhoneOff, RefreshCw } from 'lucide-react';
import { SUPPORTS_TRANSFORMS } from './types';
import { useE2EECall } from './useE2EECall';
import { IncomingRingView } from './IncomingRingView';
import { OutgoingRingView } from './OutgoingRingView';
import { ActiveCallView } from './ActiveCallView';
import { IdleView } from './IdleView';
import type { E2EECallProps } from './types';

export function E2EECallPage({ currentUserId, currentUserName, onBack }: E2EECallProps) {
  const {
    phase, e2eeStatus, isMuted, isVideoOff, isRemoteMuted, isScreenSharing,
    targetUser, incomingCall, safetyNums, showSafety, sessionCode, failReason,
    userSearch, users, searching, connDiag, isOffline,
    localVideoRef, remoteVideoRef, safetyVerifiedRef,
    startCall, acceptCall, rejectCall, doHangup,
    toggleMute, toggleVideo, toggleScreenShare,
    setUserSearch, setShowSafety, setIsRemoteMuted, setE2eeStatus, setPhase, setFailReason,
  } = useE2EECall(currentUserId, currentUserName);

  return (
    <div className="flex flex-col h-full" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
          >
            بازگشت
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-bold text-gray-800 dark:text-white">تماس با رمزنگاری سرتاسری</h2>
          </div>
        </div>
        {!SUPPORTS_TRANSFORMS && (
          <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-full flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5" /> مرورگر ناسازگار — تماس رمزشده غیرممکن
          </span>
        )}
      </div>

      <div className="flex-1 overflow-auto p-4">

        {/* Browser unsupported */}
        {!SUPPORTS_TRANSFORMS && (
          <div className="max-w-md mx-auto mt-6 p-5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2">
            <p className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <ShieldAlert className="w-5 h-5" /> مرورگر ناسازگار
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
              مرورگر شما از <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">RTCRtpScriptTransform</code> پشتیبانی نمی‌کند.
              این قابلیت در Chrome 94+ و Firefox 117+ موجود است.
              تماس بدون رمزنگاری فریم در این صفحه <strong>شروع نمی‌شود</strong>.
            </p>
          </div>
        )}

        {/* Incoming ring */}
        {phase === 'incoming_ring' && incomingCall && (
          <IncomingRingView
            incomingCall={incomingCall}
            onAccept={acceptCall}
            onReject={rejectCall}
          />
        )}

        {/* Outgoing ring */}
        {phase === 'outgoing_ring' && (
          <OutgoingRingView
            targetUser={targetUser}
            sessionCode={sessionCode}
            onCancel={() => doHangup()}
          />
        )}

        {/* Active call */}
        {(phase === 'connecting' || phase === 'connected') && (
          <ActiveCallView
            phase={phase}
            targetUser={targetUser}
            localVideoRef={localVideoRef}
            remoteVideoRef={remoteVideoRef}
            isMuted={isMuted}
            isVideoOff={isVideoOff}
            isRemoteMuted={isRemoteMuted}
            isScreenSharing={isScreenSharing}
            connDiag={connDiag}
            isOffline={isOffline}
            e2eeStatus={e2eeStatus}
            safetyNums={safetyNums}
            showSafety={showSafety}
            onToggleMute={toggleMute}
            onToggleVideo={toggleVideo}
            onToggleScreenShare={toggleScreenShare}
            onHangup={() => doHangup()}
            onToggleRemoteMute={() => {
              const v = remoteVideoRef.current;
              if (v) { v.muted = !v.muted; setIsRemoteMuted(v.muted); }
            }}
            onShowSafety={() => setShowSafety(true)}
            onCloseSafety={() => setShowSafety(false)}
            onVerifySafety={() => {
              safetyVerifiedRef.current = true;
              setE2eeStatus('active_verified');
              setShowSafety(false);
            }}
          />
        )}

        {/* Ended / Failed */}
        {(phase === 'ended' || phase === 'failed') && (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              {phase === 'failed'
                ? <ShieldAlert className="w-8 h-8 text-red-400" />
                : <PhoneOff className="w-8 h-8 text-gray-400" />
              }
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-800 dark:text-white">
                {phase === 'failed' ? 'تماس ناموفق بود' : 'تماس پایان یافت'}
              </p>
              {phase === 'failed' && failReason && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                  {{ ice_failed: 'خطای شبکه ICE', key_exchange: 'خطای تبادل کلید رمزنگاری', no_transforms: 'مرورگر ناسازگار', peer_disconnected: 'مخاطب قطع شد', invite_expired: 'دعوت منقضی شد' }[failReason] ?? failReason}
                </p>
              )}
            </div>
            <button
              onClick={() => { setPhase('idle'); setFailReason(null); }}
              className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
            >
              <RefreshCw className="w-4 h-4" /> تماس جدید
            </button>
          </div>
        )}

        {/* Idle */}
        {phase === 'idle' && SUPPORTS_TRANSFORMS && (
          <IdleView
            userSearch={userSearch}
            users={users}
            searching={searching}
            onSearch={setUserSearch}
            onStartCall={startCall}
          />
        )}
      </div>
    </div>
  );
}
