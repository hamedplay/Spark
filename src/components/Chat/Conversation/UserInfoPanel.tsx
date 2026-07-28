import { X, Bookmark } from 'lucide-react';
import type { ConversationWithProfile } from '../types';

export function UserInfoPanel({ conversation, otherName, isSavedMessages, isUserOnline, getLastSeenText, otherUserPresence, localStarredCount, remindersCount, onClose }: {
  conversation: ConversationWithProfile;
  otherName: string;
  isSavedMessages: boolean;
  isUserOnline: (lastSeen?: string | null) => boolean;
  getLastSeenText: (lastSeen?: string | null) => string;
  otherUserPresence: { last_seen: string | null } | null;
  localStarredCount: number;
  remindersCount: number;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex justify-end" dir="rtl">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative w-80 bg-white dark:bg-gray-900 h-full shadow-2xl border-r border-gray-100 dark:border-gray-800 flex flex-col overflow-y-auto animate-in slide-in-from-right duration-200">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-bold text-gray-900 dark:text-white text-sm">اطلاعات گفتگو</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex flex-col items-center py-6 px-5 border-b border-gray-100 dark:border-gray-800">
          {isSavedMessages ? (
            <div className="w-20 h-20 rounded-full bg-teal-500 flex items-center justify-center mb-3">
              <Bookmark className="w-9 h-9 text-white" />
            </div>
          ) : (
            <div className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0">
              {conversation.otherUser.avatar_url ? (
                <img src={conversation.otherUser.avatar_url} alt={otherName} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-teal-500 flex items-center justify-center text-white text-3xl font-bold">
                  {otherName.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          )}
          <h4 className="mt-3 font-bold text-gray-900 dark:text-white text-base">{otherName}</h4>
          {!isSavedMessages && (
            <p className={`text-xs mt-1 ${isUserOnline(otherUserPresence?.last_seen) ? 'text-green-500' : 'text-gray-400'}`}>
              {getLastSeenText(otherUserPresence?.last_seen)}
            </p>
          )}
          {!isSavedMessages && (conversation.otherUser.username || conversation.otherUser.email) && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{conversation.otherUser.username || conversation.otherUser.email}</p>
          )}
        </div>
        <div className="px-5 py-4 space-y-1">
          {!isSavedMessages && (
            <div className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800">
              <span className="text-xs text-gray-500 dark:text-gray-400">وضعیت</span>
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${isUserOnline(otherUserPresence?.last_seen) ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                  {isUserOnline(otherUserPresence?.last_seen) ? 'آنلاین' : 'آفلاین'}
                </span>
              </div>
            </div>
          )}
          <div className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800">
            <span className="text-xs text-gray-500 dark:text-gray-400">پیام‌های نشانه‌دار</span>
            <span className="text-xs font-semibold text-yellow-500">{localStarredCount}</span>
          </div>
          <div className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800">
            <span className="text-xs text-gray-500 dark:text-gray-400">یادآوری‌های فعال</span>
            <span className="text-xs font-semibold text-amber-500">{remindersCount}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
