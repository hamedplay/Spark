import { Pencil, Reply, Trash2 } from 'lucide-react';
import type { ConferenceModeratorMessageRow } from '../../types/conference.types';

interface Props {
  item: ConferenceModeratorMessageRow;
  currentUserId: string;
  busy: boolean;
  onReply: (item: ConferenceModeratorMessageRow) => void;
  onEdit: (item: ConferenceModeratorMessageRow) => void;
  onDelete: (item: ConferenceModeratorMessageRow) => Promise<void>;
}

export function ConferenceModeratorMessageItem({
  item,
  currentUserId,
  busy,
  onReply,
  onEdit,
  onDelete,
}: Props) {
  const own = item.sender_id === currentUserId;
  const timestamp = new Date(item.created_at).toLocaleTimeString('fa-IR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const fullTimestamp = new Date(item.created_at).toLocaleString('fa-IR');

  return (
    <article
      className={`rounded-xl px-3 py-2 text-sm ${
        own ? 'mr-8 bg-amber-600/30' : 'ml-8 bg-slate-800'
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <strong className="truncate text-[10px] text-slate-300">
          {own ? 'شما' : item.sender_name || 'مدیر جلسه'}
        </strong>
        <time
          className="shrink-0 text-[9px] text-slate-400"
          title={fullTimestamp}
        >
          {timestamp}
        </time>
      </div>

      {item.reply_to_id && (
        <div className="mb-2 rounded-lg border-r-2 border-amber-400 bg-slate-950/40 px-2 py-1.5">
          <div className="text-[9px] font-bold text-amber-300">
            پاسخ به {item.reply_to_sender_name || 'پیام'}
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

          <div className="mt-2 flex items-center gap-1 border-t border-white/5 pt-2">
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
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onEdit(item)}
                  className="flex h-7 items-center gap-1 rounded-lg bg-slate-950/50 px-2 text-[9px] disabled:opacity-50"
                >
                  <Pencil className="h-3 w-3" />
                  ویرایش
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void onDelete(item)}
                  className="flex h-7 items-center gap-1 rounded-lg bg-rose-950/60 px-2 text-[9px] text-rose-200 disabled:opacity-50"
                >
                  <Trash2 className="h-3 w-3" />
                  حذف
                </button>
              </>
            )}
          </div>
        </>
      )}
    </article>
  );
}
