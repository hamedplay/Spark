import { Circle } from 'lucide-react';
import { useState } from 'react';
import { useConferenceClient } from '../../../../components/VideoConference/conferenceClient';
import { useConferenceChat } from '../../hooks/useConferenceChat';
import { useConferenceModeration } from '../../hooks/useConferenceModeration';
import { useConferenceModeratorChat } from '../../hooks/useConferenceModeratorChat';
import { useConferencePrivateChat } from '../../hooks/useConferencePrivateChat';
import { useConferenceRealtime } from '../../hooks/useConferenceRealtime';
import { useMediaDevices } from '../../hooks/useMediaDevices';
import type { ConferencePanel, ConferenceToolsProps } from '../../types/conference.types';
import { ConferenceChatPanel } from '../chat/ConferenceChatPanel';
import { ConferenceModeratorChatPanel } from '../chat/ConferenceModeratorChatPanel';
import { ConferencePrivateChatPanel } from '../chat/ConferencePrivateChatPanel';
import { ConferenceParticipantsPanel } from '../participants/ConferenceParticipantsPanel';
import { ConferenceToolsBar } from './ConferenceToolsBar';
import { MediaDevicesPanel } from './MediaDevicesPanel';

export function ConferenceTools({
  room,
  roomId,
  currentUserId,
  currentUserName,
  authorization,
  phase,
  speakerTimer,
  onEnded,
}: ConferenceToolsProps) {
  const client = useConferenceClient();
  const [panel, setPanel] = useState<ConferencePanel>(null);
  const moderation = useConferenceModeration({
    client,
    roomId,
    currentUserId,
    authorization,
    speakerTimer,
    onEnded,
  });
  const chat = useConferenceChat({
    client,
    roomId,
    currentUserId,
    authorization,
    phaseAllowsChat: phase.allowChat,
    mentionCandidates: moderation.participants,
  });
  const privateChat = useConferencePrivateChat({
    client,
    roomId,
    currentUserId,
    authorization,
    phaseAllowsChat: phase.allowChat,
    participants: moderation.participants,
  });
  const moderatorChat = useConferenceModeratorChat({
    client,
    roomId,
    currentUserId,
    authorization,
  });
  const devices = useMediaDevices(room);

  useConferenceRealtime({
    client,
    roomId,
    refreshMessages: chat.refreshMessages,
    refreshParticipants: moderation.refreshParticipants,
    refreshRoomState: moderation.refreshRoomState,
  });

  return (
    <>
      {moderation.recording && (
        <div className="absolute left-3 top-[68px] z-30 flex items-center gap-2 rounded-full bg-rose-600 px-3 py-1.5 text-xs font-bold text-white shadow-lg backdrop-blur" aria-live="polite">
          <Circle className="h-3 w-3 fill-current" /> ضبط جلسه
        </div>
      )}

      <ConferenceToolsBar
        panel={panel}
        messageCount={chat.messages.length}
        privateUnreadCount={privateChat.unreadCount}
        canPrivateChat={privateChat.canUse}
        canModeratorChat={moderatorChat.canUse}
        raised={moderation.raised}
        raisedCount={moderation.raisedParticipants.length}
        busy={moderation.busy}
        recording={Boolean(moderation.recording)}
        locked={moderation.locked}
        canStartRecording={moderation.canStartRecording}
        canStopRecording={moderation.canStopRecording}
        canLockRoom={moderation.canLockRoom}
        canEndMeeting={moderation.canEndMeeting}
        onPanelChange={setPanel}
        onToggleRaise={moderation.toggleRaise}
        onToggleRecording={moderation.toggleRecording}
        onToggleLock={() => moderation.hostAction(moderation.locked ? 'unlock' : 'lock')}
        onEnd={() => moderation.hostAction('end')}
      />

      {panel && (
        <aside className="absolute inset-x-2 bottom-[146px] z-40 max-h-[55dvh] overflow-hidden rounded-2xl border border-white/10 bg-slate-900/95 shadow-2xl backdrop-blur sm:inset-x-auto sm:left-4 sm:w-[420px]" dir="rtl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <strong className="text-sm">
              {panel === 'chat'
                ? 'گفتگوی جلسه'
                : panel === 'private-chat'
                  ? 'پیام خصوصی'
                  : panel === 'moderator-chat'
                    ? 'گفتگوی مدیران'
                    : panel === 'participants'
                    ? 'شرکت‌کنندگان'
                    : 'دستگاه‌های رسانه‌ای'}
            </strong>
            <button onClick={() => setPanel(null)} className="h-9 rounded-lg px-3 text-xs text-slate-300 hover:bg-white/10">بستن</button>
          </div>

          {panel === 'chat' && (
            <ConferenceChatPanel
              messages={chat.messages}
              message={chat.message}
              currentUserId={currentUserId}
              canSend={chat.canSend}
              canDeleteAny={chat.canDeleteAny}
              busy={chat.busy}
              errorMessage={chat.errorMessage}
              replyTo={chat.replyTo}
              editing={chat.editing}
              mentionCandidates={chat.mentionCandidates}
              selectedMentionUserIds={chat.selectedMentionUserIds}
              onMessageChange={chat.setMessage}
              onSend={chat.sendMessage}
              onReply={chat.beginReply}
              onEdit={chat.beginEdit}
              onDelete={chat.deleteMessage}
              onReact={chat.toggleReaction}
              onCancelContext={chat.resetComposer}
              onToggleMention={chat.toggleMention}
            />
          )}
          {panel === 'private-chat' && (
            <ConferencePrivateChatPanel
              conversation={privateChat.conversation}
              peers={privateChat.peers}
              selectedPeerUserId={privateChat.selectedPeerUserId}
              unreadByPeer={privateChat.unreadByPeer}
              currentUserId={currentUserId}
              message={privateChat.message}
              canSend={privateChat.canSend}
              busy={privateChat.busy}
              errorMessage={privateChat.errorMessage}
              replyTo={privateChat.replyTo}
              editing={privateChat.editing}
              onSelectPeer={privateChat.selectPeer}
              onMessageChange={privateChat.setMessage}
              onSend={privateChat.sendMessage}
              onReply={privateChat.beginReply}
              onEdit={privateChat.beginEdit}
              onDelete={privateChat.deleteMessage}
              onCancelContext={privateChat.resetComposer}
            />
          )}
          {panel === 'moderator-chat' && (
            <ConferenceModeratorChatPanel
              messages={moderatorChat.messages}
              currentUserId={currentUserId}
              message={moderatorChat.message}
              canSend={moderatorChat.canUse}
              busy={moderatorChat.busy}
              errorMessage={moderatorChat.errorMessage}
              replyTo={moderatorChat.replyTo}
              editing={moderatorChat.editing}
              onMessageChange={moderatorChat.setMessage}
              onSend={moderatorChat.sendMessage}
              onReply={moderatorChat.beginReply}
              onEdit={moderatorChat.beginEdit}
              onDelete={moderatorChat.deleteMessage}
              onCancelContext={moderatorChat.resetComposer}
            />
          )}
          {panel === 'participants' && (
            <ConferenceParticipantsPanel
              participants={moderation.participants}
              currentUserId={currentUserId}
              phase={phase}
              canMuteOthers={moderation.canMuteOthers}
              canRemoveParticipants={moderation.canRemoveParticipants}
              canManageRoles={moderation.canManageRoles}
              canManageTimer={moderation.canManageTimer}
              speakerQueue={moderation.speakerQueue}
              speakerSessionsByUser={moderation.speakerSessionsByUser}
              speakerRemainingByUser={moderation.speakerRemainingByUser}
              timerBusy={moderation.busy}
              onHostAction={moderation.hostAction}
              onRoleChange={moderation.changeRole}
              onTimerAction={moderation.timerAction}
              onQueueAction={moderation.queueAction}
            />
          )}
          {panel === 'devices' && (
            <MediaDevicesPanel
              audioInputs={devices.audioInputs}
              videoInputs={devices.videoInputs}
              audioOutputs={devices.audioOutputs}
              selectedMic={devices.selectedMic}
              selectedCamera={devices.selectedCamera}
              selectedSpeaker={devices.selectedSpeaker}
              onSwitchDevice={devices.switchDevice}
            />
          )}
        </aside>
      )}
    </>
  );
}
