import { MessageCircle, CalendarDays } from 'lucide-react';
import moment from 'moment-jalaali';
import { ChatMessage } from '../ChatMessage';
import type { MessageWithMeta, UserProfile } from '../types';

export interface ChatThemeSettings {
  backgroundStyle: 'none' | 'dots' | 'lines' | 'gradient';
  backgroundGradientFrom: string;
  backgroundGradientTo: string;
}

export function MessageList(props: {
  messages: MessageWithMeta[];
  grouped: { date: string; messages: MessageWithMeta[] }[];
  searchQuery: string;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  messageRefs: React.MutableRefObject<Map<string, HTMLDivElement>>;
  chatTheme: ChatThemeSettings;
  currentUserId: string;
  orgUsers: any[];
  setJumpPickerDate: React.Dispatch<React.SetStateAction<{ jy: number; jm: number; jd: number } | null>>;
  setReplyingTo: React.Dispatch<React.SetStateAction<MessageWithMeta | null>>;
  setEditingMessage: React.Dispatch<React.SetStateAction<MessageWithMeta | null>>;
  handleStar: (id: string, isStarred: boolean) => void;
  handleDeleteForMe: (id: string) => void;
  handleDeleteForAll: (id: string) => void;
  handleReact: (id: string, emoji: string) => void;
  handleStatusChange: (id: string, status: any) => void;
  handleScheduleMeeting: (ids: string[], body: string) => void;
  fetchMessages: () => void;
  fetchReminders: () => void;
  scrollToMessage: (id: string) => void;
  onNavigateToTasks?: (body: string, id: string) => void;
  onOpenDirectChat?: (userId: string) => void;
  formatDate: (jDate: string) => string;
}) {
  const {
    messages, grouped, scrollRef, messageRefs, chatTheme, currentUserId, orgUsers,
    setJumpPickerDate, setReplyingTo, setEditingMessage,
    handleStar, handleDeleteForMe, handleDeleteForAll, handleReact, handleStatusChange,
    handleScheduleMeeting, fetchMessages, fetchReminders, scrollToMessage, onNavigateToTasks, onOpenDirectChat, formatDate,
  } = props;

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-y-auto py-4"
      style={(() => {
        const dotColor = document.documentElement.classList.contains('dark') ? '#4d5049' : '#e5e7eb';
        const lineColor = document.documentElement.classList.contains('dark') ? '#4d5049' : '#e5e7eb';
        if (chatTheme.backgroundStyle === 'dots')
          return { backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`, backgroundSize: '20px 20px' };
        if (chatTheme.backgroundStyle === 'lines')
          return { backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 19px, ${lineColor} 19px, ${lineColor} 20px)` };
        if (chatTheme.backgroundStyle === 'gradient')
          return { background: `linear-gradient(135deg, ${chatTheme.backgroundGradientFrom}, ${chatTheme.backgroundGradientTo})` };
        return {};
      })()}
    >
      {grouped.map(group => {
        const jDate = moment(group.date, 'jYYYY/jMM/jDD');
        const jy = jDate.jYear();
        const jm = jDate.jMonth() + 1;
        const jd = jDate.jDate();
        return (
        <div key={group.date}>
          <div className="flex items-center justify-center my-3">
            <button
              onClick={() => setJumpPickerDate({ jy, jm, jd })}
              className="flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs rounded-full shadow-sm border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              <CalendarDays className="w-3 h-3 flex-shrink-0" />
              {formatDate(group.date)} — {group.date}
            </button>
          </div>
          {group.messages.map(msg => (
            <div key={msg.id} ref={el => { if (el) messageRefs.current.set(msg.id, el); else messageRefs.current.delete(msg.id); }} className="transition-all duration-300 rounded-xl">
              <ChatMessage
                message={msg}
                isOwn={msg.sender_id === currentUserId}
                currentUserId={currentUserId}
                allUsers={orgUsers}
                onReply={() => setReplyingTo(msg)}
                onEdit={() => setEditingMessage(msg)}
                onStar={() => handleStar(msg.id, msg.isStarred)}
                onDeleteForMe={() => handleDeleteForMe(msg.id)}
                onDeleteForAll={() => handleDeleteForAll(msg.id)}
                onReact={emoji => handleReact(msg.id, emoji)}
                onStatusChange={status => handleStatusChange(msg.id, status)}
                onScheduleMeeting={handleScheduleMeeting}
                onTagsChanged={fetchMessages}
                onReminderSet={fetchReminders}
                onScrollToMessage={scrollToMessage}
                onRegisterAsTask={onNavigateToTasks}
                onOpenDirectChat={onOpenDirectChat}
              />
            </div>
          ))}
        </div>
        );
      })}
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
          <MessageCircle className="w-12 h-12 text-gray-300" />
          <p className="text-gray-400 text-sm">اولین پیام را ارسال کنید</p>
        </div>
      )}
    </div>
  );
}
