import type { ChangeEvent, FormEvent } from 'react';
import type { ConferenceMessageRow } from '../../types/conference.types';

interface Props {
  messages: ConferenceMessageRow[];
  message: string;
  currentUserId: string;
  canSend: boolean;
  onMessageChange: (value: string) => void;
  onSend: () => Promise<void>;
}

export function ConferenceChatPanel({ messages, message, currentUserId, canSend, onMessageChange, onSend }: Props) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSend();
  };

  return (
    <div className="flex max-h-[48dvh] flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {messages.length === 0 && <p className="py-8 text-center text-xs text-slate-400">هنوز پیامی ارسال نشده است.</p>}
        {messages.map((item) => (
          <div key={item.id} className={`rounded-xl px-3 py-2 text-sm ${item.user_id === currentUserId ? 'mr-8 bg-violet-600/40' : 'ml-8 bg-slate-800'}`}>
            <div className="mb-1 text-[10px] font-bold text-slate-300">{item.display_name || 'کاربر'}</div>
            <p className="break-words leading-6">{item.is_deleted ? 'پیام حذف شده است' : item.body}</p>
            <time className="mt-1 block text-[9px] text-slate-400">{item.created_at ? new Date(item.created_at).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : ''}</time>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-white/10 p-3">
        <input
          value={message}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onMessageChange(event.target.value)}
          maxLength={4000}
          disabled={!canSend}
          placeholder={canSend ? 'پیام…' : 'مجوز ارسال پیام ندارید'}
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-3 text-sm outline-none focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button type="submit" disabled={!canSend} className="min-h-11 rounded-xl bg-violet-600 px-4 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50">ارسال</button>
      </form>
    </div>
  );
}
