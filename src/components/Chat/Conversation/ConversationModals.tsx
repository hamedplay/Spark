import type { ChatReminder } from '../types';
import type { StarredItem } from './StarredMessagesModal';
import type { ConversationWithProfile, MessageWithMeta } from '../types';
import { StarredMessagesModal } from './StarredMessagesModal';
import { RemindersModal } from './RemindersModal';
import { UserInfoPanel } from './UserInfoPanel';
import { JumpToDatePicker } from './JumpToDatePicker';

interface ConversationModalsProps {
  showStarredModal: boolean;
  globalStarred: StarredItem[];
  onCloseStarred: () => void;
  onGoToStarred: (item: StarredItem) => void;
  conversationId: string;
  scrollToMessage: (id: string) => void;
  showRemindersModal: boolean;
  reminders: ChatReminder[];
  onCloseReminders: () => void;
  onDismissReminder: (id: string) => void;
  showInfoPanel: boolean;
  conversation: ConversationWithProfile;
  otherName: string;
  isSavedMessages: boolean;
  isUserOnline: (lastSeen?: string | null) => boolean;
  getLastSeenText: (lastSeen?: string | null) => string;
  otherUserPresence: { last_seen: string | null } | null;
  localStarredCount: number;
  onCloseInfoPanel: () => void;
  jumpPickerDate: { jy: number; jm: number; jd: number } | null;
  onJumpToDate: (jy: number, jm: number, jd: number) => void;
  onCloseJumpPicker: () => void;
}

export function ConversationModals(props: ConversationModalsProps) {
  const {
    showStarredModal, globalStarred, onCloseStarred, onGoToStarred, conversationId, scrollToMessage,
    showRemindersModal, reminders, onCloseReminders, onDismissReminder,
    showInfoPanel, conversation, otherName, isSavedMessages, isUserOnline, getLastSeenText,
    otherUserPresence, localStarredCount, onCloseInfoPanel,
    jumpPickerDate, onJumpToDate, onCloseJumpPicker,
  } = props;

  return (
    <>
      {/* Starred Messages Modal */}
      {showStarredModal && (
        <StarredMessagesModal
          starred={globalStarred}
          onClose={onCloseStarred}
          onGoToMessage={(item) => {
            onGoToStarred(item);
            if (item.conversationId === conversationId) {
              setTimeout(() => scrollToMessage(item.message.id), 100);
            }
          }}
        />
      )}

      {/* Reminders Modal */}
      {showRemindersModal && (
        <RemindersModal
          reminders={reminders}
          onClose={onCloseReminders}
          onDismissReminder={onDismissReminder}
          onGoToMessage={scrollToMessage}
          currentConversationId={conversationId}
        />
      )}

      {/* User Info Panel */}
      {showInfoPanel && (
        <UserInfoPanel
          conversation={conversation}
          otherName={otherName}
          isSavedMessages={isSavedMessages}
          isUserOnline={isUserOnline}
          getLastSeenText={getLastSeenText}
          otherUserPresence={otherUserPresence}
          localStarredCount={localStarredCount}
          remindersCount={reminders.length}
          onClose={onCloseInfoPanel}
        />
      )}

      {/* Jump-to-date picker */}
      {jumpPickerDate && (
        <JumpToDatePicker
          initial={jumpPickerDate}
          onConfirm={onJumpToDate}
          onClose={onCloseJumpPicker}
        />
      )}
    </>
  );
}
