import { useEffect, useRef, useState } from 'react';
import { ShieldAlert, PhoneOff, Bug } from 'lucide-react';
import { SUPPORTS_TRANSFORMS } from './types';
import { isCallDebugEnabled } from './callDebugStore';
import { useE2EECall } from './useE2EECall';
import { IncomingRingView } from './IncomingRingView';
import { OutgoingRingView } from './OutgoingRingView';
import { ActiveCallView } from './ActiveCallView';
import { CallDebugCenter } from './CallDebugCenter';
import type { E2EECallProps } from './types';

export function E2EECallPage({ currentUserId, currentUserName, initialTargetUser, onBack }: E2EECallProps) {
  const {
    phase, e2eeStatus, isMuted, isVideoOff, isRemoteMuted, isScreenSharing,
    isSwitchingCamera, isStartingScreenShare,
    targetUser, incomingCall, safetyNums, showSafety, failReason,
    connDiag, isOffline, mediaHealth,
    localVideoRef, remoteVideoRef, localStreamRef, remoteStreamRef,
    portRecordsRef, myRoleRef, sessionIdRef, peerConnectionIdRef,
    startCall, acceptCall, rejectCall, doHangup,
    toggleMute, toggleVideo, toggleScreenShare, switchCamera, verifySafety, runSelfTest,
    onRemoteElementMount,
    setShowSafety, setIsRemoteMuted,
  } = useE2EECall(currentUserId, currentUserName);

  const initialCallStartedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialTargetUser || phase !== 'idle') return;
    if (initialCallStartedRef.current === initialTargetUser.user_id) return;
    initialCallStartedRef.current = initialTargetUser.user_id;
    void startCall(initialTargetUser);
  }, [initialTargetUser, phase, startCall]);

  const [showFailedDebug, setShowFailedDebug] = useState(false);

  const isCallActive  = phase === 'connecting' || phase === 'connected';

  const failReasonText =
    failReason === 'ice_failed'        ? 'خطای شبکه ICE' :
    failReason === 'key_exchange'      ? 'خطای تبادل کلید رمزنگاری' :
    failReason === 'no_transforms'     ? 'مرورگر ناسازگار' :
    failReason === 'peer_disconnected' ? 'مخاطب قطع شد' :
    failReason === 'invite_expired'    ? 'دعوت منقضی شد' :
    failReason ?? '';

  return (
    <div
      className="fixed inset-0 z-[9998] flex flex-col overflow-hidden bg-gray-950"
      dir="rtl"
    >
      <div className={`flex-1 min-h-0 ${isCallActive ? 'overflow-hidden p-0' : 'overflow-auto p-4'}`}>

        {/* Browser unsupported */}
        {!SUPPORTS_TRANSFORMS && (
          <div role="alert" className="max-w-md mx-auto mt-6 p-5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl space-y-2">
            <p className="font-semibold text-amber-800 dark:text-amber-300 flex items-center gap-2">
              <ShieldAlert aria-hidden="true" className="w-5 h-5" /> مرورگر ناسازگار
            </p>
            <p className="text-sm text-amber-700 dark:text-amber-400 leading-relaxed">
              مرورگر شما از <code className="bg-amber-100 dark:bg-amber-900/50 px-1 rounded">RTCRtpScriptTransform</code> پشتیبانی نمی‌کند.
              این قابلیت در Chrome 94+ و Firefox 117+ موجود است.
              تماس بدون رمزنگاری فریم در این صفحه <strong>شروع نمی‌شود</strong>.
            </p>
            <button
              type="button"
              onClick={onBack}
              className="mt-2 rounded-xl bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
            >
              بازگشت به چت
            </button>
          </div>
        )}

        {/* Incoming ring */}
        {SUPPORTS_TRANSFORMS && phase === 'incoming_ring' && incomingCall && (
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
            onCancel={() => doHangup()}
          />
        )}

        {/* Active call — full bleed within fixed call overlay */}
        {isCallActive && (
          <ActiveCallView
            phase={phase}
            targetUser={targetUser}
            localVideoRef={localVideoRef}
            remoteVideoRef={remoteVideoRef}
            localStreamRef={localStreamRef}
            remoteStreamRef={remoteStreamRef}
            isMuted={isMuted}
            isVideoOff={isVideoOff}
            isRemoteMuted={isRemoteMuted}
            isScreenSharing={isScreenSharing}
            isSwitchingCamera={isSwitchingCamera}
            isStartingScreenShare={isStartingScreenShare}
            connDiag={connDiag}
            isOffline={isOffline}
            e2eeStatus={e2eeStatus}
            safetyNums={safetyNums}
            showSafety={showSafety}
            onToggleMute={toggleMute}
            onToggleVideo={toggleVideo}
            onToggleScreenShare={toggleScreenShare}
            onSwitchCamera={switchCamera}
            onHangup={() => doHangup()}
            onToggleRemoteMute={() => setIsRemoteMuted(v => !v)}
            onShowSafety={() => setShowSafety(true)}
            onCloseSafety={() => setShowSafety(false)}
            onVerifySafety={verifySafety}
            onRemoteElementMount={onRemoteElementMount}
            portRecordsRef={portRecordsRef}
            myRole={myRoleRef.current}
            sessionId={sessionIdRef.current}
            peerConnectionId={peerConnectionIdRef.current}
            mediaHealth={mediaHealth}
            onRunSelfTest={runSelfTest}
          />
        )}

        {/* Ended / Failed */}
        {(phase === 'ended' || phase === 'failed') && (
          <div
            role={phase === 'failed' ? 'alert' : 'status'}
            className="flex min-h-full flex-col items-center justify-center gap-4 py-16"
          >
            <div className="w-16 h-16 rounded-2xl bg-gray-800 flex items-center justify-center">
              {phase === 'failed'
                ? <ShieldAlert aria-hidden="true" className="w-8 h-8 text-red-400" />
                : <PhoneOff aria-hidden="true" className="w-8 h-8 text-gray-400" />
              }
            </div>
            <div className="text-center">
              <p className="font-semibold text-white">
                {phase === 'failed' ? 'تماس ناموفق بود' : 'تماس پایان یافت'}
              </p>
              {phase === 'failed' && failReasonText && (
                <p className="text-xs text-gray-400 mt-1">{failReasonText}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onBack}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
              >
                بازگشت به چت
              </button>
              {isCallDebugEnabled() && (
                <button
                  type="button"
                  onClick={() => setShowFailedDebug(true)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm transition-colors"
                >
                  <Bug aria-hidden="true" className="w-4 h-4" /> Debug
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Debug Center for failed/ended state — preserves the call failure timeline */}
      {showFailedDebug && isCallDebugEnabled() && (
        <CallDebugCenter
          portRecordsRef={portRecordsRef}
          myRole={myRoleRef.current}
          sessionId={sessionIdRef.current}
          peerConnectionId={peerConnectionIdRef.current}
          mediaHealth={mediaHealth}
          onRunSelfTest={runSelfTest}
          onClose={() => setShowFailedDebug(false)}
        />
      )}
    </div>
  );
}
