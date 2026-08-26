import { Inbox, Phone } from 'lucide-react';
import type { InboxMessage } from './types';

export function InboxList(props: {
  messages: InboxMessage[];
  loading: boolean;
  onMarkRead: (id: string) => void;
  onFetchNew: () => void;
  fetching: boolean;
}) {
  const { messages, loading, onMarkRead, onFetchNew, fetching } = props;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {messages.length} پیام — {messages.filter(m => !m.is_read).length} خوانده نشده
        </p>
      </div>

      {loading && messages.length === 0 && (
        <div className="py-16 flex justify-center"><div className="w-5 h-5 border-2 border-gray-300 border-t-teal-500 rounded-full animate-spin" /></div>
      )}

      {!loading && messages.length === 0 && (
        <div className="py-16 text-center bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <Inbox className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">صندوق دریافت خالی است</p>
          <button onClick={onFetchNew} disabled={fetching}
            className="mt-3 text-sm text-teal-500 hover:text-teal-600 font-medium">
            دریافت پیام‌های جدید
          </button>
        </div>
      )}

      <div className="space-y-2">
        {messages.map(msg => (
          <div key={msg.id}
            onClick={() => !msg.is_read && onMarkRead(msg.id)}
            className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 transition cursor-pointer hover:border-gray-200 dark:hover:border-gray-600 ${msg.is_read ? 'border-gray-100 dark:border-gray-700' : 'border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-900/10'}`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 font-mono" dir="ltr">{msg.sender}</span>
                {!msg.is_read && <span className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0" />}
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0" dir="ltr">
                {new Date(msg.received_at).toLocaleString('fa-IR')}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{msg.message}</p>
            <p className="text-xs text-gray-300 dark:text-gray-600 mt-1 font-mono" dir="ltr">به: {msg.receiver}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
