import type { Dispatch, SetStateAction } from 'react';
import type { DraftDecision, DraftMeetingInfo } from './Form/types';
import type { MinutesStatus, DecisionStatus } from './types';

export const ADMIN_MINUTES_STATUSES: Record<MinutesStatus, string> = {
  draft: 'پیش‌نویس', pending_approval: 'در انتظار تأیید', changes_requested: 'نیازمند اصلاح',
  approved: 'تأییدشده', published: 'منتشرشده',
};
const decisionStatuses: Record<DecisionStatus, string> = {
  not_started: 'شروع‌نشده', planned: 'برنامه‌ریزی‌شده', in_progress: 'در حال انجام',
  waiting_coordination: 'در انتظار هماهنگی', waiting_approval: 'در انتظار تأیید',
  completed: 'تکمیل‌شده', stopped: 'متوقف‌شده',
};
const inputClass = 'w-full rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 p-2 text-sm dark:text-white';

export function AdminMinutesControls({ info, setInfo, decisions, setDecisions, reason, setReason, disabled }: {
  info: DraftMeetingInfo; setInfo: Dispatch<SetStateAction<DraftMeetingInfo>>;
  decisions: DraftDecision[]; setDecisions: Dispatch<SetStateAction<DraftDecision[]>>;
  reason: string; setReason: (value: string) => void; disabled: boolean;
}) {
  const setDecision = (id: string, patch: Partial<DraftDecision>) => setDecisions(rows => rows.map(d => d.id === id ? { ...d, ...patch } : d));
  return (
    <fieldset disabled={disabled} className="rounded-2xl border border-amber-200 bg-amber-50/50 dark:bg-gray-800 p-4 space-y-4">
      <legend className="font-bold text-amber-800 dark:text-amber-300 px-2">اصلاح مستقیم ادمین</legend>
      <p className="text-sm text-gray-600 dark:text-gray-300">تغییرات بدون تأیید مجدد اعمال می‌شوند. دلیل اصلاح و اطلاعات قبل و بعد در تاریخچه ثبت می‌شود. تأییدهای قبلی به نام اشخاص تغییر نمی‌کنند.</p>
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="space-y-1 text-sm dark:text-gray-200">وضعیت صورت‌جلسه
          <select className={inputClass} value={info.status} onChange={e => setInfo(p => ({ ...p, status: e.target.value as MinutesStatus }))}>
            {Object.entries(ADMIN_MINUTES_STATUSES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-sm dark:text-gray-200">دلیل اصلاح (الزامی)
          <textarea className={inputClass} rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="موضوع درخواست مدیران و علت اصلاح" required />
        </label>
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-medium dark:text-white">تغییر وضعیت و پیشرفت مصوبات</summary>
        <div className="space-y-3 mt-3">
          {decisions.filter(d => d.title.trim()).map(d => {
            const derived = !!d.decisionId && decisions.some(c => c.parentDecisionId === d.decisionId);
            return <div key={d.id} className="grid sm:grid-cols-3 gap-2 items-center border-b border-gray-200 dark:border-gray-700 pb-3">
              <span className="text-sm dark:text-gray-200">{d.title}{derived && <small className="block text-gray-500">وضعیت از بندهای مصوبه محاسبه می‌شود.</small>}</span>
              <label className="text-xs dark:text-gray-300">وضعیت
                <select aria-label={`وضعیت ${d.title}`} disabled={derived} className={inputClass} value={d.status ?? 'not_started'} onChange={e => {
                  const status = e.target.value as DecisionStatus;
                  setDecision(d.id, { status, progressPercent: status === 'completed' ? 100 : d.progressPercent ?? 0 });
                }}>{Object.entries(decisionStatuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              </label>
              <label className="text-xs dark:text-gray-300">درصد پیشرفت
                <input aria-label={`پیشرفت ${d.title}`} type="number" min={0} max={100} disabled={derived || d.status === 'completed'} className={inputClass}
                  value={d.progressPercent ?? 0} onChange={e => setDecision(d.id, { status: d.status ?? 'not_started', progressPercent: Number(e.target.value) })} />
              </label>
            </div>;
          })}
        </div>
      </details>
    </fieldset>
  );
}
