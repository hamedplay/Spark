import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
} from 'livekit-client';
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
import {
  LIVEKIT_FRESH_TOKEN_RECONNECT_DELAYS_MS,
  liveKitTerminalDisconnectLabel,
  shouldRetryWithFreshLiveKitToken,
} from '../services/conferenceTokenSecurity';
import { useConferenceState } from './useConferenceState';

const ERROR_LABELS: Record<string, string> = {
  ROOM_FULL: 'ظرفیت جلسه تکمیل شده است.',
  ROOM_LOCKED: 'جلسه قفل شده است.',
  NOT_AUTHORIZED: 'اجازه ورود به این جلسه را ندارید.',
  BANNED: 'دسترسی شما به این جلسه مسدود شده است.',
  REJECTED: 'درخواست ورود شما رد شد.',
  REJOIN_BLOCKED: 'پس از حذف توسط مدیر، صدور مجوز اتصال جدید موقتاً متوقف شده است.',
  CONFERENCE_NOT_CONFIGURED: 'زیرساخت ویدیوکنفرانس هنوز پیکربندی نشده است.',
  TOKEN_FAILED: 'دریافت مجوز اتصال ناموفق بود.',
  LIVEKIT_PERMISSION_DENIED: 'مجوز رسانه‌ای جلسه قابل دریافت نیست.',
  RECORDING_CONSENT_REQUIRED: 'این جلسه در حال ضبط است؛ برای اتصال رسانه‌ای ابتدا رضایت ضبط را تأیید کنید.',
};

interface Params {
  roomId: string;
  localStream: MediaStream;
  client: ConferenceSupabaseClient;
}

