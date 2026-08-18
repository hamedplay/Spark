// @ts-nocheck
import { useCallback } from 'react';
import toast from 'react-hot-toast';
import type { Reaction } from '../types';

export function useConferenceMediaControls(scope: Record<string, any>) {
  const {
    broadcastStateRef, currentUserId, currentUserName, dispatch, isHandRaised, isMuted,
    isVideoOff, localStream, localStreamRef, mediaRef, myPeerId, peersRef,
    room, screenStreamRef, sendSignal, sendSignalRef, setReactions, setShowEmojiPicker,
    setSpeakingSecs, setTileReactions, showTileReactionRef, speakingSecsRef, stopScreenShareRef, supabase
  } = scope;

  // ── Controls ───────────────────────────────────────────────────────────────
  const broadcastState = useCallback((muted: boolean, videoOff: boolean, handRaised: boolean) => {
    sendSignal(null, 'state', { peerId: myPeerId, isMuted: muted, isVideoOff: videoOff, isHandRaised: handRaised });
    supabase.from('conference_participants')
      .update({ is_muted: muted, is_video_off: videoOff, is_hand_raised: handRaised })
      .eq('room_id', room.id).eq('user_id', currentUserId)
      .then(({ error }) => { if (error) console.error('broadcastState DB error:', error); });
  }, [sendSignal, myPeerId, room.id, currentUserId]);

  // Stable ref so it's usable inside channel callbacks without stale closure
  broadcastStateRef.current = broadcastState;

  const toggleMute = () => {
    const n = !isMuted;
    localStream.getAudioTracks().forEach(t => { t.enabled = !n; });
    dispatch({ type: 'TOGGLE_MUTE' });
    broadcastState(n, isVideoOff, isHandRaised);
    if (!n) { speakingSecsRef.current = 0; setSpeakingSecs(0); }
  };

  const toggleVideo = () => {
    const n = !isVideoOff;
    localStream.getVideoTracks().forEach(t => { t.enabled = !n; });
    dispatch({ type: 'TOGGLE_VIDEO' });
    broadcastState(isMuted, n, isHandRaised);
  };

  const toggleHand = () => {
    const n = !isHandRaised;
    dispatch({ type: 'TOGGLE_HAND' });
    broadcastState(isMuted, isVideoOff, n);
    if (n) toast('دست شما بلند شد');
  };

  const startScreenShare = async () => {
    try {
      const ss = await (navigator.mediaDevices as any).getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = ss;
      const screenVideoTrack = ss.getVideoTracks()[0];
      const screenAudioTrack = ss.getAudioTracks()[0] ?? null;

      for (const p of peersRef.current.values()) {
        const videoSender = p.pc.getSenders().find(s => s.track?.kind === 'video');
        let needsRenegotiation = false;

        if (videoSender) {
          await videoSender.replaceTrack(screenVideoTrack).catch(err => console.error('replaceTrack video error:', err));
        } else {
          p.pc.addTrack(screenVideoTrack, localStreamRef.current);
          needsRenegotiation = true;
        }

        if (screenAudioTrack) {
          const audioSender = p.pc.getSenders().find(s => s.track?.kind === 'audio');
          if (!audioSender) {
            p.pc.addTrack(screenAudioTrack, ss);
            needsRenegotiation = true;
          }
        }

        if (needsRenegotiation && p.pc.signalingState === 'stable') {
          try {
            const offer = await p.pc.createOffer();
            await p.pc.setLocalDescription(offer);
            sendSignalRef.current(p.peerId, 'offer', { sdp: p.pc.localDescription });
          } catch (e) { console.error('renegotiation after addTrack failed', e); }
        }
      }

      dispatch({ type: 'SET_SCREEN_SHARING', value: true });
      sendSignal(null, 'state', { peerId: myPeerId, isMuted, isVideoOff, isHandRaised, isScreenSharing: true });

      screenVideoTrack.onended = () => stopScreenShareRef.current();
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') {
        toast.error(
          'دسترسی به اشتراک‌گذاری صفحه رد شد.\nدر تنظیمات مرورگر، دسترسی صفحه نمایش را فعال کنید.',
          { duration: 6000 }
        );
      } else if (e?.name === 'TypeError') {
        toast.error('مرورگر شما از اشتراک‌گذاری صفحه پشتیبانی نمی‌کند. لطفاً Chrome یا Edge را امتحان کنید.');
      } else if (e?.name === 'NotFoundError') {
        toast.error('صفحه‌ای برای اشتراک‌گذاری یافت نشد.');
      } else if (e?.name !== 'AbortError') {
        toast.error('خطا در اشتراک‌گذاری صفحه. دوباره تلاش کنید.', { duration: 4000 });
      }
    }
  };

  const stopScreenShare = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current = null;

    const camTrack = localStreamRef.current.getVideoTracks()[0] ?? null;

    for (const p of peersRef.current.values()) {
      const sender = p.pc.getSenders().find(s => s.track?.kind === 'video');
      if (sender) {
        if (camTrack) {
          camTrack.enabled = !mediaRef.current.isVideoOff;
          await sender.replaceTrack(camTrack).catch(() => {});
        } else {
          await sender.replaceTrack(null).catch(() => {});
        }
      }
    }

    dispatch({ type: 'SET_SCREEN_SHARING', value: false });
    // Use ref so this is never stale when called from screenTrack.onended
    const { isMuted: m, isVideoOff: v, isHandRaised: h } = mediaRef.current;
    broadcastStateRef.current(m, v, h);
  }, []);

  stopScreenShareRef.current = stopScreenShare;

  const showTileReaction = useCallback((userId: string, emoji: string) => {
    setTileReactions(prev => new Map(prev).set(userId, emoji));
    setTimeout(() => {
      setTileReactions(prev => {
        const next = new Map(prev);
        next.delete(userId);
        return next;
      });
    }, 3000);
  }, []);
  showTileReactionRef.current = showTileReaction;

  const sendEmoji = (emoji: string) => {
    setShowEmojiPicker(false);
    const r: Reaction = { id: crypto.randomUUID(), userId: currentUserId, displayName: currentUserName, emoji, x: 0, y: 0, createdAt: Date.now(), expiresAt: Date.now() + 3000 };
    sendSignal(null, 'reaction', r);
    setReactions(prev => [...prev, { ...r, x: Math.random() * 80 + 10, y: Math.random() * 60 + 20 }]);
    setTimeout(() => setReactions(prev => prev.filter(x => x.id !== r.id)), 3000);
    showTileReaction(currentUserId, emoji);
  };

  return {
    sendEmoji, startScreenShare, stopScreenShare, toggleHand, toggleMute, toggleVideo
  };
}
