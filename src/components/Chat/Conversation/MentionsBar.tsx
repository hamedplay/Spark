import { AtSign, X } from 'lucide-react';

export function MentionsBar({
  items,
  onScrollTo,
  onDismiss,
  onDismissAll,
}: {
  items: { id: string; body: string | null; senderName: string }[];
  onScrollTo: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}) {
  const current = items[0];
  return (
    <div
      className="flex flex-shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50/90 px-3 py-1.5 dark:border-amber-500/20 dark:bg-amber-500/10"
      dir="rtl"
    >
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500 shadow-sm">
        <AtSign className="h-3.5 w-3.5 text-white" />
      </div>
      <button
        onClick={() => { onScrollTo(current.id); onDismiss(current.id); }}
        className="min-w-0 flex-1 text-right"
      >
        <span className="block truncate text-[10px] font-bold text-amber-800 dark:text-amber-200">
          {current.senderName} شما را منشن کرد
        </span>
        {current.body && (
          <span className="block truncate text-[9px] leading-tight text-amber-700/75 dark:text-amber-300/75">
            {current.body.slice(0, 80)}
          </span>
        )}
      </button>
      {items.length > 1 && (
        <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[8px] font-bold text-white">
          {items.length.toLocaleString('fa-IR')}
        </span>
      )}
      <button
        onClick={() => { onScrollTo(current.id); onDismiss(current.id); }}
        className="flex-shrink-0 text-[9px] font-bold text-amber-700 hover:text-amber-900 dark:text-amber-300 dark:hover:text-amber-200"
      >
        مشاهده
      </button>
      <button
        onClick={() => onDismiss(current.id)}
        title="بستن این منشن"
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-amber-600 transition hover:bg-amber-100 hover:text-amber-800 dark:text-amber-300 dark:hover:bg-amber-500/15"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      {items.length > 1 && (
        <button
          onClick={onDismissAll}
          title="بستن همه"
          className="flex-shrink-0 text-[8px] text-amber-600 hover:text-amber-800 dark:text-amber-400"
        >
          همه
        </button>
      )}
    </div>
  );
}