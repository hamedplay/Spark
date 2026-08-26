import type { ConferenceRoom as RoomType, Reaction } from '../types';
import type { KickConfirmData, PendingBanData } from './KickBanModal';
import type { SidePanel } from '../types';
import { KickBanModal } from './KickBanModal';
import { LeaveConfirmModal } from './LeaveConfirmModal';
import { ScreenShareBadge, FloatingReactions, EmojiPicker, SpeakingProgressBar } from './Overlays';
import { BottomControls } from './BottomControls';
import { EMOJIS } from './webrtcHelpers';

interface RoomOverlaysProps {
  kickConfirm: KickConfirmData | null;
  pendingBan: PendingBanData | null;
  banReason: string;
  setBanReason: (v: string) => void;
  canBan: boolean;
  onKick: () => void;
  onSelectBanDuration: (durationMinutes: number, label: string) => void;
  onConfirmBan: () => void;
  onBackFromBan: () => void;
  onCloseKickBan: () => void;
  showLeaveConfirm: boolean;
  onLeaveOnly: () => void;
  onEndForAll: () => void;
  onCancelLeave: () => void;
  isScreenSharing: boolean;
  isMobile: boolean;
  currentUserName: string;
  onStopScreenShare: () => void;
  reactions: Reaction[];
  room: RoomType;
  isMuted: boolean;
  isVideoOff: boolean;
  isHandRaised: boolean;
  isSpeakerMuted: boolean;
  showEmojiPicker: boolean;
  sidePanel: SidePanel;
  showAllControls: boolean;
  unreadCount: number;
  sortedQueueLength: number;
  pendingApprovalsLength: number;
  canMuteAll: boolean;
  speakingLimitEnabled: boolean;
  speakingSecs: number;
  myLimitSecs: number;
  onToggleMute: () => void;
  onToggleVideo: () => void;
  onToggleHand: () => void;
  onToggleScreenShare: () => void;
  onToggleEmojiPicker: () => void;
  onTogglePanel: (p: SidePanel) => void;
  onToggleSpeakerMute: () => void;
  onMuteAll: () => void;
  onLeave: () => void;
  onToggleAllControls: () => void;
  onSendEmoji: (e: string) => void;
}

export function RoomOverlays(props: RoomOverlaysProps) {
  const {
    kickConfirm, pendingBan, banReason, setBanReason, canBan,
    onKick, onSelectBanDuration, onConfirmBan, onBackFromBan, onCloseKickBan,
    showLeaveConfirm, onLeaveOnly, onEndForAll, onCancelLeave,
    isScreenSharing, isMobile, currentUserName, onStopScreenShare,
    reactions,
    room, isMuted, isVideoOff, isHandRaised, isSpeakerMuted,
    showEmojiPicker, sidePanel, showAllControls, unreadCount,
    sortedQueueLength, pendingApprovalsLength, canMuteAll,
    speakingLimitEnabled, speakingSecs, myLimitSecs,
    onToggleMute, onToggleVideo, onToggleHand, onToggleScreenShare,
    onToggleEmojiPicker, onTogglePanel, onToggleSpeakerMute,
    onMuteAll, onLeave, onToggleAllControls, onSendEmoji,
  } = props;

  return (
    <>
      {kickConfirm && (
        <KickBanModal
          kickConfirm={kickConfirm}
          pendingBan={pendingBan}
          banReason={banReason}
          setBanReason={setBanReason}
          canBan={canBan}
          onKick={onKick}
          onSelectBanDuration={onSelectBanDuration}
          onConfirmBan={onConfirmBan}
          onBackFromBan={onBackFromBan}
          onClose={onCloseKickBan}
        />
      )}

      {showLeaveConfirm && (
        <LeaveConfirmModal
          onLeaveOnly={onLeaveOnly}
          onEndForAll={onEndForAll}
          onCancel={onCancelLeave}
        />
      )}

      {isScreenSharing && !isMobile && <ScreenShareBadge userName={currentUserName} onStop={onStopScreenShare} />}
      <FloatingReactions reactions={reactions} />

      <div className="bg-gray-900/95 border-t border-gray-800 flex-shrink-0 relative" dir="rtl">
        {speakingLimitEnabled && speakingSecs > 0 && !isMuted && myLimitSecs > 0 && (
          <SpeakingProgressBar speakingSecs={speakingSecs} limitSecs={myLimitSecs} />
        )}
        {showEmojiPicker && room.allow_reactions && <EmojiPicker emojis={EMOJIS} onPick={onSendEmoji} />}
        <BottomControls
          room={room}
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          isHandRaised={isHandRaised}
          isScreenSharing={isScreenSharing}
          isSpeakerMuted={isSpeakerMuted}
          showEmojiPicker={showEmojiPicker}
          sidePanel={sidePanel}
          isMobile={isMobile}
          showAllControls={showAllControls}
          unreadCount={unreadCount}
          sortedQueueLength={sortedQueueLength}
          pendingApprovalsLength={pendingApprovalsLength}
          canMuteAll={canMuteAll}
          onToggleMute={onToggleMute}
          onToggleVideo={onToggleVideo}
          onToggleHand={onToggleHand}
          onToggleScreenShare={onToggleScreenShare}
          onToggleEmojiPicker={onToggleEmojiPicker}
          onTogglePanel={onTogglePanel}
          onToggleSpeakerMute={onToggleSpeakerMute}
          onMuteAll={onMuteAll}
          onLeave={onLeave}
          onToggleAllControls={onToggleAllControls}
        />
      </div>
    </>
  );
}
