import { useCallback } from 'react';
import { Wifi } from 'lucide-react';
import { useConferenceClient } from '../../../../components/VideoConference/conferenceClient';
import { useLiveKitRoom } from '../../hooks/useLiveKitRoom';
import { useNetworkQuality } from '../../hooks/useNetworkQuality';
import { useParticipants } from '../../hooks/useParticipants';
import { useScreenShare } from '../../hooks/useScreenShare';
import { useWaitingRoom } from '../../hooks/useWaitingRoom';
import type { ConferenceRoomShape } from '../../types/conference.types';
import { LiveKitConferenceTools } from '../LiveKitConferenceTools';
import { ParticipantGrid } from '../participants/ParticipantGrid';
import { ReactionOverlay } from '../reactions/ReactionOverlay';
import { RoomMediaControls } from '../controls/RoomMediaControls';
import { WaitingRoomList } from '../waiting-room/WaitingRoomList';
import { ConferenceRoomStatus } from './ConferenceRoomStatus';

interface Props {
  room: ConferenceRoomShape;
  currentUserId: string;
  currentUserName: string;
  localStream: MediaStream;
  onLeave: () => void;
}

export function ConferenceRoomPage({ room: sparkRoom, currentUserId, currentUserName, localStream, onLeave }: Props) {
  const conferenceClient = useConferenceClient();
  const livekit = useLiveKitRoom({ roomId: sparkRoom.id, currentUserName, localStream, client: conferenceClient });
  const isManager = livekit.role === 'host' || livekit.role === 'admin' || livekit.role === 'moderator';
  const handleAdmitted = useCallback(() => { void livekit.connect(); }, [livekit.connect]);
  const handleRejected = useCallback(() => livekit.fail('درخواست ورود شما توسط میزبان رد شد.'), [livekit.fail]);
  const waiting = useWaitingRoom({
    client: conferenceClient,
    roomId: sparkRoom.id,
    currentUserId,
    isManager,
    uiState: livekit.uiState,
    onAdmitted: handleAdmitted,
    onRejected: handleRejected,
  });
  const { participants, screenSharer } = useParticipants(livekit.room, livekit.revision);
  const screen = useScreenShare(livekit.room);
  const networkLabel = useNetworkQuality(livekit.uiState, livekit.quality);

  const leave = async () => {
    livekit.disconnect();
    try {
      await conferenceClient.rpc('leave_conference_room', { p_room_id: sparkRoom.id });
    } catch {
      // UI leave still proceeds, matching the previous behavior.
    }
    onLeave();
  };

  if (livekit.uiState === 'joining') {
    return <ConferenceRoomStatus state="joining" onLeave={onLeave} />;
  }
  if (livekit.uiState === 'waiting') {
    return <ConferenceRoomStatus state="waiting" onLeave={onLeave} />;
  }
  if (livekit.uiState === 'failed') {
    return <ConferenceRoomStatus state="failed" errorMessage={livekit.errorMessage} onRetry={() => void livekit.connect()} onLeave={onLeave} />;
  }

  const visibleParticipants = screenSharer
    ? [screenSharer]
    : participants.slice(0, window.innerWidth < 768 ? 4 : 20);

  return (
    <div className="relative flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-slate-950 text-white" dir="rtl" style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <header className="flex min-h-14 items-center justify-between gap-3 border-b border-white/10 px-3 sm:px-5">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-bold sm:text-base">{sparkRoom.name}</h1>
          <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400"><Wifi className="h-3.5 w-3.5" />{networkLabel} · {participants.length}/{sparkRoom.max_participants ?? 20}</div>
        </div>
        {waiting.waitingRows.length > 0 && <span className="rounded-full bg-amber-400 px-2 py-1 text-xs font-bold text-slate-950">{waiting.waitingRows.length} در انتظار</span>}
      </header>

      {waiting.waitingRows.length > 0 && isManager && <WaitingRoomList roomId={sparkRoom.id} rows={waiting.waitingRows} />}

      <ParticipantGrid participants={visibleParticipants} localIdentity={livekit.room?.localParticipant.identity} activeSpeakerIdentity={livekit.activeSpeakerIdentity} />
      <ReactionOverlay reaction={livekit.reaction} />

      {livekit.room && (
        <LiveKitConferenceTools
          room={livekit.room}
          roomId={sparkRoom.id}
          currentUserId={currentUserId}
          currentUserName={currentUserName}
          role={livekit.role}
          onEnded={() => void leave()}
        />
      )}

      <RoomMediaControls
        micEnabled={livekit.micEnabled}
        cameraEnabled={livekit.cameraEnabled}
        screenEnabled={screen.screenEnabled}
        allowScreenShare={sparkRoom.allow_screen_share !== false && typeof navigator.mediaDevices?.getDisplayMedia === 'function'}
        allowReactions={sparkRoom.allow_reactions !== false}
        onToggleMic={() => void livekit.toggleMic()}
        onToggleCamera={() => void livekit.toggleCamera()}
        onToggleScreen={() => void screen.toggleScreen()}
        onReaction={() => void livekit.sendReaction('👏')}
        onLeave={() => void leave()}
      />
    </div>
  );
}
