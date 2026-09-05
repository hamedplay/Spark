import { useCallback, useEffect, useState } from 'react';
import { LayoutGrid, Rows3, Wifi } from 'lucide-react';
import { useConferenceClient } from '../../../../components/VideoConference/conferenceClient';
import { useConferenceAuthorization } from '../../hooks/useConferenceAuthorization';
import { useConferenceMediaQuality } from '../../hooks/useConferenceMediaQuality';
import { useConferenceRecordingConsent } from '../../hooks/useConferenceRecordingConsent';
import { useConferencePhase } from '../../hooks/useConferencePhase';
import { useConferenceSpeakerTimer } from '../../hooks/useConferenceSpeakerTimer';
import { useConferenceSpotlights } from '../../hooks/useConferenceSpotlights';
import { useLiveKitRoom } from '../../hooks/useLiveKitRoom';
import { useNetworkDiagnostics } from '../../hooks/useNetworkDiagnostics';
import { useNetworkQuality } from '../../hooks/useNetworkQuality';
import { useParticipants } from '../../hooks/useParticipants';
import { useScreenShare } from '../../hooks/useScreenShare';
import { useWaitingRoom } from '../../hooks/useWaitingRoom';
import { runHostAction } from '../../services/conferenceApi';
import type {
  ConferenceLayoutMode,
  ConferenceRoomShape,
} from '../../types/conference.types';
import { hasConferencePermission } from '../../utils/conferencePermissions';
import { LiveKitConferenceTools } from '../LiveKitConferenceTools';
import { ParticipantGrid } from '../participants/ParticipantGrid';
import { ReactionOverlay } from '../reactions/ReactionOverlay';
import { RoomMediaControls } from '../controls/RoomMediaControls';
import { WaitingRoomList } from '../waiting-room/WaitingRoomList';
import { ConferenceRoomStatus } from './ConferenceRoomStatus';
import { MeetingPhaseOverlay } from './MeetingPhaseOverlay';
import { SpeakerTimerBanner } from './SpeakerTimerBanner';
import { RecordingConsentBanner } from '../recording/RecordingConsentBanner';

interface Props {
  room: ConferenceRoomShape;
  currentUserId: string;
  currentUserName: string;
  localStream: MediaStream;
  onLeave: () => void;
}

