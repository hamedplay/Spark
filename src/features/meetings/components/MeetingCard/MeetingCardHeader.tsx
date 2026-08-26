import type { RefObject } from 'react';
import { CreditCard as Edit2, Share2, UserPlus, CalendarPlus, RefreshCw, TriangleAlert as AlertTriangle, Trash2, Image, FileText } from 'lucide-react';
import type { Meeting } from '../../../../types';

interface MeetingCardHeaderProps {
  meeting: Meeting;
  loading: boolean;
  showShareMenu: boolean;
  shareMenuRef: RefObject<HTMLDivElement | null>;
  canAddToGoogleCalendar: boolean;
  onResend: () => Promise<void>;
  onEdit: () => void;
  onEditAndResend: () => void;
  onOpenUserSelector: () => void;
  onToggleShareMenu: () => void;
  onShareImage: () => Promise<void>;
  onShareText: () => Promise<void>;
  onSendToTelegram: () => Promise<void>;
  onAddToGoogleCalendar: () => void;
  onDelete: () => void;
}

const priorityColors = {
  high: 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300',
  medium: 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-300',
  low: 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300',
};

const statusTypeColors = {
  requested: 'border border-amber-200 bg-amber-100/80 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200',
  approved: 'border border-emerald-200 bg-emerald-100/80 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/15 dark:text-emerald-200',
  rejected: 'border border-rose-200 bg-rose-100 text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/20 dark:text-rose-200',
};

const iconButtonClass = 'inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border transition-all hover:-translate-y-px disabled:opacity-40';

export function MeetingCardHeader({
  meeting,
  loading,
  showShareMenu,
  shareMenuRef,
  canAddToGoogleCalendar,
  onResend,
  onEdit,
  onEditAndResend,
  onOpenUserSelector,
  onToggleShareMenu,
  onShareImage,
  onShareText,
  onAddToGoogleCalendar,
  onDelete,
}: MeetingCardHeaderProps) {
  const priorityLabel = meeting.priority === 'high' ? 'بالا' : meeting.priority === 'medium' ? 'متوسط' : 'پایین';
  const statusLabel = meeting.status_type === 'requested' ? 'درخواست‌شده' : meeting.status_type === 'rejected' ? 'ردشده' : 'تأییدشده';

  return (
    <>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold sm:text-[10px] ${priorityColors[meeting.priority]}`}
            title={`اولویت ${priorityLabel}`}
          >
            اولویت {priorityLabel}
          </span>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[9px] font-bold sm:text-[10px] ${statusTypeColors[meeting.status_type] ?? 'border border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${meeting.status_type === 'rejected' ? 'bg-rose-500' : meeting.status_type === 'requested' ? 'bg-amber-500' : 'bg-emerald-500'}`} />
            {statusLabel}
          </span>
        </div>

        {meeting.status === 'open' && (
          <div className="flex max-w-full flex-wrap items-center justify-end gap-1.5">
            {meeting.status_type === 'rejected' && (
              <>
                <button
                  onClick={onResend}
                  disabled={loading}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2 text-[9px] font-bold text-rose-700 transition hover:bg-rose-100 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300 dark:hover:bg-rose-500/20"
                  title="ارسال مجدد دعوت‌نامه"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">ارسال مجدد</span>
                </button>
                <button
                  onClick={onEditAndResend}
                  disabled={loading}
                  className="inline-flex h-8 items-center justify-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2 text-[9px] font-bold text-amber-700 transition hover:bg-amber-100 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/20"
                  title="ویرایش و ارسال مجدد"
                >
                  <Edit2 className="h-3.5 w-3.5" />
                  <span className="hidden xl:inline">ویرایش و ارسال</span>
                </button>
              </>
            )}

            <button onClick={onOpenUserSelector} className={`${iconButtonClass} border-violet-100 bg-violet-50 text-violet-600 hover:bg-violet-100 dark:border-violet-500/20 dark:bg-violet-500/10 dark:text-violet-300`} title="ارسال به کاربران" aria-label="ارسال به کاربران">
              <UserPlus className="h-4 w-4" />
            </button>

            <div ref={shareMenuRef} className="relative flex-shrink-0">
              <button onClick={onToggleShareMenu} className={`${iconButtonClass} border-cyan-100 bg-cyan-50 text-cyan-600 hover:bg-cyan-100 dark:border-cyan-500/20 dark:bg-cyan-500/10 dark:text-cyan-300`} title="اشتراک‌گذاری" aria-label="اشتراک‌گذاری">
                <Share2 className="h-4 w-4" />
              </button>
              {showShareMenu && (
                <div className="absolute left-0 top-full z-50 mt-1.5 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900" dir="rtl">
                  <button onClick={onShareImage} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-right hover:bg-slate-50 dark:hover:bg-slate-800">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-100 dark:bg-indigo-500/15">
                      <Image className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-300" />
                    </div>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">اشتراک تصویر</span>
                  </button>
                  <div className="mx-3 border-t border-slate-100 dark:border-slate-800" />
                  <button onClick={onShareText} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-right hover:bg-slate-50 dark:hover:bg-slate-800">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-500/15">
                      <FileText className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-300" />
                    </div>
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">اشتراک متن</span>
                  </button>
                </div>
              )}
            </div>

            {meeting.status_type !== 'rejected' && (
              <button onClick={onEdit} className={`${iconButtonClass} border-indigo-100 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 dark:border-indigo-500/20 dark:bg-indigo-500/10 dark:text-indigo-300`} title="ویرایش" aria-label="ویرایش">
                <Edit2 className="h-4 w-4" />
              </button>
            )}

            {canAddToGoogleCalendar && (
              <button onClick={onAddToGoogleCalendar} className={`${iconButtonClass} border-emerald-100 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300`} title="افزودن به تقویم گوگل" aria-label="افزودن به تقویم گوگل">
                <CalendarPlus className="h-4 w-4" />
              </button>
            )}

            <button onClick={onDelete} disabled={loading} className={`${iconButtonClass} border-rose-100 bg-rose-50 text-rose-500 hover:bg-rose-100 dark:border-rose-500/20 dark:bg-rose-500/10 dark:text-rose-300`} title="حذف جلسه" aria-label="حذف جلسه">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      <h3 className="mb-2 line-clamp-2 text-[15px] font-bold leading-6 text-slate-900 dark:text-white sm:text-base">{meeting.subject}</h3>

      {meeting.status_type === 'rejected' && (
        <div className="mb-2.5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-2 dark:border-rose-500/30 dark:bg-rose-500/10">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-500 dark:text-rose-300" />
          <p className="line-clamp-2 text-[10px] font-bold leading-5 text-rose-700 dark:text-rose-300">
            یک یا چند شرکت‌کننده این دعوت را رد کرده‌اند. می‌توانید مجدداً ارسال یا ابتدا جلسه را ویرایش کنید.
          </p>
        </div>
      )}
    </>
  );
}
