import type { ConferenceRoom as RoomType, Reaction } from '../types';
import type { KickConfirmData, PendingBanData } from './KickBanModal';
import type { SidePanel } from '../types';
import type { RoleType, Permission } from './roleConstants';
import { KickBanModal } from './KickBanModal';
import { LeaveConfirmModal } from './LeaveConfirmModal';
import { ScreenShareBadge, FloatingReactions, EmojiPicker, SpeakingProgressBar } from './Overlays';
import { BottomControls } from './BottomControls';
import { EMOJIS } from './webrtcHelpers';

interface RoomOverlaysProps {
  // kick/ban
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
  // leave confirm
  showLeaveConfirm: boolean;
  onLeaveOnly: () => void;
  onEndForAll: () => void;
  onCancelLeave: () => void;
  // screen share
  isScreenSharing: boolean;
  isMobile: boolean;
  currentUserName: string;
  onStopScreenShare: () => void;
  // reactions
  reactions: Reaction[];
  // bottom controls
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
      {/* Kick / Ban action menu */}
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

      {/* Host leave confirm */}
      {showLeaveConfirm && (
        <LeaveConfirmModal
          onLeaveOnly={onLeaveOnly}
          onEndForAll={onEndForAll}
          onCancel={onCancelLeave}
        />
      )}

      {/* Screen share badge */}
      {isScreenSharing && !isMobile && (
        <ScreenShareBadge userName={currentUserName} onStop={onStopScreenShare} />
      )}

      {/* Floating reactions — emoji + sender name */}
      <FloatingReactions reactions={reactions} />

      {/* Bottom controls */}
      <div className="bg-gray-900/95 border-t border-gray-800 flex-shrink-0 relative" dir="rtl">
        {/* Speaking progress bar — shown when user is actively speaking and limit is on */}
        {speakingLimitEnabled && speakingSecs > 0 && !isMuted && myLimitSecs > 0 && (
          <SpeakingProgressBar speakingSecs={speakingSecs} limitSecs={myLimitSecs} />
        )}
        {/* Emoji picker — rendered here (above overflow-x-auto) so it's never clipped */}
        {showEmojiPicker && room.allow_reactions && (
          <EmojiPicker emojis={EMOJIS} onPick={onSendEmoji} />
        )}
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
