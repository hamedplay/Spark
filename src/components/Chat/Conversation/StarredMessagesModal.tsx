import { Star, X, MessageCircle } from 'lucide-react';
import moment from 'moment-jalaali';
import type { MessageWithMeta } from '../types';

export interface StarredItem {
  message: MessageWithMeta;
  conversationId: string;
  otherUserName: string;
}

export function StarredMessagesModal({ starred, onClose, onGoToMessage }: {
  starred: StarredItem[];
  onClose: () => void;
  onGoToMessage: (item: StarredItem) => void;
}) {
  if (!starred) return null;
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16 px-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
            <h3 className="font-bold text-gray-900 dark:text-white text-base">پیام‌های نشانه‌دار ({starred.length})</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {starred.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-50">
              <Star className="w-10 h-10 text-gray-300" />
              <p className="text-gray-400 text-sm">هیچ پیام نشانه‌داری وجود ندارد</p>
            </div>
          ) : starred.map(item => (
            <div
              key={item.message.id}
              onClick={() => onGoToMessage(item)}
              className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-50 dark:border-gray-800 cursor-pointer group transition-colors"
            >
              <Star className="w-4 h-4 text-yellow-400 fill-yellow-400 flex-shrink-0 mt-1" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{item.otherUserName}</span>
                  <span className="text-[10px] text-gray-400">{moment(item.message.created_at).format('HH:mm jYYYY/jMM/jDD')}</span>
                </div>
                <p className="text-sm text-gray-800 dark:text-white line-clamp-2 leading-relaxed">{item.message.body || '📎 فایل'}</p>
                <div className="flex items-center gap-1 mt-1">
                  <MessageCircle className="w-3 h-3 text-gray-400" />
                  <span className="text-[10px] text-gray-400">گفتگو با {item.otherUserName}</span>
                  <span className="text-[10px] text-teal-500 mr-1 group-hover:underline">رفتن به پیام ↩</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