export function ConferenceRoomPage({ room: sparkRoom, currentUserId, currentUserName, localStream, onLeave }: Props) {
  const conferenceClient = useConferenceClient();
  const livekit = useLiveKitRoom({ roomId: sparkRoom.id, localStream, client: conferenceClient });
  const { authorization } = useConferenceAuthorization({
    client: conferenceClient,
    roomId: sparkRoom.id,
    currentUserId,
  });
  const phase = useConferencePhase({
    client: conferenceClient,
    roomId: sparkRoom.id,
    currentUserId,
  });
  const speakerTimer = useConferenceSpeakerTimer({
    client: conferenceClient,
    roomId: sparkRoom.id,
    currentUserId,
  });

  const canManageWaitingRoom = hasConferencePermission(authorization, 'MANAGE_WAITING_ROOM');
  const canEndMeeting = hasConferencePermission(authorization, 'END_MEETING');
  const handleAdmitted = useCallback(() => { void livekit.connect(); }, [livekit.connect]);
  const handleRejected = useCallback(
    () => livekit.fail('درخواست ورود شما توسط میزبان رد شد.'),
    [livekit.fail],
  );
  const handleExpired = useCallback(
    () => livekit.fail('درخواست ورود منقضی شد. برای ارسال درخواست جدید دوباره تلاش کنید.'),
    [livekit.fail],
  );
  const waiting = useWaitingRoom({
    client: conferenceClient,
    roomId: sparkRoom.id,
    currentUserId,
    isManager: canManageWaitingRoom,
    uiState: livekit.uiState,
    onAdmitted: handleAdmitted,
    onRejected: handleRejected,
    onExpired: handleExpired,
  });
  const spotlight = useConferenceSpotlights({
    client: conferenceClient,
    roomId: sparkRoom.id,
    currentUserId,
    authorization,
  });
  const { participants, screenSharer } = useParticipants(
    livekit.room,
    livekit.revision,
  );
  const [pinnedIdentity, setPinnedIdentity] = useState<string | null>(null);
  const [layoutMode, setLayoutMode] =
    useState<ConferenceLayoutMode>('grid');
  const [speakerMuted, setSpeakerMuted] = useState(false);
  const screenShareIdentity = screenSharer?.identity ?? null;
  const spotlightFocusIdentity =
    spotlight.spotlightedUserIds[0] || null;
  const focusIdentity =
    screenShareIdentity
    || spotlightFocusIdentity
    || pinnedIdentity
    || livekit.activeSpeakerIdentity;
  const mediaQuality = useConferenceMediaQuality(
    livekit.room,
    livekit.revision,
    focusIdentity,
  );
  const screen = useScreenShare(livekit.room);
  const recordingConsent = useConferenceRecordingConsent(
    conferenceClient,
    sparkRoom.id,
  );
  const networkLabel = useNetworkQuality(livekit.uiState, livekit.quality);
  const networkDiagnostics = useNetworkDiagnostics(
    livekit.room,
    livekit.uiState,
    livekit.quality,
    livekit.reconnectCount,
    livekit.revision,
  );

  useEffect(() => {
    if (
      pinnedIdentity
      && !participants.some((participant) => participant.identity === pinnedIdentity)
    ) {
      setPinnedIdentity(null);
    }
  }, [participants, pinnedIdentity]);

  const leave = async () => {
    livekit.disconnect();
    try {
      await conferenceClient.rpc('leave_conference_room', { p_room_id: sparkRoom.id });
    } catch {
      // خروج کاربر نباید وضعیت اتاق را ended کند؛ جلسه برای سایر افراد ادامه دارد.
    }
    onLeave();
  };

  const endForAll = async () => {
    if (!canEndMeeting) return;
    await runHostAction(sparkRoom.id, 'end', undefined, conferenceClient);
    livekit.disconnect();
    onLeave();
  };

  if (livekit.uiState === 'joining') return <ConferenceRoomStatus state="joining" onLeave={onLeave} />;
  if (livekit.uiState === 'waiting') return <ConferenceRoomStatus state="waiting" onLeave={onLeave} />;
  if (livekit.uiState === 'failed') {
    return <ConferenceRoomStatus state="failed" errorMessage={livekit.errorMessage} onRetry={() => void livekit.connect()} onLeave={onLeave} />;
  }

  const visibleParticipants = (
    screenShareIdentity
    || spotlight.spotlightedUserIds.length > 0
    || layoutMode === 'speaker'
      ? participants.slice(0, 20)
      : participants.slice(0, window.innerWidth < 768 ? 4 : 20)
  );

  return (
    <div className="relative flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-slate-950 text-white" dir="rtl" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-3 sm:px-5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold sm:text-base">
            {sparkRoom.name}
          </h1>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
            <Wifi className="h-3.5 w-3.5" />
            {networkLabel} · {participants.length}/{sparkRoom.max_participants ?? 20}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <RecordingConsentBanner consent={recordingConsent} />

          {!screenShareIdentity && (
            <div className="flex items-center gap-1 rounded-xl bg-slate-900 p-1">
              <button
                type="button"
                onClick={() => setLayoutMode('grid')}
                aria-label="نمای شبکه‌ای"
                aria-pressed={layoutMode === 'grid'}
                className={
                  "flex h-9 w-9 items-center justify-center rounded-lg "
                  + (layoutMode === 'grid'
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:bg-white/5")
                }
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setLayoutMode('speaker')}
                aria-label="نمای سخنران"
                aria-pressed={layoutMode === 'speaker'}
                className={
                  "flex h-9 w-9 items-center justify-center rounded-lg "
                  + (layoutMode === 'speaker'
                    ? "bg-slate-700 text-white"
                    : "text-slate-400 hover:bg-white/5")
                }
              >
                <Rows3 className="h-4 w-4" />
              </button>
            </div>
          )}

          {waiting.waitingRows.length > 0 && (
            <span className="rounded-full bg-amber-400 px-2 py-1 text-xs font-bold text-slate-950">
              {waiting.waitingRows.length} در انتظار
            </span>
          )}
        </div>
      </header>

      {waiting.waitingRows.length > 0 && canManageWaitingRoom && (
        <WaitingRoomList
          roomId={sparkRoom.id}
          rows={waiting.waitingRows}
          onChanged={waiting.refreshWaitingRows}
        />
      )}

      {!phase.mediaHidden && (
        <ParticipantGrid
          participants={visibleParticipants}
          localIdentity={livekit.room?.localParticipant.identity}
          activeSpeakerIdentity={livekit.activeSpeakerIdentity}
          pinnedIdentity={pinnedIdentity}
          screenShareIdentity={screenShareIdentity}
          spotlightIdentities={spotlight.spotlightedUserIds}
          layoutMode={layoutMode}
          speakerMuted={speakerMuted}
          onPinnedIdentityChange={setPinnedIdentity}
        />
      )}
      {!phase.mediaHidden && <ReactionOverlay reactions={livekit.reactions} />}
      <SpeakerTimerBanner session={speakerTimer.ownSession} remainingSeconds={speakerTimer.ownRemainingSeconds} />
      <MeetingPhaseOverlay
        phase={phase.currentPhase}
        remainingSeconds={phase.remainingSeconds}
      />

      {livekit.room && (
        <LiveKitConferenceTools
          room={livekit.room}
          roomId={sparkRoom.id}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          authorization={authorization}
          phase={phase}
          speakerTimer={speakerTimer}
          mediaQuality={mediaQuality}
          networkDiagnostics={networkDiagnostics}
          recordingConsent={recordingConsent}
          spotlight={spotlight}
          onEnded={() => void leave()}
        />
      )}

      <RoomMediaControls
        micEnabled={livekit.micEnabled}
        cameraEnabled={livekit.cameraEnabled}
        screenEnabled={screen.screenEnabled}
        speakerMuted={speakerMuted}
        allowMicrophone={
          livekit.canPublishMic
          && phase.allowMic
          && hasConferencePermission(authorization, 'PUBLISH_MIC')
          && !speakerTimer.microphoneBlocked
        }
        allowCamera={
          livekit.canPublishCamera
          && phase.allowCamera
          && hasConferencePermission(authorization, 'PUBLISH_CAMERA')
        }
        allowScreenShare={
          livekit.canPublishScreen
          && hasConferencePermission(authorization, 'PUBLISH_SCREEN')
          && sparkRoom.allow_screen_share !== false
          && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
        }
        allowReactions={sparkRoom.allow_reactions !== false}
        reactionError={livekit.reactionError}
        canEndMeeting={canEndMeeting}
        onToggleMic={() => void livekit.toggleMic()}
        onToggleCamera={() => void livekit.toggleCamera()}
        onToggleScreen={() => void screen.toggleScreen()}
        onToggleSpeaker={() => setSpeakerMuted((current) => !current)}
        onReaction={(reaction) => void livekit.sendReaction(reaction)}
        onLeave={() => void leave()}
        onEndMeeting={() => void endForAll()}
      />
    </div>
  );
}