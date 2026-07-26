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
      className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-teal-50 dark:bg-teal-900/20 border-b border-teal-200 dark:border-teal-800"
      dir="rtl"
    >
      <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0">
        <AtSign className="w-3.5 h-3.5 text-white" />
      </div>
      <button
        onClick={() => { onScrollTo(current.id); onDismiss(current.id); }}
        className="flex-1 min-w-0 text-right"
      >
        <span className="text-xs font-semibold text-teal-700 dark:text-teal-300 truncate block">
          {current.senderName} شما را منشن کرد
        </span>
        {current.body && (
          <span className="text-[11px] text-teal-600/80 dark:text-teal-400/80 truncate block leading-tight">
            {current.body.slice(0, 80)}
          </span>
        )}
      </button>
      {items.length > 1 && (
        <span className="text-[10px] text-teal-600 dark:text-teal-400 font-semibold bg-teal-100 dark:bg-teal-900/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
          {items.length}
        </span>
      )}
      <button
        onClick={() => { onScrollTo(current.id); onDismiss(current.id); }}
        className="text-[11px] text-teal-700 dark:text-teal-300 font-semibold hover:underline flex-shrink-0"
      >
        رفتن
      </button>
      <button
        onClick={() => onDismiss(current.id)}
        title="بستن این منشن"
        className="p-1 text-teal-500 hover:text-teal-700 flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      {items.length > 1 && (
        <button
          onClick={onDismissAll}
          title="بستن همه"
          className="text-[10px] text-teal-500 hover:text-teal-700 flex-shrink-0"
        >
          همه
        </button>
      )}
    </div>
  );
}
