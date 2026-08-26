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

  const renegotiatePeer = async (p: any) => {
    if (p.pc.signalingState !== 'stable') return;
    try {
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      sendSignalRef.current(p.peerId, 'offer', { sdp: p.pc.localDescription });
    } catch (e) { console.error('presenter renegotiation failed', e); }
  };

  const startScreenShare = async () => {
    try {
      if (screenStreamRef.current) return;
      const ss: MediaStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const screenVideoTrack = ss.getVideoTracks()[0];
      if (!screenVideoTrack) { ss.getTracks().forEach(t => t.stop()); throw new Error('SCREEN_VIDEO_UNAVAILABLE'); }
      const { data: claimed, error: claimError } = await supabase.rpc('claim_conference_presenter', { p_room_id: room.id });
      if (claimError || claimed !== true) { ss.getTracks().forEach(t => t.stop()); toast.error('امکان فعال‌کردن حالت ارائه در این جلسه وجود ندارد'); return; }
      screenStreamRef.current = ss;
      for (const p of peersRef.current.values()) {
        for (const track of ss.getTracks()) {
          const duplicate = p.pc.getSenders().some((sender: RTCRtpSender) => sender.track?.id === track.id);
          if (!duplicate) p.pc.addTrack(track, ss);
        }
        await renegotiatePeer(p);
      }
      dispatch({ type: 'SET_SCREEN_SHARING', value: true });
      sendSignal(null, 'state', { peerId: myPeerId, isMuted, isVideoOff, isHandRaised, isScreenSharing: true });
      screenVideoTrack.onended = () => { void stopScreenShareRef.current(); };
    } catch (e: any) {
      if (e?.name === 'NotAllowedError') toast.error('دسترسی اشتراک صفحه رد شد.');
      else if (e?.name === 'NotFoundError') toast.error('صفحه‌ای برای اشتراک‌گذاری یافت نشد.');
      else if (e?.name !== 'AbortError') { console.error('screen share error', e); toast.error('خطا در شروع حالت ارائه'); }
    }
  };

  const stopScreenShare = useCallback(async () => {
    const ss: MediaStream | null = screenStreamRef.current;
    if (!ss) return;
    const screenTrackIds = new Set(ss.getTracks().map(t => t.id));
    screenStreamRef.current = null;
    for (const p of peersRef.current.values()) {
      let changed = false;
      for (const sender of p.pc.getSenders()) {
        if (sender.track && screenTrackIds.has(sender.track.id)) { p.pc.removeTrack(sender); changed = true; }
      }
      if (changed) await renegotiatePeer(p);
    }
    ss.getTracks().forEach(t => t.stop());
    await supabase.rpc('release_conference_presenter', { p_room_id: room.id }).then(({ error }: any) => { if (error) console.error('release presenter error', error); });
    dispatch({ type: 'SET_SCREEN_SHARING', value: false });
    const { isMuted: m, isVideoOff: v, isHandRaised: h } = mediaRef.current;
    sendSignalRef.current(null, 'state', { peerId: myPeerId, isMuted: m, isVideoOff: v, isHandRaised: h, isScreenSharing: false });
  }, [room.id, supabase, myPeerId]);

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
