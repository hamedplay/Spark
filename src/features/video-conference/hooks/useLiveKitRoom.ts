import { useCallback, useEffect, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { ConferenceSupabaseClient } from '../../../components/VideoConference/conferenceClient';
import { requestLiveKitToken } from '../services/conferenceApi';
import {
  ConferenceReactionError,
  publishConferenceReaction,
  setConferenceCamera,
  setConferenceMicrophone,
} from '../services/conferenceMedia';
import type { ConferenceReactionEvent } from '../types/conference.types';
import {
  loadConferenceMediaQualitySettings,
  roomMediaOptions,
} from '../services/conferenceMediaQuality';
import { useConferenceState } from './useConferenceState';

const ERROR_LABELS: Record<string, string> = {
  ROOM_FULL: 'ظرفیت جلسه تکمیل شده است.',
  ROOM_LOCKED: 'جلسه قفل شده است.',
  NOT_AUTHORIZED: 'اجازه ورود به این جلسه را ندارید.',
  BANNED: 'دسترسی شما به این جلسه مسدود شده است.',
  REJECTED: 'درخواست ورود شما رد شد.',
  CONFERENCE_NOT_CONFIGURED: 'زیرساخت ویدیوکنفرانس هنوز پیکربندی نشده است.',
  TOKEN_FAILED: 'دریافت مجوز اتصال ناموفق بود.',
  LIVEKIT_PERMISSION_DENIED: 'مجوز رسانه‌ای جلسه قابل دریافت نیست.',
  RECORDING_CONSENT_REQUIRED: 'این جلسه در حال ضبط است؛ برای اتصال رسانه‌ای ابتدا رضایت ضبط را تأیید کنید.',
};

interface Params {
  roomId: string;
  currentUserName: string;
  localStream: MediaStream;
  client: ConferenceSupabaseClient;
}

export function useLiveKitRoom({ roomId, currentUserName, localStream, client }: Params) {
  const roomRef = useRef<Room | null>(null);
  const connectingRef = useRef(false);
  const {
    uiState, setUiState, errorMessage, setErrorMessage, revision, role, setRole, quality, setQuality,
    activeSpeakerIdentity, setActiveSpeakerIdentity, reactions, refresh, showReaction, fail,
  } = useConferenceState();
  const [micEnabled, setMicEnabled] = useState(() => localStream.getAudioTracks().some((track) => track.enabled));
  const [cameraEnabled, setCameraEnabled] = useState(() => localStream.getVideoTracks().some((track) => track.enabled));
  const [canPublishMic, setCanPublishMic] = useState(true);
  const [canPublishCamera, setCanPublishCamera] = useState(true);
  const [canPublishScreen, setCanPublishScreen] = useState(true);
  const [reactionError, setReactionError] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);

  const connect = useCallback(async () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setUiState('joining');
    setErrorMessage('');

    try {
      const join = await requestLiveKitToken(roomId, client);
      if (join.status === 'waiting') {
        setUiState('waiting');
        return;
      }
      if (join.status === 'rejected') {
        fail(ERROR_LABELS[join.reason.toUpperCase()] || 'ورود به جلسه ناموفق بود.');
        return;
      }

      setRole(join.data.role);
      const tokenCanPublishMic =
        join.data.livekitPolicy.publishSources.includes('microphone');
      const tokenCanPublishCamera =
        join.data.livekitPolicy.publishSources.includes('camera');
      const tokenCanPublishScreen =
        join.data.livekitPolicy.publishSources.includes('screen_share');

      setCanPublishMic(tokenCanPublishMic);
      setCanPublishCamera(tokenCanPublishCamera);
      setCanPublishScreen(tokenCanPublishScreen);

      if (!tokenCanPublishMic) setMicEnabled(false);
      if (!tokenCanPublishCamera) setCameraEnabled(false);

      const mediaSettings = loadConferenceMediaQualitySettings();
      const nextRoom = new Room({
        ...roomMediaOptions(mediaSettings),
        stopLocalTrackOnUnpublish: true,
      });
      roomRef.current = nextRoom;

      // Preserve the original ordering: listeners are installed before connect so
      // participant/track events emitted during the handshake are not missed.
      nextRoom.on(RoomEvent.ParticipantConnected, refresh);
      nextRoom.on(RoomEvent.ParticipantDisconnected, refresh);
      nextRoom.on(RoomEvent.TrackSubscribed, refresh);
      nextRoom.on(RoomEvent.TrackUnsubscribed, refresh);
      nextRoom.on(RoomEvent.TrackMuted, refresh);
      nextRoom.on(RoomEvent.TrackUnmuted, refresh);
      nextRoom.on(
        RoomEvent.ParticipantPermissionsChanged,
        (_previous, participant) => {
          if (participant.identity !== nextRoom.localParticipant.identity) {
            return;
          }

          const permissions = participant.permissions;
          const sources = permissions?.canPublishSources || [];
          const publishingAllowed = permissions?.canPublish !== false;
          const micAllowed = (
            publishingAllowed
            && sources.includes(Track.Source.Microphone)
          );
          const cameraAllowed = (
            publishingAllowed
            && sources.includes(Track.Source.Camera)
          );
          const screenAllowed = (
            publishingAllowed
            && sources.includes(Track.Source.ScreenShare)
          );

          setCanPublishMic(micAllowed);
          setCanPublishCamera(cameraAllowed);
          setCanPublishScreen(screenAllowed);
          setMicEnabled(
            micAllowed && nextRoom.localParticipant.isMicrophoneEnabled,
          );
          setCameraEnabled(
            cameraAllowed && nextRoom.localParticipant.isCameraEnabled,
          );
          refresh();
        },
      );
      nextRoom.on(RoomEvent.Reconnecting, () => {
        setReconnectCount((current) => current + 1);
        setUiState('reconnecting');
      });
      nextRoom.on(RoomEvent.Reconnected, () => setUiState('connected'));
      nextRoom.on(RoomEvent.Disconnected, () => setUiState((current) => current === 'failed' ? current : 'failed'));
      nextRoom.on(RoomEvent.ActiveSpeakersChanged, (participants) => {
        setActiveSpeakerIdentity(participants[0]?.identity ?? null);
      });
      nextRoom.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
        if (participant.identity === nextRoom.localParticipant.identity) setQuality(quality);
      });
      nextRoom.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
        if (topic !== 'spark-reaction') return;

        // Phase 10 accepts only server-originated reaction packets. Participant-
        // originated packets on this topic are ignored so browser publishData
        // cannot bypass server authorization or rate limiting.
        if (participant) return;

        try {
          const value = JSON.parse(new TextDecoder().decode(payload)) as Partial<ConferenceReactionEvent>;
          if (
            typeof value.id !== 'string'
            || typeof value.reaction !== 'string'
            || typeof value.participantIdentity !== 'string'
            || typeof value.displayName !== 'string'
            || typeof value.timestamp !== 'string'
          ) return;

          showReaction({
            id: value.id,
            reaction: value.reaction,
            participantIdentity: value.participantIdentity,
            displayName: value.displayName,
            avatarUrl: typeof value.avatarUrl === 'string' ? value.avatarUrl : null,
            timestamp: value.timestamp,
          });
        } catch {
          // Malformed ephemeral data is intentionally ignored.
        }
      });

      const audioSettings = localStream.getAudioTracks()[0]?.getSettings();
      const videoSettings = localStream.getVideoTracks()[0]?.getSettings();
      localStream.getTracks().forEach((track) => track.stop());

      await nextRoom.connect(join.data.serverUrl, join.data.token, { autoSubscribe: true });
      nextRoom.localParticipant.setName(currentUserName);

      if (micEnabled && tokenCanPublishMic) {
        await nextRoom.localParticipant.setMicrophoneEnabled(
          true,
          audioSettings?.deviceId ? { deviceId: audioSettings.deviceId } : undefined,
        );
      }
      if (cameraEnabled && tokenCanPublishCamera) {
        await setConferenceCamera(
          nextRoom,
          true,
          videoSettings?.deviceId,
        );
      }
      setUiState('connected');
      refresh();
    } catch (error) {
      console.error('[VideoConference][LiveKit] connect failed', error);
      fail('اتصال رسانه‌ای برقرار نشد. تنظیمات LiveKit/TURN و شبکه را بررسی کنید.');
    } finally {
      connectingRef.current = false;
    }
  }, [cameraEnabled, client, currentUserName, fail, localStream, micEnabled, refresh, roomId, setActiveSpeakerIdentity, setCameraEnabled, setErrorMessage, setMicEnabled, setQuality, setRole, setUiState, showReaction]);

  useEffect(() => {
    void connect();
    return () => {
      const current = roomRef.current;
      roomRef.current = null;
      current?.removeAllListeners();
      current?.disconnect();
      localStream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && roomRef.current && uiState === 'reconnecting') refresh();
    };
    const handleOnline = () => {
      if (uiState === 'failed' && !roomRef.current) void connect();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('online', handleOnline);
    };
  }, [connect, refresh, uiState]);

  const toggleMic = useCallback(async () => {
    const current = roomRef.current;
    if (!current) return;
    const next = !micEnabled;
    try {
      await setConferenceMicrophone(current, next);
      setMicEnabled(next);
    } catch (error) {
      console.error('[VideoConference] microphone toggle failed', error);
    }
  }, [micEnabled]);

  const toggleCamera = useCallback(async () => {
    const current = roomRef.current;
    if (!current) return;
    const next = !cameraEnabled;
    try {
      await setConferenceCamera(current, next);
      setCameraEnabled(next);
    } catch (error) {
      console.error('[VideoConference] camera toggle failed', error);
    }
  }, [cameraEnabled]);

  const sendReaction = useCallback(async (reaction: string) => {
    if (!roomRef.current) return;

    setReactionError('');
    try {
      const event = await publishConferenceReaction(client, roomId, reaction);
      showReaction(event);
    } catch (error) {
      console.error('[VideoConference] reaction send failed', error);
      if (error instanceof ConferenceReactionError && error.code === 'RATE_LIMITED') {
        const seconds = Math.max(1, Math.ceil(error.retryAfterMs / 1000));
        setReactionError(`واکنش‌ها خیلی سریع ارسال شده‌اند؛ حدود ${seconds} ثانیه دیگر تلاش کنید.`);
      } else if (error instanceof ConferenceReactionError && error.code === 'REACTIONS_DISABLED') {
        setReactionError('واکنش‌ها در این جلسه غیرفعال هستند.');
      } else {
        setReactionError('ارسال واکنش انجام نشد.');
      }

      window.setTimeout(() => setReactionError(''), 3000);
    }
  }, [client, roomId, showReaction]);

  const disconnect = useCallback(() => {
    const current = roomRef.current;
    roomRef.current = null;
    current?.removeAllListeners();
    current?.disconnect();
  }, []);

  return {
    room: roomRef.current,
    connect,
    disconnect,
    micEnabled,
    cameraEnabled,
    canPublishMic,
    canPublishCamera,
    canPublishScreen,
    toggleMic,
    toggleCamera,
    sendReaction,
    uiState,
    errorMessage,
    revision,
    role,
    quality,
    activeSpeakerIdentity,
    reactions,
    reactionError,
    reconnectCount,
    fail,
  };
}