export function useLiveKitRoom({
  roomId,
  localStream,
  client,
}: Params) {
  const roomRef = useRef<Room | null>(null);
  const connectRef = useRef<(() => Promise<void>) | null>(null);
  const connectingRef = useRef(false);
  const intentionalDisconnectRef = useRef(false);
  const retryOnNetworkRecoveryRef = useRef(false);
  const freshReconnectAttemptRef = useRef(0);
  const freshReconnectTimerRef = useRef<number | null>(null);
  const audioDeviceIdRef = useRef(
    localStream.getAudioTracks()[0]?.getSettings().deviceId,
  );
  const videoDeviceIdRef = useRef(
    localStream.getVideoTracks()[0]?.getSettings().deviceId,
  );

  const {
    uiState,
    setUiState,
    errorMessage,
    setErrorMessage,
    revision,
    role,
    setRole,
    quality,
    setQuality,
    activeSpeakerIdentity,
    setActiveSpeakerIdentity,
    reactions,
    refresh,
    showReaction,
    fail,
  } = useConferenceState();

  const [micEnabled, setMicEnabled] = useState(
    () => localStream.getAudioTracks().some((track) => track.enabled),
  );
  const [cameraEnabled, setCameraEnabled] = useState(
    () => localStream.getVideoTracks().some((track) => track.enabled),
  );
  const [canPublishMic, setCanPublishMic] = useState(true);
  const [canPublishCamera, setCanPublishCamera] = useState(true);
  const [canPublishScreen, setCanPublishScreen] = useState(true);
  const [reactionError, setReactionError] = useState('');
  const [reconnectCount, setReconnectCount] = useState(0);

  const clearFreshReconnectTimer = useCallback(() => {
    if (freshReconnectTimerRef.current !== null) {
      window.clearTimeout(freshReconnectTimerRef.current);
      freshReconnectTimerRef.current = null;
    }
  }, []);

  const scheduleFreshTokenReconnect = useCallback((
    reason?: DisconnectReason,
  ) => {
    if (!shouldRetryWithFreshLiveKitToken(reason)) {
      retryOnNetworkRecoveryRef.current = false;
      clearFreshReconnectTimer();
      fail(liveKitTerminalDisconnectLabel(reason));
      return;
    }

    retryOnNetworkRecoveryRef.current = true;

    if (!navigator.onLine) {
      setUiState('failed');
      setErrorMessage('شبکه در دسترس نیست؛ پس از بازگشت اتصال دوباره تلاش می‌شود.');
      return;
    }

    const attempt = freshReconnectAttemptRef.current;
    if (attempt >= LIVEKIT_FRESH_TOKEN_RECONNECT_DELAYS_MS.length) {
      setUiState('failed');
      setErrorMessage('بازیابی اتصال رسانه‌ای ناموفق بود. برای تلاش دوباره اتصال شبکه را بررسی کنید.');
      return;
    }

    const delay = LIVEKIT_FRESH_TOKEN_RECONNECT_DELAYS_MS[attempt];
    freshReconnectAttemptRef.current = attempt + 1;
    setReconnectCount((current) => current + 1);
    setUiState('reconnecting');
    setErrorMessage('');
    clearFreshReconnectTimer();

    freshReconnectTimerRef.current = window.setTimeout(() => {
      freshReconnectTimerRef.current = null;
      void connectRef.current?.();
    }, delay);
  }, [
    clearFreshReconnectTimer,
    fail,
    setErrorMessage,
    setUiState,
  ]);

  const connect = useCallback(async () => {
    if (connectingRef.current) return;

    connectingRef.current = true;
    clearFreshReconnectTimer();
    setUiState(
      freshReconnectAttemptRef.current > 0
        ? 'reconnecting'
        : 'joining',
    );
    setErrorMessage('');

    try {
      const join = await requestLiveKitToken(roomId, client);

      if (join.status === 'waiting') {
        retryOnNetworkRecoveryRef.current = false;
        freshReconnectAttemptRef.current = 0;
        setUiState('waiting');
        return;
      }

      if (join.status === 'rejected') {
        retryOnNetworkRecoveryRef.current = false;
        freshReconnectAttemptRef.current = 0;

        const key = join.reason.toUpperCase();
        const baseLabel =
          ERROR_LABELS[key] || 'ورود به جلسه ناموفق بود.';
        const label = (
          key === 'REJOIN_BLOCKED'
          && join.retryAfterSeconds
        )
          ? `${baseLabel} حدود ${join.retryAfterSeconds} ثانیه دیگر دوباره تلاش کنید.`
          : baseLabel;

        fail(label);
        return;
      }

      setRole(join.data.role);

      const canPublishMic =
        join.data.livekitPolicy.publishSources.includes('microphone');
      const canPublishCamera =
        join.data.livekitPolicy.publishSources.includes('camera');
      const canPublishScreen =
        join.data.livekitPolicy.publishSources.includes('screen_share');

      setCanPublishMic(canPublishMic);
      setCanPublishCamera(canPublishCamera);
      setCanPublishScreen(canPublishScreen);

      if (!canPublishMic) setMicEnabled(false);
      if (!canPublishCamera) setCameraEnabled(false);

      const mediaSettings = loadConferenceMediaQualitySettings();
      const nextRoom = new Room({
        ...roomMediaOptions(mediaSettings),
        stopLocalTrackOnUnpublish: true,
      });

      intentionalDisconnectRef.current = false;
      roomRef.current = nextRoom;

      // Listeners are installed before connect so no handshake event is missed.
      nextRoom.on(RoomEvent.ParticipantConnected, refresh);
      nextRoom.on(RoomEvent.ParticipantDisconnected, refresh);
      nextRoom.on(RoomEvent.TrackSubscribed, refresh);
      nextRoom.on(RoomEvent.TrackUnsubscribed, refresh);
      nextRoom.on(RoomEvent.TrackMuted, refresh);
      nextRoom.on(RoomEvent.TrackUnmuted, refresh);

      nextRoom.on(
        RoomEvent.ParticipantPermissionsChanged,
        (_previous, participant) => {
          if (
            participant.identity
            !== nextRoom.localParticipant.identity
          ) {
            return;
          }

          const permissions = participant.permissions;
          const sources = permissions?.canPublishSources || [];
          const publishingAllowed =
            permissions?.canPublish !== false;
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
            micAllowed
            && nextRoom.localParticipant.isMicrophoneEnabled,
          );
          setCameraEnabled(
            cameraAllowed
            && nextRoom.localParticipant.isCameraEnabled,
          );
          refresh();
        },
      );

      nextRoom.on(RoomEvent.Reconnecting, () => {
        // LiveKit handles in-session token refresh/resume internally.
        setReconnectCount((current) => current + 1);
        setUiState('reconnecting');
      });

      nextRoom.on(RoomEvent.Reconnected, () => {
        retryOnNetworkRecoveryRef.current = false;
        freshReconnectAttemptRef.current = 0;
        clearFreshReconnectTimer();
        setUiState('connected');
      });

      nextRoom.on(RoomEvent.Disconnected, (reason) => {
        audioDeviceIdRef.current =
          nextRoom.getActiveDevice('audioinput')
          || audioDeviceIdRef.current;
        videoDeviceIdRef.current =
          nextRoom.getActiveDevice('videoinput')
          || videoDeviceIdRef.current;

        if (roomRef.current === nextRoom) {
          roomRef.current = null;
        }

        nextRoom.removeAllListeners();
        refresh();

        if (
          intentionalDisconnectRef.current
          || reason === DisconnectReason.CLIENT_INITIATED
        ) {
          retryOnNetworkRecoveryRef.current = false;
          return;
        }

        scheduleFreshTokenReconnect(reason);
      });

      nextRoom.on(
        RoomEvent.ActiveSpeakersChanged,
        (participants) => {
          setActiveSpeakerIdentity(
            participants[0]?.identity ?? null,
          );
        },
      );

      nextRoom.on(
        RoomEvent.ConnectionQualityChanged,
        (nextQuality, participant) => {
          if (
            participant.identity
            === nextRoom.localParticipant.identity
          ) {
            setQuality(nextQuality);
          }
        },
      );

      nextRoom.on(
        RoomEvent.DataReceived,
        (payload, participant, _kind, topic) => {
          if (topic !== 'spark-reaction') return;

          // Phase 10 accepts only server-originated reaction packets.
          if (participant) return;

          try {
            const value = JSON.parse(
              new TextDecoder().decode(payload),
            ) as Partial<ConferenceReactionEvent>;

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
              avatarUrl:
                typeof value.avatarUrl === 'string'
                  ? value.avatarUrl
                  : null,
              timestamp: value.timestamp,
            });
          } catch {
            // Malformed ephemeral data is intentionally ignored.
          }
        },
      );

      localStream.getTracks().forEach((track) => track.stop());

      await nextRoom.connect(
        join.data.serverUrl,
        join.data.token,
        { autoSubscribe: true },
      );


      if (micEnabled && canPublishMic) {
        await nextRoom.localParticipant.setMicrophoneEnabled(
          true,
          audioDeviceIdRef.current
            ? { deviceId: audioDeviceIdRef.current }
            : undefined,
        );
      }

      if (cameraEnabled && canPublishCamera) {
        await setConferenceCamera(
          nextRoom,
          true,
          videoDeviceIdRef.current,
        );
      }

      retryOnNetworkRecoveryRef.current = false;
      freshReconnectAttemptRef.current = 0;
      clearFreshReconnectTimer();
      setUiState('connected');
      refresh();
    } catch (error) {
      console.error(
        '[VideoConference][LiveKit] connect failed',
        error,
      );

      const failedRoom = roomRef.current;
      roomRef.current = null;
      failedRoom?.removeAllListeners();
      if (failedRoom) {
        void failedRoom.disconnect();
      }

      if (freshReconnectAttemptRef.current > 0) {
        scheduleFreshTokenReconnect(
          DisconnectReason.JOIN_FAILURE,
        );
      } else {
        retryOnNetworkRecoveryRef.current = true;
        fail(
          'اتصال رسانه‌ای برقرار نشد. تنظیمات LiveKit/TURN و شبکه را بررسی کنید.',
        );
      }
    } finally {
      connectingRef.current = false;
    }
  }, [
    cameraEnabled,
    canPublishCamera,
    canPublishMic,
    clearFreshReconnectTimer,
    client,
    fail,
    localStream,
    micEnabled,
    refresh,
    roomId,
    scheduleFreshTokenReconnect,
    setActiveSpeakerIdentity,
    setCameraEnabled,
    setErrorMessage,
    setMicEnabled,
    setQuality,
    setRole,
    setUiState,
    showReaction,
  ]);

  connectRef.current = connect;

  useEffect(() => {
    void connect();

    return () => {
      intentionalDisconnectRef.current = true;
      retryOnNetworkRecoveryRef.current = false;
      clearFreshReconnectTimer();

      const current = roomRef.current;
      roomRef.current = null;
      current?.removeAllListeners();
      if (current) {
        void current.disconnect();
      }

      localStream.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    const retryIfRecoverable = () => {
      if (
        retryOnNetworkRecoveryRef.current
        && uiState === 'failed'
        && !roomRef.current
      ) {
        freshReconnectAttemptRef.current = 0;
        void connectRef.current?.();
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState !== 'visible') return;

      if (roomRef.current && uiState === 'reconnecting') {
        refresh();
        return;
      }

      retryIfRecoverable();
    };

    window.addEventListener('online', retryIfRecoverable);
    document.addEventListener(
      'visibilitychange',
      handleVisibility,
    );

    return () => {
      window.removeEventListener('online', retryIfRecoverable);
      document.removeEventListener(
        'visibilitychange',
        handleVisibility,
      );
    };
  }, [refresh, uiState]);

  const toggleMic = useCallback(async () => {
    const current = roomRef.current;
    if (!current) return;

    const next = !micEnabled;
    try {
      await setConferenceMicrophone(current, next);
      setMicEnabled(next);
    } catch (error) {
      console.error(
        '[VideoConference] microphone toggle failed',
        error,
      );
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
      console.error(
        '[VideoConference] camera toggle failed',
        error,
      );
    }
  }, [cameraEnabled]);

  const sendReaction = useCallback(async (reaction: string) => {
    if (!roomRef.current) return;

    setReactionError('');
    try {
      const event = await publishConferenceReaction(client, roomId, reaction);
      showReaction(event);
    } catch (error) {
      console.error(
        '[VideoConference] reaction send failed',
        error,
      );

      if (
        error instanceof ConferenceReactionError
        && error.code === 'RATE_LIMITED'
      ) {
        const seconds = Math.max(
          1,
          Math.ceil(error.retryAfterMs / 1000),
        );
        setReactionError(
          `واکنش‌ها خیلی سریع ارسال شده‌اند؛ حدود ${seconds} ثانیه دیگر تلاش کنید.`,
        );
      } else if (
        error instanceof ConferenceReactionError
        && error.code === 'REACTIONS_DISABLED'
      ) {
        setReactionError(
          'واکنش‌ها در این جلسه غیرفعال هستند.',
        );
      } else {
        setReactionError('ارسال واکنش انجام نشد.');
      }

      window.setTimeout(
        () => setReactionError(''),
        3000,
      );
    }
  }, [client, roomId, showReaction]);

  const disconnect = useCallback(() => {
    intentionalDisconnectRef.current = true;
    retryOnNetworkRecoveryRef.current = false;
    freshReconnectAttemptRef.current = 0;
    clearFreshReconnectTimer();

    const current = roomRef.current;
    roomRef.current = null;
    current?.removeAllListeners();
    if (current) {
      void current.disconnect();
    }
  }, [clearFreshReconnectTimer]);

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
