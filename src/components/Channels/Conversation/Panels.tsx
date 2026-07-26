import { Pin, Star, X, AtSign } from 'lucide-react';
import type { ChannelMessage, ChannelProfile, MessageWithMeta } from '../types';

export function PinnedPopup({ pinnedMsgs, privatePins, profiles, onScrollTo, onClose }: {
  pinnedMsgs: ChannelMessage[];
  privatePins: ChannelMessage[];
  profiles: ChannelProfile[];
  onScrollTo: (id: string) => void;
  onClose: () => void;
}) {
  const profileMap = new Map(profiles.map(p => [p.user_id, p]));
  const totalCount = pinnedMsgs.length + privatePins.length;

  return (
    <div className="absolute top-14 left-2 right-2 sm:left-4 sm:right-4 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-600 z-50 overflow-hidden max-h-72 flex flex-col" dir="rtl">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Pin className="w-4 h-4 text-amber-500" />
          <span className="text-sm font-semibold text-gray-700 dark:text-white">پیام‌های پین شده ({totalCount})</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded text-gray-400"><X className="w-4 h-4" /></button>
      </div>
      <div className="overflow-y-auto flex-1">
        {totalCount === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">پیام پین شده‌ای وجود ندارد</p>
        ) : (
          <>
            {pinnedMsgs.map(m => {
              const pinner = m.pinned_by ? profileMap.get(m.pinned_by) : null;
              return (
                <button key={m.id} onClick={() => { onScrollTo(m.id); onClose(); }}
                  className="w-full flex items-start gap-2 px-4 py-2.5 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-right transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                  <Pin className="w-3.5 h-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    {pinner && (
                      <p className="text-[10px] text-amber-600 dark:text-amber-400 mb-0.5">
                        پین شده توسط {pinner.full_name || pinner.email}
                      </p>
                    )}
                    <p className="text-xs text-gray-700 dark:text-gray-300 truncate">{m.body || '📎 فایل'}</p>
                  </div>
                </button>
              );
            })}
            {privatePins.map(m => (
              <button key={`priv-${m.id}`} onClick={() => { onScrollTo(m.id); onClose(); }}
                className="w-full flex items-start gap-2 px-4 py-2.5 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-right transition-colors border-b border-gray-50 dark:border-gray-700/50 last:border-0">
                <Pin className="w-3.5 h-3.5 text-blue-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-blue-500 dark:text-blue-400 mb-0.5">پین خصوصی</p>
                  <p className="text-xs text-gray-700 dark:text-gray-300 truncate">{m.body || '📎 فایل'}</p>
                </div>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

export function StarredPanel({ starredMsgs, onScrollTo, onClose }: {
  starredMsgs: MessageWithMeta[];
  onScrollTo: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 z-[70]" onClick={onClose} dir="rtl">
      <div className="absolute inset-y-0 left-0 w-full max-w-sm bg-white dark:bg-gray-900 shadow-2xl flex flex-col"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
            <h3 className="text-base font-bold dark:text-white">پیام‌های نشان‌دار</h3>
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">{starredMsgs.length}</span>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"><X className="w-5 h-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {starredMsgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3">
              <Star className="w-10 h-10 text-gray-300 dark:text-gray-600" />
              <p className="text-sm text-gray-400">پیام نشان‌داری وجود ندارد</p>
            </div>
          ) : (
            starredMsgs.map(m => (
              <button key={m.id} onClick={() => { onScrollTo(m.id); onClose(); }}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-yellow-50 dark:hover:bg-yellow-900/10 text-right transition-colors border-b border-gray-50 dark:border-gray-800">
                <Star className="w-4 h-4 text-yellow-400 fill-yellow-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{m.senderProfile?.full_name || m.senderProfile?.email || 'کاربر'}</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300 truncate">{m.body || '📎 فایل'}</p>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function ChannelMentionsBar({
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
      className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-teal-50 dark:bg-teal-900/20 border-t border-teal-200 dark:border-teal-800"
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
          className="text-[10px] text-teal-500 hover:text-teal-700 flex-shrink-0"
        >
          همه
        </button>
      )}
    </div>
  );
}
