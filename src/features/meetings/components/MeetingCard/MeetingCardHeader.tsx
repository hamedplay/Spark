import type { RefObject } from 'react';
import { CreditCard as Edit2, Send, Share2, UserPlus, CalendarPlus, RefreshCw, TriangleAlert as AlertTriangle, Trash2, Image, FileText } from 'lucide-react';
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
  high: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  medium: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  low: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
};

const statusTypeColors = {
  requested: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

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
  onSendToTelegram,
  onAddToGoogleCalendar,
  onDelete,
}: MeetingCardHeaderProps) {
  return (
    <>
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${priorityColors[meeting.priority]}`}>
            {meeting.priority === 'high' ? 'اولویت بالا' : meeting.priority === 'medium' ? 'اولویت متوسط' : 'اولویت پایین'}
          </span>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${statusTypeColors[meeting.status_type] ?? 'bg-gray-100 text-gray-800'}`}>
            {meeting.status_type === 'requested' ? 'درخواست شده' : meeting.status_type === 'rejected' ? 'رد شده توسط شرکت‌کننده' : 'تایید شده'}
          </span>
        </div>

        <div className="flex items-center gap-1 action-buttons">
          {meeting.status === 'open' && (
            <>
              {meeting.status_type === 'rejected' && (
                <>
                  <button
                    onClick={onResend}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-lg transition-colors disabled:opacity-50"
                    title="ارسال مجدد دعوت‌نامه"
                  >
                    <RefreshCw className="w-4 h-4" />
                    ارسال مجدد
                  </button>
                  <button
                    onClick={onEditAndResend}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 rounded-lg transition-colors disabled:opacity-50"
                    title="ویرایش و ارسال مجدد"
                  >
                    <Edit2 className="w-4 h-4" />
                    ویرایش و ارسال
                  </button>
                </>
              )}
              <button onClick={onOpenUserSelector} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors" title="ارسال به کاربران">
                <UserPlus className="w-5 h-5" />
              </button>
              <div ref={shareMenuRef} className="relative">
                <button
                  onClick={onToggleShareMenu}
                  className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors"
                  title="اشتراک‌گذاری"
                >
                  <Share2 className="w-5 h-5" />
                </button>
                {showShareMenu && (
                  <div className="absolute left-0 top-full mt-1.5 w-44 bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden" dir="rtl">
                    <button
                      onClick={onShareImage}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                    >
                      <div className="w-8 h-8 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                        <Image className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">اشتراک‌گذاری تصویر</span>
                    </button>
                    <div className="mx-3 border-t border-gray-100 dark:border-gray-700" />
                    <button
                      onClick={onShareText}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-right"
                    >
                      <div className="w-8 h-8 rounded-xl bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0">
                        <FileText className="w-4 h-4 text-green-600 dark:text-green-400" />
                      </div>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-200">اشتراک‌گذاری متن</span>
                    </button>
                  </div>
                )}
              </div>
              <button onClick={onSendToTelegram} disabled={loading || meeting.status_type !== 'requested'} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 disabled:opacity-50 transition-colors" title="ارسال به مدیر">
                <Send className="w-5 h-5" />
              </button>
              {meeting.status_type !== 'rejected' && (
                <button onClick={onEdit} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors" title="ویرایش">
                  <Edit2 className="w-5 h-5" />
                </button>
              )}
              {canAddToGoogleCalendar && (
                <button onClick={onAddToGoogleCalendar} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors" title="افزودن به تقویم گوگل">
                  <CalendarPlus className="w-5 h-5" />
                </button>
              )}
              <button onClick={onDelete} disabled={loading} className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors" title="حذف جلسه">
                <Trash2 className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </div>

      <h3 className="text-xl font-semibold mb-4 dark:text-white">{meeting.subject}</h3>

      {meeting.status_type === 'rejected' && (
        <div className="mb-4 flex items-start gap-2 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-400">
            یک یا چند شرکت‌کننده این دعوت را رد کرده‌اند. می‌توانید دعوت‌نامه را مجدداً ارسال کنید یا ابتدا جلسه را ویرایش نمایید.
          </p>
        </div>
      )}
    </>
  );
}
