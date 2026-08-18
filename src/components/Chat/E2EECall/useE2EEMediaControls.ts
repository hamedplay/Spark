// @ts-nocheck
import { useCallback } from 'react';
import toast from 'react-hot-toast';
import { logError } from './types';
import { isCallDebugEnabled, dbgInfo, getRTPSnapshots, analyseMediaHealth } from './callDebugStore';
import type { MediaHealthClassification } from './callDebugStore';

export function useE2EEMediaControls(scope: Record<string, any>) {
  const {
    activeKeysRef, cameraTrackRef, collectRTPSnapshot, currentFacingModeRef, isMuted, isScreenShareOpRef,
    isScreenSharingRef, isSwitchingCameraRef, isVideoOff, localStreamRef, localVideoRef, myPublicJWKRef,
    pcRef, presentedFrameCountRef, remoteVideoRef, safetyVerifiedRef, screenStreamRef, setE2eeStatus,
    setIsMuted, setIsScreenSharing, setIsStartingScreenShare, setIsSwitchingCamera, setIsVideoOff, setShowSafety,
    setVideoDevices, videoDevices
  } = scope;

  // ── Self-test ──────────────────────────────────────────────────────────
  const runSelfTest = useCallback(async (): Promise<MediaHealthClassification[]> => {
    const pc = pcRef.current;
    if (!pc) return [];
    dbgInfo('lifecycle', 'self-test-started');
    await collectRTPSnapshot();
    await new Promise(r => setTimeout(r, 2000));
    await collectRTPSnapshot();
    const snaps = getRTPSnapshots();
    const prev = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
    const curr = snaps[snaps.length - 1];
    if (!curr) return [];
    const result = analyseMediaHealth({
      prev, curr,
      portRecordStates: curr.portRecordStates,
      remoteVideoElement: remoteVideoRef.current,
      remoteVisibleElement: remoteVideoRef.current,
      localTracks: localStreamRef.current?.getTracks() ?? [],
      stalledCounters: new Map(),
      presentedFrameCount: isCallDebugEnabled() ? presentedFrameCountRef.current : null,
    });
    dbgInfo('lifecycle', 'self-test-complete', {
      results: result.map(r => `${r.direction}-${r.kind}:${r.classification}`),
    });
    return result;
  }, [collectRTPSnapshot]);

  // ── Media controls ─────────────────────────────────────────────────────
  const toggleMute  = () => { localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = isMuted; }); setIsMuted(v => !v); };
  const toggleVideo = () => { localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = isVideoOff; }); setIsVideoOff(v => !v); };

  const stopScreenShare = useCallback(async () => {
    if (isScreenShareOpRef.current) return;
    isScreenShareOpRef.current = true;
    const sender = pcRef.current?.getSenders().find(s => s.track?.kind === 'video');
    const restoreTrack = cameraTrackRef.current;
    if (sender) {
      try {
        if (restoreTrack && restoreTrack.readyState === 'live') {
          await sender.replaceTrack(restoreTrack);
        } else {
          const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
          const camStream = await navigator.mediaDevices.getUserMedia({ video: isMobile ? { facingMode: currentFacingModeRef.current } : { facingMode: 'user' }, audio: false });
          const camTrack = camStream.getVideoTracks()[0];
          if (camTrack) {
            cameraTrackRef.current = camTrack;
            await sender.replaceTrack(camTrack);
            if (localStreamRef.current) {
              localStreamRef.current.getVideoTracks().forEach(t => { t.stop(); localStreamRef.current!.removeTrack(t); });
              localStreamRef.current.addTrack(camTrack);
            }
          }
        }
      } catch (err) { logError('[E2EE][MEDIA]', 'restore camera track failed:', err); toast.error('بازگشت به دوربین ناموفق بود'); }
    }
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;
    if (localVideoRef.current && localStreamRef.current) localVideoRef.current.srcObject = localStreamRef.current;
    isScreenSharingRef.current = false;
    isScreenShareOpRef.current = false;
    setIsScreenSharing(false);
  }, []);

  const toggleScreenShare = useCallback(async () => {
    if (isScreenShareOpRef.current) return;
    if (isScreenSharingRef.current) { await stopScreenShare(); return; }
    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') { toast.error('اشتراک‌گذاری صفحه در این دستگاه پشتیبانی نمی‌شود'); return; }
    const pc = pcRef.current;
    const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
    if (!sender) { toast.error('فرستنده ویدیو پیدا نشد'); return; }
    isScreenShareOpRef.current = true;
    setIsStartingScreenShare(true);
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      screenStreamRef.current = displayStream;
      const screenTrack = displayStream.getVideoTracks()[0];
      if (!screenTrack) throw new Error('No screen video track');
      await sender.replaceTrack(screenTrack);
      if (localVideoRef.current) localVideoRef.current.srcObject = new MediaStream([screenTrack]);
      screenTrack.addEventListener('ended', () => { void stopScreenShare(); }, { once: true });
      isScreenSharingRef.current = true;
      isScreenShareOpRef.current = false;
      setIsScreenSharing(true);
    } catch (err: unknown) {
      isScreenShareOpRef.current = false;
      if (!(err instanceof Error) || err.name !== 'NotAllowedError') toast.error('اشتراک‌گذاری صفحه شروع نشد');
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
    } finally { setIsStartingScreenShare(false); }
  }, [stopScreenShare]);

  const verifySafety = useCallback(() => {
    if (!myPublicJWKRef.current || !activeKeysRef.current) { logError('[E2EE][SAFETY]', 'verifySafety called before keys'); return; }
    safetyVerifiedRef.current = true;
    setE2eeStatus('active_verified');
    setShowSafety(false);
    dbgInfo('e2ee', 'safety-verified');
  }, []);

  const switchCamera = useCallback(async () => {
    if (isSwitchingCameraRef.current) return;
    if (isScreenSharingRef.current) { toast('ابتدا اشتراک‌گذاری صفحه را متوقف کنید'); return; }
    const currentStream = localStreamRef.current;
    if (!currentStream) return;
    const isMobile = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    let devices = videoDevices;
    if (devices.length === 0) {
      try { const all = await navigator.mediaDevices.enumerateDevices(); devices = all.filter(d => d.kind === 'videoinput'); setVideoDevices(devices); } catch { /* ignore */ }
    }
    const currentTrack = currentStream.getVideoTracks()[0];
    let videoConstraints: MediaTrackConstraints;
    if (devices.length >= 2) {
      const currentDeviceId = currentTrack?.getSettings().deviceId;
      const currentIndex = devices.findIndex(d => d.deviceId === currentDeviceId);
      const nextDevice = devices[(currentIndex + 1) % devices.length];
      videoConstraints = { deviceId: { exact: nextDevice.deviceId }, width: { ideal: 640 }, height: { ideal: 480 } };
    } else if (isMobile) {
      const nextFacing = currentFacingModeRef.current === 'user' ? 'environment' : 'user';
      videoConstraints = { facingMode: { exact: nextFacing }, width: { ideal: 640 }, height: { ideal: 480 } };
    } else { toast('دوربین دیگری در دسترس نیست'); return; }
    isSwitchingCameraRef.current = true;
    setIsSwitchingCamera(true);
    let newStream: MediaStream | null = null;
    try {
      newStream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints });
      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) throw new Error('No video track from new camera');
      const pc = pcRef.current;
      const sender = pc?.getSenders().find(s => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(newTrack);
      currentTrack?.stop();
      currentStream.getVideoTracks().forEach(t => { if (t !== newTrack) currentStream.removeTrack(t); });
      currentStream.addTrack(newTrack);
      cameraTrackRef.current = newTrack;
      const newFacing = newTrack.getSettings().facingMode;
      currentFacingModeRef.current = newFacing === 'environment' ? 'environment' : 'user';
      if (localVideoRef.current) localVideoRef.current.srcObject = currentStream;
    } catch (err) {
      logError('[E2EE][MEDIA]', 'switchCamera failed:', err);
      newStream?.getTracks().forEach(t => t.stop());
      const errName = (err instanceof Error) ? err.name : '';
      if (errName === 'NotFoundError' || errName === 'DevicesNotFoundError') toast.error('دوربین دیگری در دسترس نیست');
      else if (errName === 'NotAllowedError' || errName === 'PermissionDeniedError') toast.error('دسترسی به دوربین یا میکروفون داده نشد');
      else if (errName === 'OverconstrainedError' || errName === 'ConstraintNotSatisfiedError') toast.error('دوربین دیگری در دسترس نیست');
      else toast.error('تغییر دوربین انجام نشد');
    } finally { isSwitchingCameraRef.current = false; setIsSwitchingCamera(false); }
  }, [videoDevices]);

  return {
    runSelfTest, switchCamera, toggleMute, toggleScreenShare, toggleVideo, verifySafety
  };
}
