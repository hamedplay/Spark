import { Bell, Clock, X } from 'lucide-react';
import moment from 'moment-jalaali';
import type { ChatReminder } from '../types';

export function RemindersModal({ reminders, onClose, onDismissReminder, onGoToMessage, currentConversationId }: {
  reminders: ChatReminder[];
  onClose: () => void;
  onDismissReminder: (id: string) => void;
  onGoToMessage: (messageId: string) => void;
  currentConversationId: string;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16 px-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[75vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-amber-500" />
            <h3 className="font-bold text-gray-900 dark:text-white text-base">یادآوری‌های فعال ({reminders.length})</h3>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">
          {reminders.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-50">
              <Bell className="w-10 h-10 text-gray-300" />
              <p className="text-gray-400 text-sm">یادآوری فعالی وجود ندارد</p>
            </div>
          ) : reminders.map((r: any) => {
            const msgBody = r.chat_messages?.body;
            const msgId = r.chat_messages?.id;
            const msgConvId = r.chat_messages?.conversation_id;
            return (
              <div key={r.id} className="flex items-start gap-4 px-6 py-4 border-b border-gray-50 dark:border-gray-800">
                <Clock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-1" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                      {moment(r.remind_at).format('HH:mm — jYYYY/jMM/jDD')}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${moment(r.remind_at).isBefore(moment()) ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                      {moment(r.remind_at).isBefore(moment()) ? 'گذشته' : 'پیش رو'}
                    </span>
                  </div>
                  {msgBody && (
                    <div
                      onClick={() => { if (msgConvId === currentConversationId && msgId) { onClose(); setTimeout(() => onGoToMessage(msgId), 100); } }}
                      className={`text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-lg mb-1 line-clamp-2 ${msgConvId === currentConversationId ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : ''}`}
                    >
                      {msgBody}
                      {msgConvId === currentConversationId && <span className="text-[10px] text-teal-500 mr-1">↩ رفتن</span>}
                    </div>
                  )}
                  {r.note && <p className="text-sm text-gray-800 dark:text-white">{r.note}</p>}
                </div>
                <button onClick={() => onDismissReminder(r.id)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 flex-shrink-0 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
