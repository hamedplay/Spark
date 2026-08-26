// @ts-nocheck
import { useCallback } from 'react';
import { supabase } from '../../../lib/supabase';
import { stopDiagnostics } from '../../../lib/webrtcDiagnostics';
import toast from 'react-hot-toast';
import { SUPPORTS_TRANSFORMS, logWarn, logError } from './types';
import type { FailReason } from './types';
import { clearChannelRegistry } from './signaling';
import { isCallDebugEnabled, dbgInfo, dbgWarn, dbgError, debugStoreMarkEnded } from './callDebugStore';

export function useE2EELifecycleHelpers(scope: Record<string, any>) {
  const {
    acceptTokenRef, activeKeysRef, callGenerationRef, cameraTrackRef, cleaningUpRef, currentFacingModeRef,
    ecdhKeyPairRef, iceCandidateQueue, isScreenShareOpRef, isScreenSharingRef, isSwitchingCameraRef, lastKeyFingerprintRef,
    localStreamRef, localVideoRef, lockedPeerRef, myPeerIdRef, myPublicJWKRef, offerSentRef,
    pcRef, peerConnectionIdRef, portRecordsRef, presentedFrameCountRef, remoteStreamRef, remoteVideoRef,
    safetyVerifiedRef, saltRef, screenStreamRef, sessionActiveRef, sessionChannelRef, sessionIdRef,
    setConnDiag, setE2eeStatus, setFailReason, setIncomingCall, setIsMuted, setIsScreenSharing,
    setIsStartingScreenShare, setIsSwitchingCamera, setIsVideoOff, setMediaHealth, setPhase, setSafetyNums,
    setSessionCode, setShowSafety, setTargetUser, stopRTPSnapshots, transformWaitersRef, workerRef
  } = scope;

  // ── Cleanup ────────────────────────────────────────────────────────────
  const doFullCleanup = useCallback((reason?: FailReason) => {
    if (cleaningUpRef.current) return;
    cleaningUpRef.current = true;
    dbgInfo('lifecycle', 'cleanup-started', { reason: reason ?? 'none' });

    // Invalidate all outstanding async operations
    callGenerationRef.current++;

    sessionActiveRef.current = false;
    offerSentRef.current = false;
    isSwitchingCameraRef.current = false;
    isScreenShareOpRef.current = false;

    workerRef.current?.postMessage({ type: 'clear' });

    stopRTPSnapshots();
    if (sessionIdRef.current) stopDiagnostics(sessionIdRef.current);
    setConnDiag(null);
    setMediaHealth([]);

    pcRef.current?.close();
    pcRef.current = null;
    peerConnectionIdRef.current = '';
    dbgInfo('peer-connection', 'pc-closed-cleanup');

    localStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    cameraTrackRef.current = null;
    currentFacingModeRef.current = 'user';

    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    isScreenSharingRef.current = false;

    remoteStreamRef.current = null;
    if (localVideoRef.current)  localVideoRef.current.srcObject  = null;
    // Guard: only clear the remote element if it still belongs to this generation.
    // After cleanup, callGenerationRef has already been incremented, so the
    // new element (if any) will get a fresh bind from onRemoteElementMount.
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    presentedFrameCountRef.current = 0;

    portRecordsRef.current.forEach(pr => {
      pr.state = 'closed';
      try { pr.port.close(); } catch { /* already closed */ }
    });
    portRecordsRef.current = [];
    transformWaitersRef.current = [];

    iceCandidateQueue.current = [];
    activeKeysRef.current = null;
    lockedPeerRef.current = null;
    saltRef.current = null;
    acceptTokenRef.current = '';

    if (sessionChannelRef.current) {
      supabase.removeChannel(sessionChannelRef.current);
      sessionChannelRef.current = null;
      dbgInfo('signaling', 'session-channel-removed');
    }
    clearChannelRegistry();
    sessionIdRef.current   = '';
    ecdhKeyPairRef.current = null;
    myPublicJWKRef.current = '';
    lastKeyFingerprintRef.current = '';

    setSafetyNums(null);
    setShowSafety(false);
    safetyVerifiedRef.current = false;
    setE2eeStatus(SUPPORTS_TRANSFORMS ? 'pending' : 'unsupported');
    setTargetUser(null);
    setIncomingCall(null);
    setSessionCode('');
    setIsMuted(false);
    setIsVideoOff(false);
    setIsScreenSharing(false);
    setIsSwitchingCamera(false);
    setIsStartingScreenShare(false);

    // PRESERVE the debug timeline so the failure screen can show/export it.
    // Do NOT call debugStoreReset() here — that happens only at the start of a new call.
    debugStoreMarkEnded(reason ?? undefined);
    cleaningUpRef.current = false;

    if (reason) { setFailReason(reason); setPhase('failed'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRTPSnapshots]);

  const doHangup = useCallback((sendSignal = true) => {
    if (sendSignal && sessionChannelRef.current && sessionIdRef.current) {
      sessionChannelRef.current.send({
        type: 'broadcast', event: 'e2ee-signal',
        payload: { type: 'hangup', from: myPeerIdRef.current, session: sessionIdRef.current, data: {} },
      });
    }
    doFullCleanup();
    setPhase('ended');
  }, [doFullCleanup]);

  // ── Media helpers ──────────────────────────────────────────────────────
  const startLocalStream = async (capturedGeneration: number): Promise<MediaStream | null> => {
    dbgInfo('media', 'get-user-media-starting');
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, ...(isMobile && { sampleRate: 16000 }) },
        video: isMobile ? { facingMode: 'user', width: { ideal: 360, max: 480 }, height: { ideal: 640, max: 720 }, frameRate: { ideal: 20, max: 30 } }
          : { facingMode: 'user', width: { ideal: 640, max: 1280 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 30, max: 30 } },
      });

      if (capturedGeneration !== callGenerationRef.current) {
        s.getTracks().forEach(t => t.stop());
        dbgWarn('media', 'get-user-media-stale', { capturedGeneration });
        return null;
      }

      const audioTracks = s.getAudioTracks();
      const videoTracks = s.getVideoTracks();

      dbgInfo('media', 'get-user-media-success', {
        audioTracks: audioTracks.length,
        videoTracks: videoTracks.length,
        audioEnabled: audioTracks[0]?.enabled,
        videoEnabled: videoTracks[0]?.enabled,
        audioReadyState: audioTracks[0]?.readyState,
        videoReadyState: videoTracks[0]?.readyState,
      });

      if (audioTracks.length === 0) {
        toast.error('دسترسی به میکروفون ممکن نیست');
        dbgError('media', 'no-audio-track');
        s.getTracks().forEach(t => t.stop());
        return null;
      }
      if (videoTracks.length === 0) {
        toast.error('دسترسی به دوربین ممکن نیست');
        dbgError('media', 'no-video-track');
        s.getTracks().forEach(t => t.stop());
        return null;
      }

      localStreamRef.current = s;
      const firstVideoTrack = s.getVideoTracks()[0] ?? null;
      cameraTrackRef.current = firstVideoTrack;
      const actualFacing = firstVideoTrack?.getSettings().facingMode;
      currentFacingModeRef.current = actualFacing === 'environment' ? 'environment' : 'user';

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = s;
        localVideoRef.current.play().catch(() => {});
      }
      return s;
    } catch (e) {
      logError('[E2EE][ERROR]', 'getUserMedia failed:', e);
      dbgError('media', 'get-user-media-failed', { error: String(e) });
      toast.error('دسترسی به دوربین یا میکروفون داده نشد');
      return null;
    }
  };

  const flushICEQueue = async (pc: RTCPeerConnection, capturedPCId: string) => {
    const queued = iceCandidateQueue.current.splice(0);
    dbgInfo('ice', 'ice-queue-flush', { count: queued.length, pcId: capturedPCId.slice(0, 8) });
    for (const c of queued) {
      await pc.addIceCandidate(new RTCIceCandidate(c)).catch(e =>
        logWarn('[E2EE][ICE]', 'addIceCandidate (queued) failed:', e)
      );
    }
  };

  // ── SDP direction logging ──────────────────────────────────────────────
  const logSDPDirections = (sdp: string | undefined, label: string) => {
    if (!isCallDebugEnabled() || !sdp) return;
    const lines = sdp.split('\n');
    let mediaSection = '';
    const sections: string[] = [];
    for (const line of lines) {
      if (line.startsWith('m=')) { mediaSection = line.trim(); }
      else if (mediaSection && /^a=(sendrecv|sendonly|recvonly|inactive)/.test(line)) {
        const dir = line.trim().replace('a=', '');
        sections.push(`${mediaSection.split(' ')[0].replace('m=', '')}:${dir}`);
        mediaSection = '';
      }
    }
    dbgInfo('sdp', `sdp-direction-${label}`, { directions: sections });
  };

  // ── Transceiver direction audit ────────────────────────────────────────
  const auditTransceiverDirections = (pc: RTCPeerConnection, stage: string) => {
    if (!isCallDebugEnabled()) return;
    const transceivers = pc.getTransceivers();
    for (const t of transceivers) {
      const data = {
        stage,
        mid: t.mid,
        senderKind: t.sender?.track?.kind,
        receiverKind: t.receiver?.track?.kind,
        direction: t.direction,
        currentDirection: t.currentDirection,
        stopped: t.stopped,
      };
      if (t.currentDirection && t.currentDirection !== 'sendrecv') {
        dbgWarn('peer-connection', 'transceiver-not-sendrecv', data);
      } else {
        dbgInfo('peer-connection', 'transceiver-state', data);
      }
    }
  };

  return {
    auditTransceiverDirections, doFullCleanup, doHangup, flushICEQueue, logSDPDirections, startLocalStream
  };
}
