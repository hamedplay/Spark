import { Download, Image as ImageIcon, Share2, X } from 'lucide-react';
import { createPortal } from 'react-dom';

interface MeetingShareDialogProps {
  imageUrl: string;
  onClose: () => void;
  onShare: () => void | Promise<void>;
  onDownload: () => void;
}

export function MeetingShareDialog({ imageUrl, onClose, onShare, onDownload }: MeetingShareDialogProps) {
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-5"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="meeting-share-title"
      dir="rtl"
    >
      <div
        className="relative flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-3xl border border-slate-200/90 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)] dark:border-slate-700/80 dark:bg-slate-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="h-1 w-full flex-shrink-0 bg-gradient-to-l from-violet-500 via-cyan-500 to-emerald-500" />

        <div className="flex items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3.5 dark:border-slate-800 sm:px-5 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 via-cyan-500 to-emerald-500 text-white shadow-sm">
              <ImageIcon className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h3 id="meeting-share-title" className="text-sm font-bold text-slate-900 dark:text-white sm:text-base">پیش‌نمایش تصویر جلسه</h3>
              <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400 sm:text-xs">تصویر آماده است؛ دانلود کنید یا برای کاربر ارسال کنید.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200" aria-label="بستن پیش‌نمایش">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 p-3 sm:p-5">
          <div className="flex h-[52vh] min-h-[280px] max-h-[560px] items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-100/80 p-2 shadow-inner dark:border-slate-700 dark:bg-slate-950/70 sm:h-[58vh]">
            <img src={imageUrl} alt="پیش‌نمایش تصویر جلسه" className="h-full w-full rounded-xl object-contain" />
          </div>
        </div>

        <div className="border-t border-slate-200/80 bg-slate-50/80 p-3 dark:border-slate-800 dark:bg-slate-950/35 sm:p-4">
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={onShare} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-gradient-to-l from-violet-600 via-indigo-500 to-cyan-500 px-3 text-xs font-bold text-white shadow-[0_8px_22px_rgba(99,102,241,0.18)] transition hover:brightness-105 sm:text-sm">
              <Share2 className="h-4 w-4" /> اشتراک تصویر
            </button>
            <button type="button" onClick={onDownload} className="flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-emerald-500/30 dark:hover:bg-emerald-500/10 dark:hover:text-emerald-300 sm:text-sm">
              <Download className="h-4 w-4" /> دانلود PNG
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
