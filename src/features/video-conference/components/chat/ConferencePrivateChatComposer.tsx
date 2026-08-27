import type { FormEvent, KeyboardEvent } from 'react';
import { Pencil, Reply, X } from 'lucide-react';
import type { ConferencePrivateMessageRow } from '../../types/conference.types';

interface Props {
  message: string;
  canSend: boolean;
  busy: boolean;
  errorMessage: string;
  replyTo: ConferencePrivateMessageRow | null;
  editing: ConferencePrivateMessageRow | null;
  hasPeer: boolean;
  onMessageChange: (value: string) => void;
  onSend: () => Promise<void>;
  onCancelContext: () => void;
}

export function ConferencePrivateChatComposer({
  message,
  canSend,
  busy,
  errorMessage,
  replyTo,
  editing,
  hasPeer,
  onMessageChange,
  onSend,
  onCancelContext,
}: Props) {
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSend();
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void onSend();
    }
  };

  return (
    <div className="border-t border-white/10">
      {(replyTo || editing) && (
        <div className="flex items-center gap-2 bg-slate-950/70 px-3 py-2">
          {editing
            ? <Pencil className="h-3.5 w-3.5 text-violet-300" />
            : <Reply className="h-3.5 w-3.5 text-violet-300" />}
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold text-violet-300">
              {editing
                ? 'ویرایش پیام خصوصی'
                : `پاسخ به ${replyTo?.sender_name || 'پیام'}`}
            </div>
            {!editing && replyTo && (
              <div className="truncate text-[9px] text-slate-400">
                {replyTo.body}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onCancelContext}
            className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-white/10"
            aria-label="لغو"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="px-3 pt-2 text-[10px] text-rose-300" role="alert">
          {errorMessage}
        </div>
      )}

      <form onSubmit={submit} className="flex items-end gap-2 p-3">
        <div className="min-w-0 flex-1">
          <textarea
            value={message}
            onChange={(event) => onMessageChange(event.target.value)}
            onKeyDown={keyDown}
            maxLength={4000}
            rows={2}
            disabled={!canSend || busy || !hasPeer}
            placeholder={
              !hasPeer
                ? 'مخاطبی برای پیام خصوصی وجود ندارد'
                : canSend
                  ? 'پیام خصوصی…'
                  : 'چت در دسترس نیست'
            }
            className="max-h-28 min-h-11 w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="mt-0.5 text-left text-[8px] text-slate-500">
            {message.length}/4000
          </div>
        </div>
        <button
          type="submit"
          disabled={!canSend || busy || !hasPeer || !message.trim()}
          className="min-h-11 rounded-xl bg-violet-600 px-4 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {editing ? 'ذخیره' : 'ارسال'}
        </button>
      </form>
    </div>
  );
}
