import { useEffect, useRef, type Dispatch, type MutableRefObject } from 'react';
import toast from 'react-hot-toast';
import type { PeerConnection } from '../types';
import type { VideoQuality } from '../SettingsPanel';
import type { MediaState } from './mediaReducer';
import type { useConferenceClient } from '../conferenceClient';

type ConferenceClient = ReturnType<typeof useConferenceClient>;
type MediaAction =
  | { type: 'FORCE_MUTE' }
  | { type: 'TOGGLE_MUTE' }
  | { type: 'TOGGLE_VIDEO' }
  | { type: 'TOGGLE_HAND' }
  | { type: 'SET_HAND'; value: boolean }
  | { type: 'SET_SCREEN_SHARING'; value: boolean }
  | { type: 'SET_SPEAKER_MUTED'; value: boolean };

interface TelemetryContext {
  supabase: ConferenceClient;
  roomId: string;
  expiresAt: string | null | undefined;
  currentUserId: string;
  localStream: MediaStream;
  peers: Map<string, PeerConnection>;
  peersRef: MutableRefObject<Map<string, PeerConnection>>;
  fetchedAvatarUserIds: MutableRefObject<Set<string>>;
  mediaRef: MutableRefObject<MediaState>;
  myLimitSecsRef: MutableRefObject<number>;
  speakingLimitEnabledRef: MutableRefObject<boolean>;
  adaptiveQualityRef: MutableRefObject<VideoQuality>;
  videoQualityRef: MutableRefObject<VideoQuality>;
  dataSaverModeRef: MutableRefObject<boolean>;
  applyVideoConstraintsRef: MutableRefObject<(quality: VideoQuality, dataSaver: boolean) => Promise<void>>;
  broadcastStateRef: MutableRefObject<(muted: boolean, videoOff: boolean, handRaised: boolean) => void>;
  dispatch: Dispatch<MediaAction>;
  setDuration: Dispatch<React.SetStateAction<number>>;
  setSecondsLeft: Dispatch<React.SetStateAction<number | null>>;
  setSpeakingSecs: Dispatch<React.SetStateAction<number>>;
  setPeerAvatarUrls: Dispatch<React.SetStateAction<Record<string, string>>>;
  setPeerLatencies: Dispatch<React.SetStateAction<Record<string, number>>>;
  setPeers: Dispatch<React.SetStateAction<Map<string, PeerConnection>>>;
  setMyQuality: Dispatch<React.SetStateAction<PeerConnection['networkQuality']>>;
  setAdaptiveQuality: Dispatch<React.SetStateAction<VideoQuality>>;
}

