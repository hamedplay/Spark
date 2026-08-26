import { Bell, CircleCheck as CheckCircle } from 'lucide-react';
import moment from 'moment-jalaali';
import type { ChatReminder } from '../types';

export function ReminderAlarmModal({ reminderAlarm, onDismiss }: {
  reminderAlarm: ChatReminder | null;
  onDismiss: () => void;
}) {
  if (!reminderAlarm) return null;
  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm"
      style={{ zIndex: 9998 }}
      onMouseDown={e => e.stopPropagation()}
      onClick={e => e.stopPropagation()}
    >
      {/* Pulsing amber ring */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="w-80 h-80 rounded-full border-4 border-amber-400 animate-ping opacity-20" />
      </div>
      <div className="relative bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border-4 border-amber-400">
        <div className="bg-amber-400 px-6 py-5 flex items-center gap-3">
          <Bell className="w-9 h-9 text-white animate-bounce flex-shrink-0" />
          <div>
            <p className="text-white font-bold text-xl">یادآوری!</p>
            <p className="text-amber-900 text-sm mt-0.5 font-medium">
              {moment((reminderAlarm as any).remind_at).format('HH:mm — jYYYY/jMM/jDD')}
            </p>
          </div>
        </div>
        <div className="px-6 py-6">
          {(reminderAlarm as any).chat_messages?.body && (
            <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 mb-4 border border-gray-100 dark:border-gray-700">
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">
                {(reminderAlarm as any).chat_messages.body}
              </p>
            </div>
          )}
          {reminderAlarm.note && (
            <p className="text-gray-800 dark:text-white text-base leading-relaxed font-medium">{reminderAlarm.note}</p>
          )}
          <p className="text-xs text-amber-500 mt-3 text-center animate-pulse">یادآوری رسیده است</p>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onDismiss}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-500 active:bg-amber-600 text-white font-bold py-3.5 rounded-2xl transition-colors text-base shadow-lg"
          >
            <CheckCircle className="w-5 h-5" /> متوجه شدم
          </button>
        </div>
      </div>
    </div>
  );
}
