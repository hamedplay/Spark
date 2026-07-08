import { useState } from 'react';
import { ShieldCheck, ShieldAlert, PhoneOff, RefreshCw, Bug } from 'lucide-react';
import { SUPPORTS_TRANSFORMS } from './types';
import { isCallDebugEnabled } from './callDebugStore';
import { useE2EECall } from './useE2EECall';
import { IncomingRingView } from './IncomingRingView';
import { OutgoingRingView } from './OutgoingRingView';
import { ActiveCallView } from './ActiveCallView';
import { IdleView } from './IdleView';
import { CallDebugCenter } from './CallDebugCenter';
import type { E2EECallProps } from './types';

export function E2EECallPage({ currentUserId, currentUserName, onBack }: E2EECallProps) {
  const {
    phase, e2eeStatus, isMuted, isVideoOff, isRemoteMuted, isScreenSharing,
    isSwitchingCamera, isStartingScreenShare,
    targetUser, incomingCall, safetyNums, showSafety, failReason,
    userSearch, users, searching, connDiag, isOffline, mediaHealth,
    localVideoRef, remoteVideoRef, localStreamRef, remoteStreamRef,
    portRecordsRef, myRoleRef, sessionIdRef, peerConnectionIdRef,
    startCall, acceptCall, rejectCall, doHangup,
    toggleMute, toggleVideo, toggleScreenShare, switchCamera, verifySafety, runSelfTest,
    setUserSearch, setShowSafety, setIsRemoteMuted, setPhase, setFailReason,
  } = useE2EECall(currentUserId, currentUserName);

  const [showFailedDebug, setShowFailedDebug] = useState(false);

  const isCallActive  = phase === 'connecting' || phase === 'connected';
  const isCallOngoing = isCallActive || phase === 'outgoing_ring' || phase === 'incoming_ring';

  const failReasonText =
    failReason === 'ice_failed'        ? 'خطای شبکه ICE' :
    failReason === 'key_exchange'      ? 'خطای تبادل کلید رمزنگاری' :
    failReason === 'no_transforms'     ? 'مرورگر ناسازگار' :
    failReason === 'peer_disconnected' ? 'مخاطب قطع شد' :
    failReason === 'invite_expired'    ? 'دعوت منقضی شد' :
    failReason ?? '';

  return (
    <div
      className={`flex flex-col ${isCallActive ? 'h-full overflow-hidden' : 'h-full'}`}
      dir="rtl"
    >
      {/* Header — hidden during active call for full-screen experience */}
      {!isCallOngoing && (
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              بازگشت
            </button>
            <div className="flex items-center gap-2">
              <ShieldCheck aria-hidden="true" className="w-5 h-5 text-emerald-500" />
              <h2 className="text-lg font-bold text-gray-800 dark:text-white">تماس با رمزنگاری سرتاسری</h2>
            </div>
          </div>
          {!SUPPORTS_TRANSFORMS && (
            <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2.5 py-1 rounded-full flex items-center gap-1">
              <ShieldAlert aria-hidden="true" className="w-3.5 h-3.5" /> مرورگر ناسازگار — تماس رمزشده غیرممکن
            </span>
          )}
        </div>
      )}

      {/* Content area — flex-1 + min-h-0 so ActiveCallView can fill parent height */}
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

        {/* Active call — full bleed within flex-1 container */}
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
            className="flex flex-col items-center justify-center py-16 gap-4"
          >
            <div className="w-16 h-16 rounded-2xl bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
              {phase === 'failed'
                ? <ShieldAlert aria-hidden="true" className="w-8 h-8 text-red-400" />
                : <PhoneOff    aria-hidden="true" className="w-8 h-8 text-gray-400" />
              }
            </div>
            <div className="text-center">
              <p className="font-semibold text-gray-800 dark:text-white">
                {phase === 'failed' ? 'تماس ناموفق بود' : 'تماس پایان یافت'}
              </p>
              {phase === 'failed' && failReasonText && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{failReasonText}</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { setPhase('idle'); setFailReason(null); }}
                className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm transition-colors"
              >
                <RefreshCw aria-hidden="true" className="w-4 h-4" /> تماس جدید
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