export function useConferenceRoomTelemetry({
  supabase,
  roomId,
  expiresAt,
  currentUserId,
  localStream,
  peers,
  peersRef,
  fetchedAvatarUserIds,
  mediaRef,
  myLimitSecsRef,
  speakingLimitEnabledRef,
  adaptiveQualityRef,
  videoQualityRef,
  dataSaverModeRef,
  applyVideoConstraintsRef,
  broadcastStateRef,
  dispatch,
  setDuration,
  setSecondsLeft,
  setSpeakingSecs,
  setPeerAvatarUrls,
  setPeerLatencies,
  setPeers,
  setMyQuality,
  setAdaptiveQuality,
}: TelemetryContext) {
  const warned5MinRef = useRef(false);
  const speakingSecsRef = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setDuration(value => value + 1);
      if (!expiresAt) return;
      const left = Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000);
      setSecondsLeft(left);
      if (!warned5MinRef.current && left > 0 && left <= 300) {
        warned5MinRef.current = true;
        toast('۵ دقیقه تا پایان جلسه باقی مانده', { icon: '⏰', duration: 6000 });
      }
      if (left <= 0 && left > -3) toast.error('زمان جلسه به پایان رسید', { duration: 6000 });
    }, 1000);
    return () => clearInterval(timer);
  }, [expiresAt, setDuration, setSecondsLeft]);

  useEffect(() => {
    const timer = setInterval(async () => {
      await supabase.from('conference_participants')
        .update({ last_seen: new Date().toISOString() })
        .eq('room_id', roomId)
        .eq('user_id', currentUserId)
        .eq('status', 'joined');
    }, 15000);
    return () => clearInterval(timer);
  }, [supabase, roomId, currentUserId]);

  useEffect(() => {
    if (!localStream.getAudioTracks().length) return;
    let context: AudioContext;
    try { context = new AudioContext(); } catch { return; }
    const source = context.createMediaStreamSource(localStream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.8;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const interval = 500;
    const threshold = 0.04;
    const timer = setInterval(() => {
      if (mediaRef.current.isMuted) {
        speakingSecsRef.current = 0;
        setSpeakingSecs(0);
        return;
      }
      analyser.getByteFrequencyData(data);
      const average = data.reduce((a, b) => a + b, 0) / (data.length * 255);
      if (average > threshold) {
        speakingSecsRef.current += interval / 1000;
        setSpeakingSecs(Math.floor(speakingSecsRef.current));
        if (speakingLimitEnabledRef.current && speakingSecsRef.current >= myLimitSecsRef.current) {
          localStream.getAudioTracks().forEach(track => { track.enabled = false; });
          dispatch({ type: 'FORCE_MUTE' });
          broadcastStateRef.current(true, mediaRef.current.isVideoOff, mediaRef.current.isHandRaised);
          toast.error('زمان صحبت شما تمام شد — میکروفون قطع شد', { duration: 5000, icon: '🎙️' });
          speakingSecsRef.current = 0;
          setSpeakingSecs(0);
        }
      } else {
        speakingSecsRef.current = 0;
        setSpeakingSecs(0);
      }
    }, interval);
    return () => { clearInterval(timer); context.close().catch(() => {}); };
  }, [localStream, mediaRef, myLimitSecsRef, speakingLimitEnabledRef, broadcastStateRef, dispatch, setSpeakingSecs]);

  useEffect(() => {
    const toFetch = [currentUserId, ...Array.from(peers.values()).map(peer => peer.userId)]
      .filter(userId => !fetchedAvatarUserIds.current.has(userId));
    if (!toFetch.length) return;
    toFetch.forEach(userId => fetchedAvatarUserIds.current.add(userId));
    supabase.from('profiles_public').select('user_id, avatar_url').in('user_id', toFetch)
      .then(({ data }) => {
        if (!data?.length) return;
        const map: Record<string, string> = {};
        data.forEach(profile => { if (profile.avatar_url) map[profile.user_id] = profile.avatar_url; });
        if (Object.keys(map).length) setPeerAvatarUrls(previous => ({ ...previous, ...map }));
      }).catch(() => {});
  }, [supabase, peers, currentUserId, fetchedAvatarUserIds, setPeerAvatarUrls]);

  useEffect(() => {
    const timer = setInterval(async () => {
      const latencies: Record<string, number> = {};
      for (const [peerId, peer] of peersRef.current) {
        try {
          const stats = await peer.pc.getStats();
          stats.forEach(report => {
            if (report.type === 'candidate-pair' && report.state === 'succeeded' && typeof report.currentRoundTripTime === 'number') {
              latencies[peerId] = Math.round(report.currentRoundTripTime * 1000);
            }
          });
          const rtt = latencies[peerId];
          if (rtt !== undefined && peersRef.current.has(peerId)) {
            peersRef.current.get(peerId)!.networkQuality = rtt < 100 ? 'excellent' : rtt < 200 ? 'good' : rtt < 400 ? 'fair' : 'poor';
          }
        } catch {}
      }
      if (!Object.keys(latencies).length) return;
      setPeerLatencies(latencies);
      setPeers(new Map(peersRef.current));
      const values = Object.values(latencies);
      if (values.length) {
        const average = values.reduce((a, b) => a + b, 0) / values.length;
        setMyQuality(average < 100 ? 'excellent' : average < 200 ? 'good' : average < 400 ? 'fair' : 'poor');
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [peersRef, setPeerLatencies, setPeers, setMyQuality]);

  useEffect(() => {
    const qualities: VideoQuality[] = ['low', 'medium', 'high'];
    const timer = setInterval(async () => {
      for (const peer of peersRef.current.values()) {
        const sender = peer.pc.getSenders().find(item => item.track?.kind === 'video');
        if (!sender) continue;
        try {
          const stats = await sender.getStats();
          let sent = 0;
          let retransmitted = 0;
          stats.forEach(report => {
            if (report.type === 'outbound-rtp' && report.kind === 'video') {
              sent = report.packetsSent || 0;
              retransmitted = report.retransmittedPacketsSent || 0;
            }
          });
          if (sent < 10) continue;
          const lossRate = retransmitted / sent;
          const currentQuality = adaptiveQualityRef.current;
          const currentIndex = qualities.indexOf(currentQuality);
          if (lossRate > 0.05 && currentIndex > 0) {
            const downgraded = qualities[currentIndex - 1];
            setAdaptiveQuality(downgraded);
            void applyVideoConstraintsRef.current(downgraded, dataSaverModeRef.current);
            toast('کیفیت به دلیل ضعف شبکه کاهش یافت', { icon: '📉', duration: 4000 });
            break;
          }
          if (lossRate < 0.01 && currentIndex < qualities.indexOf(videoQualityRef.current)) {
            const upgraded = qualities[currentIndex + 1];
            setAdaptiveQuality(upgraded);
            void applyVideoConstraintsRef.current(upgraded, dataSaverModeRef.current);
            toast('کیفیت ویدیو بهبود یافت', { icon: '📈', duration: 3000 });
            break;
          }
        } catch {}
      }
    }, 4000);
    return () => clearInterval(timer);
  }, [peersRef, adaptiveQualityRef, videoQualityRef, dataSaverModeRef, applyVideoConstraintsRef, setAdaptiveQuality]);

  return { speakingSecsRef };
}
