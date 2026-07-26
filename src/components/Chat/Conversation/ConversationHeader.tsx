import { ChevronRight, Search, Phone, Video, Star, Bell, Info, Bookmark, CalendarDays } from 'lucide-react';
import { UserAvatar } from '../ChatConversationItem';
import type { ConversationWithProfile } from '../types';

export function ConversationHeader(props: {
  onBack: () => void;
  isSavedMessages: boolean;
  otherName: string;
  conversation: ConversationWithProfile;
  otherUserPresence: { last_seen: string | null } | null;
  isUserOnline: (lastSeen?: string | null) => boolean;
  getLastSeenText: (lastSeen?: string | null) => string;
  localStarredCount: number;
  remindersCount: number;
  showSearch: boolean;
  onToggleSearch: () => void;
  onOpenStarred: () => void;
  onOpenReminders: () => void;
  onStartCall?: (callType: 'audio' | 'video') => void;
  onJumpToDate: () => void;
  showInfoPanel: boolean;
  onToggleInfoPanel: () => void;
}) {
  const {
    onBack, isSavedMessages, otherName, conversation, otherUserPresence,
    isUserOnline, getLastSeenText, localStarredCount, remindersCount,
    showSearch, onToggleSearch, onOpenStarred, onOpenReminders,
    onStartCall, onJumpToDate, showInfoPanel, onToggleInfoPanel,
  } = props;

  return (
    <div className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 min-w-0">
      <button onClick={onBack} className="lg:hidden p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex-shrink-0">
        <ChevronRight className="w-5 h-5 dark:text-white" />
      </button>
      {/* Avatar with status dot */}
      <div className="relative flex-shrink-0">
        {isSavedMessages ? (
          <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center">
            <Bookmark className="w-4 h-4 text-white" />
          </div>
        ) : (
          <>
            <UserAvatar name={otherName} size="sm" avatarUrl={conversation.otherUser.avatar_url} />
            {(() => {
              const online = isUserOnline(otherUserPresence?.last_seen);
              const dotColor = online ? 'bg-green-500' : 'bg-gray-400';
              return <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-900 ${dotColor}`} />;
            })()}
          </>
        )}
      </div>
      {/* On desktop: show name + status; on mobile: avatar only */}
      <div className="hidden sm:block flex-1 min-w-0">
        <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{otherName}</h3>
        {isSavedMessages ? (
          <p className="text-xs text-teal-500 truncate">پیام‌های شخصی شما</p>
        ) : (
          (() => {
            const online = isUserOnline(otherUserPresence?.last_seen);
            return (
              <p className={`text-xs truncate ${online ? 'text-green-500' : 'text-gray-400'}`}>
                {getLastSeenText(otherUserPresence?.last_seen)}
              </p>
            );
          })()
        )}
      </div>
      {/* On mobile: spacer to push icons to end */}
      <div className="flex-1 sm:hidden" />

      {/* Action icons — all visible on all screen sizes */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {/* Starred messages */}
        <button
          onClick={onOpenStarred}
          className="relative flex items-center justify-center p-2 rounded-xl transition-colors text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          title="پیام‌های نشانه‌دار"
        >
          <Star className={`w-4 h-4 ${localStarredCount > 0 ? 'fill-yellow-400 text-yellow-400' : ''}`} />
          {localStarredCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-yellow-400 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
              {localStarredCount}
            </span>
          )}
        </button>
        {/* Reminders */}
        <button
          onClick={onOpenReminders}
          className="relative flex items-center justify-center p-2 rounded-xl transition-colors text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          title="یادآوری‌ها"
        >
          <Bell className="w-4 h-4" />
          {remindersCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-400 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
              {remindersCount}
            </span>
          )}
        </button>
        {/* Search */}
        <button
          onClick={onToggleSearch}
          className={`p-2 rounded-xl transition-colors ${showSearch ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500'}`}
          title="جستجو در پیام‌ها"
        >
          <Search className="w-4 h-4" />
        </button>
        {/* Voice call */}
        {!isSavedMessages && (
          <button
            onClick={() => onStartCall?.('audio')}
            className="p-2 rounded-xl transition-colors hover:bg-teal-50 dark:hover:bg-teal-900/20 text-teal-600 dark:text-teal-400"
            title="تماس صوتی"
          >
            <Phone className="w-4 h-4" />
          </button>
        )}
        {/* Video call */}
        {!isSavedMessages && (
          <button
            onClick={() => onStartCall?.('video')}
            className="p-2 rounded-xl transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400"
            title="تماس تصویری"
          >
            <Video className="w-4 h-4" />
          </button>
        )}
        {/* Jump to date */}
        <button
          onClick={onJumpToDate}
          className="p-2 rounded-xl transition-colors hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500"
          title="رفتن به تاریخ"
        >
          <CalendarDays className="w-4 h-4" />
        </button>
        <button onClick={onToggleInfoPanel} className={`hidden sm:flex p-2 rounded-xl text-gray-500 transition-colors items-center justify-center ${showInfoPanel ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`} title="اطلاعات">
          <Info className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
