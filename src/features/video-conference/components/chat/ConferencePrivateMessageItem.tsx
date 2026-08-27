import { Check, CheckCheck, Pencil, Reply, Trash2 } from 'lucide-react';
import type { ConferencePrivateMessageRow } from '../../types/conference.types';

interface Props {
  item: ConferencePrivateMessageRow;
  currentUserId: string;
  busy: boolean;
  onReply: (item: ConferencePrivateMessageRow) => void;
  onEdit: (item: ConferencePrivateMessageRow) => void;
  onDelete: (item: ConferencePrivateMessageRow) => Promise<void>;
}

export function ConferencePrivateMessageItem({
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
        own ? 'mr-8 bg-violet-600/40' : 'ml-8 bg-slate-800'
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <strong className="truncate text-[10px] text-slate-300">
          {own ? 'شما' : item.sender_name || 'کاربر'}
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

          <div className="mt-1 flex items-center gap-2 text-[9px] text-slate-400">
            {item.edited_at && <span>ویرایش شده</span>}
            {own && (
              <span className="mr-auto flex items-center gap-1">
                {item.read_at ? (
                  <>
                    <CheckCheck className="h-3 w-3 text-violet-300" />
                    خوانده شد
                  </>
                ) : (
                  <>
                    <Check className="h-3 w-3" />
                    ارسال شد
                  </>
                )}
              </span>
            )}
          </div>

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
