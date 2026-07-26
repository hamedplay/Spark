import { Bell, Loader as Loader2 } from 'lucide-react';
import { FIELD_LABELS } from '../../lib/meetingEditDiff';
import type { CommitSnapshot } from './types';
import type { MeetingChangeSet } from '../../lib/meetingEditDiff';

export function EditDecisionModal(props: {
  editDecision: { changeSet: MeetingChangeSet; snapshot: CommitSnapshot } | null;
  committing: boolean;
  commitEdit: (snapshot: CommitSnapshot, notifyExistingParticipants: boolean) => void;
  setEditDecision: (v: null) => void;
}) {
  const { editDecision, committing, commitEdit, setEditDecision } = props;
  if (!editDecision) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-gray-800 shadow-2xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/20">
          <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center flex-shrink-0">
            <Bell className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-800 dark:text-white">ثبت تغییرات جلسه</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">تغییراتی در اطلاعات یا اعضای جلسه ایجاد شده است. نحوه ثبت تغییرات را انتخاب کنید.</p>
          </div>
        </div>
        <div className="px-5 py-4 space-y-3 max-h-[60vh] overflow-y-auto">
          {editDecision.changeSet.importantFields.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-red-600 dark:text-red-400 mb-1">تغییرات مهم</p>
              <ul className="text-xs text-gray-700 dark:text-gray-300 list-disc pr-4 space-y-0.5">
                {editDecision.changeSet.importantFields.map(f => <li key={f}>{FIELD_LABELS[f] || f}</li>)}
              </ul>
            </div>
          )}
          {editDecision.changeSet.minorFields.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">تغییرات جزئی</p>
              <ul className="text-xs text-gray-700 dark:text-gray-300 list-disc pr-4 space-y-0.5">
                {editDecision.changeSet.minorFields.map(f => <li key={f}>{FIELD_LABELS[f] || f}</li>)}
              </ul>
            </div>
          )}
          {editDecision.changeSet.participantChanged && (
            <p className="text-xs text-blue-600 dark:text-blue-400">تغییر در فهرست شرکت‌کنندگان</p>
          )}
          {editDecision.changeSet.notifyUsersChanged && (
            <p className="text-xs text-blue-600 dark:text-blue-400">تغییر در فهرست مطلعین</p>
          )}
          {editDecision.changeSet.externalChanged && (
            <p className="text-xs text-blue-600 dark:text-blue-400">تغییر در فهرست شرکت‌کنندگان خارجی</p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-100 dark:border-gray-700">
            در حالت ثبت با اطلاع‌رسانی، افراد اضافه‌شده دعوت‌نامه، افراد حذف‌شده پیام لغو دعوت و اعضای باقی‌مانده در صورت تغییر اطلاعات جلسه پیام تغییر دریافت می‌کنند. در حالت ثبت بدون اطلاع‌رسانی، تغییرات فقط در سامانه ذخیره می‌شوند و هیچ پیامی ارسال نخواهد شد.
          </p>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={() => commitEdit(editDecision.snapshot, true)}
            disabled={committing}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95 bg-teal-600 text-white hover:bg-teal-700"
          >
            {committing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Bell className="w-4 h-4" />}
            ثبت تغییرات با اطلاع‌رسانی
          </button>
          <button
            onClick={() => commitEdit(editDecision.snapshot, false)}
            disabled={committing}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50 active:scale-95 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
          >
            ثبت تغییرات بدون اطلاع‌رسانی
          </button>
          <button
            onClick={() => setEditDecision(null)}
            disabled={committing}
            className="w-full py-2.5 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors disabled:opacity-50"
          >
            بازگشت به ویرایش
          </button>
        </div>
      </div>
    </div>
  );
}
