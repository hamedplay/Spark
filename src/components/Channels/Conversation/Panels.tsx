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
    <div className="absolute left-2 right-2 top-12 z-50 flex max-h-72 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:left-3 sm:right-3" dir="rtl">
      <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-3 py-2 dark:border-slate-800">
        <div className="flex items-center gap-1.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300">
            <Pin className="h-3.5 w-3.5" />
          </div>
          <span className="text-xs font-bold text-slate-700 dark:text-white">پیام‌های پین شده</span>
          <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{totalCount.toLocaleString('fa-IR')}</span>
        </div>
        <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-3.5 w-3.5" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {totalCount === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">پیام پین شده‌ای وجود ندارد</p>
        ) : (
          <>
            {pinnedMsgs.map(m => {
              const pinner = m.pinned_by ? profileMap.get(m.pinned_by) : null;
              return (
                <button key={m.id} onClick={() => { onScrollTo(m.id); onClose(); }}
                  className="flex w-full items-start gap-2 border-b border-slate-50 px-3 py-2 text-right transition hover:bg-amber-50/60 dark:border-slate-800 dark:hover:bg-amber-500/10">
                  <Pin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-amber-500" />
                  <div className="min-w-0 flex-1">
                    {pinner && <p className="mb-0.5 text-[9px] text-amber-600 dark:text-amber-300">پین شده توسط {pinner.full_name || pinner.email}</p>}
                    <p className="truncate text-[11px] text-slate-700 dark:text-slate-300">{m.body || '📎 فایل'}</p>
                  </div>
                </button>
              );
            })}
            {privatePins.map(m => (
              <button key={`priv-${m.id}`} onClick={() => { onScrollTo(m.id); onClose(); }}
                className="flex w-full items-start gap-2 border-b border-slate-50 px-3 py-2 text-right transition hover:bg-indigo-50/60 dark:border-slate-800 dark:hover:bg-indigo-500/10">
                <Pin className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-indigo-500" />
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 text-[9px] text-indigo-600 dark:text-indigo-300">پین خصوصی</p>
                  <p className="truncate text-[11px] text-slate-700 dark:text-slate-300">{m.body || '📎 فایل'}</p>
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
    <div className="fixed inset-0 z-[70] bg-black/45" onClick={onClose} dir="rtl">
      <div className="absolute inset-y-0 left-0 flex w-full max-w-sm flex-col bg-white shadow-2xl dark:bg-slate-950" onClick={e => e.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-yellow-50 text-yellow-500 dark:bg-yellow-500/10 dark:text-yellow-300">
              <Star className="h-4 w-4 fill-current" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">پیام‌های نشان‌دار</h3>
              <p className="text-[9px] text-slate-400">{starredMsgs.length.toLocaleString('fa-IR')} پیام</p>
            </div>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {starredMsgs.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-16">
              <Star className="h-9 w-9 text-slate-200 dark:text-slate-700" />
              <p className="text-xs text-slate-400">پیام نشان‌داری وجود ندارد</p>
            </div>
          ) : (
            starredMsgs.map(m => (
              <button key={m.id} onClick={() => { onScrollTo(m.id); onClose(); }}
                className="flex w-full items-start gap-2.5 border-b border-slate-50 px-3 py-2.5 text-right transition hover:bg-yellow-50/60 dark:border-slate-800 dark:hover:bg-yellow-500/10">
                <Star className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 fill-yellow-400 text-yellow-400" />
                <div className="min-w-0 flex-1">
                  <p className="mb-0.5 text-[9px] text-slate-400">{m.senderProfile?.full_name || m.senderProfile?.email || 'کاربر'}</p>
                  <p className="truncate text-xs text-slate-700 dark:text-slate-300">{m.body || '📎 فایل'}</p>
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
    <div className="flex flex-shrink-0 items-center gap-2 border-t border-amber-200 bg-amber-50/95 px-2.5 py-1.5 dark:border-amber-500/25 dark:bg-amber-500/10" dir="rtl">
      <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white shadow-sm">
        <AtSign className="h-3.5 w-3.5" />
      </div>
      <button onClick={() => { onScrollTo(current.id); onDismiss(current.id); }} className="min-w-0 flex-1 text-right">
        <span className="block truncate text-[10px] font-bold text-amber-800 dark:text-amber-200">
          {current.senderName} شما را منشن کرد
        </span>
        {current.body && <span className="block truncate text-[9px] text-amber-700/80 dark:text-amber-300/80">{current.body.slice(0, 80)}</span>}
      </button>
      {items.length > 1 && (
        <span className="flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded-full bg-amber-500 px-1.5 text-[8px] font-bold text-white">
          {items.length.toLocaleString('fa-IR')}
        </span>
      )}
      <button onClick={() => { onScrollTo(current.id); onDismiss(current.id); }} className="flex-shrink-0 rounded-lg border border-amber-200 bg-white/80 px-2 py-1 text-[9px] font-bold text-amber-700 hover:bg-white dark:border-amber-500/25 dark:bg-slate-900/60 dark:text-amber-300">رفتن</button>
      <button onClick={() => onDismiss(current.id)} title="بستن این منشن" className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-lg text-amber-600 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/10"><X className="h-3.5 w-3.5" /></button>
      {items.length > 1 && (
        <button onClick={onDismissAll} className="hidden flex-shrink-0 text-[9px] text-amber-600 hover:underline sm:block dark:text-amber-300">همه</button>
      )}
    </div>
  );
}
