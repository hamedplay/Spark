import type { FormEvent, KeyboardEvent } from 'react';
import { AtSign, Pencil, Reply, X } from 'lucide-react';
import type {
  ConferenceMessageRow,
  ParticipantRow,
} from '../../types/conference.types';

interface Props {
  message: string;
  canSend: boolean;
  busy: boolean;
  errorMessage: string;
  replyTo: ConferenceMessageRow | null;
  editing: ConferenceMessageRow | null;
  mentionCandidates: ParticipantRow[];
  selectedMentionUserIds: string[];
  onMessageChange: (value: string) => void;
  onSend: () => Promise<void>;
  onCancelContext: () => void;
  onToggleMention: (participant: ParticipantRow) => void;
}

export function ConferenceChatComposer({
  message,
  canSend,
  busy,
  errorMessage,
  replyTo,
  editing,
  mentionCandidates,
  selectedMentionUserIds,
  onMessageChange,
  onSend,
  onCancelContext,
  onToggleMention,
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

  const showMentions = (
    canSend
    && mentionCandidates.length > 0
    && (message.includes('@') || selectedMentionUserIds.length > 0)
  );

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
                ? 'ویرایش پیام'
                : `پاسخ به ${replyTo?.display_name || 'پیام'}`}
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

      {showMentions && (
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto px-3 pt-2">
          <div className="flex h-7 items-center gap-1 px-1 text-[9px] text-slate-400">
            <AtSign className="h-3 w-3" />
            اشاره:
          </div>
          {mentionCandidates.map((participant) => {
            const selected = selectedMentionUserIds.includes(participant.user_id);
            return (
              <button
                key={participant.user_id}
                type="button"
                onClick={() => onToggleMention(participant)}
                className={`h-7 rounded-full border px-2 text-[9px] ${
                  selected
                    ? 'border-violet-400 bg-violet-500/20 text-violet-100'
                    : 'border-white/10 bg-slate-900 text-slate-300'
                }`}
              >
                @{participant.display_name}
              </button>
            );
          })}
        </div>
      )}

      {errorMessage && (
        <div
          className="px-3 pt-2 text-[10px] text-rose-300"
          role="alert"
        >
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
            disabled={!canSend || busy}
            placeholder={canSend ? 'پیام… برای اشاره @ بنویسید' : 'چت در دسترس نیست'}
            className="max-h-28 min-h-11 w-full resize-none rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-violet-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="mt-0.5 text-left text-[8px] text-slate-500">
            {message.length}/4000
          </div>
        </div>
        <button
          type="submit"
          disabled={!canSend || busy || !message.trim()}
          className="min-h-11 rounded-xl bg-violet-600 px-4 text-xs font-bold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {editing ? 'ذخیره' : 'ارسال'}
        </button>
      </form>
    </div>
  );
}
