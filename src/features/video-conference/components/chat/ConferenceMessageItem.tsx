import { Pencil, Reply, Trash2 } from 'lucide-react';
import type { ConferenceMessageRow } from '../../types/conference.types';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '👏', '🎉'];

interface Props {
  item: ConferenceMessageRow;
  currentUserId: string;
  canInteract: boolean;
  canDeleteAny: boolean;
  busy: boolean;
  onReply: (item: ConferenceMessageRow) => void;
  onEdit: (item: ConferenceMessageRow) => void;
  onDelete: (item: ConferenceMessageRow) => Promise<void>;
  onReact: (item: ConferenceMessageRow, emoji: string) => Promise<void>;
}

export function ConferenceMessageItem({
  item,
  currentUserId,
  canInteract,
  canDeleteAny,
  busy,
  onReply,
  onEdit,
  onDelete,
  onReact,
}: Props) {
  const own = item.user_id === currentUserId;
  const groupedReactions = item.reactions.reduce<Record<string, {
    count: number;
    own: boolean;
  }>>((acc, reaction) => {
    const current = acc[reaction.emoji] || { count: 0, own: false };
    acc[reaction.emoji] = {
      count: current.count + 1,
      own: current.own || reaction.user_id === currentUserId,
    };
    return acc;
  }, {});

  const timestamp = item.created_at
    ? new Date(item.created_at).toLocaleTimeString('fa-IR', {
      hour: '2-digit',
      minute: '2-digit',
    })
    : '';

  const fullTimestamp = item.created_at
    ? new Date(item.created_at).toLocaleString('fa-IR')
    : '';

  return (
    <article className={`rounded-xl px-3 py-2 text-sm ${
      own ? 'mr-8 bg-violet-600/40' : 'ml-8 bg-slate-800'
    }`}>
      <div className="mb-1 flex items-center justify-between gap-2">
        <strong className="truncate text-[10px] text-slate-300">
          {own ? 'شما' : item.display_name || 'کاربر'}
        </strong>
        <time
          className="shrink-0 text-[9px] text-slate-400"
          title={fullTimestamp}
        >
          {timestamp}
        </time>
      </div>

      {item.reply_to_id && (
        <div className="mb-2 rounded-lg border-r-2 border-violet-400 bg-slate-950/40 px-2 py-1.5">
          <div className="text-[9px] font-bold text-violet-300">
            پاسخ به {item.reply_to_name || 'پیام'}
          </div>
          <div className="mt-0.5 line-clamp-2 text-[10px] text-slate-400">
            {item.reply_to_body || 'پیام حذف شده است'}
          </div>
        </div>
      )}

      {item.is_deleted ? (
        <p className="italic text-slate-400">پیام حذف شده است</p>
      ) : (
        <>
          <p className="whitespace-pre-wrap break-words leading-6">{item.body}</p>

          {item.edited_at && (
            <div className="mt-1 text-[9px] text-slate-400">ویرایش شده</div>
          )}

          {Object.keys(groupedReactions).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(groupedReactions).map(([emoji, state]) => (
                <button
                  key={emoji}
                  type="button"
                  disabled={!canInteract || busy}
                  onClick={() => void onReact(item, emoji)}
                  className={`rounded-full border px-2 py-0.5 text-[10px] ${
                    state.own
                      ? 'border-violet-400 bg-violet-500/20'
                      : 'border-white/10 bg-slate-950/50'
                  }`}
                  aria-label={`واکنش ${emoji}`}
                >
                  {emoji} {state.count}
                </button>
              ))}
            </div>
          )}

          {canInteract && (
            <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-white/5 pt-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => onReply(item)}
                className="flex h-7 items-center gap-1 rounded-lg bg-slate-950/50 px-2 text-[9px] disabled:opacity-50"
              >
                <Reply className="h-3 w-3" />
                پاسخ
              </button>

              {own && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onEdit(item)}
                  className="flex h-7 items-center gap-1 rounded-lg bg-slate-950/50 px-2 text-[9px] disabled:opacity-50"
                >
                  <Pencil className="h-3 w-3" />
                  ویرایش
                </button>
              )}

              {(own || canDeleteAny) && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDelete(item)}
                  className="flex h-7 items-center gap-1 rounded-lg bg-rose-950/60 px-2 text-[9px] text-rose-200 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  {own ? 'حذف' : 'حذف مدیر'}
                </button>
              )}

              <div className="mr-auto flex gap-0.5">
                {QUICK_REACTIONS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    disabled={busy}
                    onClick={() => void onReact(item, emoji)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-white/10 disabled:opacity-50"
                    aria-label={`افزودن واکنش ${emoji}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </article>
  );
}
