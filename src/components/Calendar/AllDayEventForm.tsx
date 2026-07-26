import { X } from 'lucide-react';
import { JALAALI_MONTHS } from './utils';

function AllDayEventForm({
  formDate, formEndDate, title, type, currentUserId,
  onTitleChange, onTypeChange, onSave, onClose,
}: {
  formDate: { jy: number; jm: number; jd: number };
  formEndDate: { jy: number; jm: number; jd: number } | null;
  title: string;
  type: 'meeting' | 'leave' | 'other';
  currentUserId: string | null;
  onTitleChange: (v: string) => void;
  onTypeChange: (v: 'meeting' | 'leave' | 'other') => void;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[65] flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-900 rounded-2xl shadow-xl w-full max-w-xs overflow-hidden border border-gray-200 dark:border-gray-700">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <span className="text-sm font-semibold text-gray-800 dark:text-white">رویداد کل‌روز</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3">
          <div className="text-xs text-gray-500 dark:text-gray-400">
            {formEndDate && (formEndDate.jy !== formDate.jy || formEndDate.jm !== formDate.jm || formEndDate.jd !== formDate.jd)
              ? `${formDate.jd} ${JALAALI_MONTHS[formDate.jm - 1]} تا ${formEndDate.jd} ${JALAALI_MONTHS[formEndDate.jm - 1]} ${formDate.jy}`
              : `${formDate.jd} ${JALAALI_MONTHS[formDate.jm - 1]} ${formDate.jy}`
            }
          </div>

          <div className="flex gap-1.5">
            {[{ v: 'meeting', l: 'جلسه' }, { v: 'leave', l: 'مرخصی' }, { v: 'other', l: 'سایر' }].map(opt => (
              <button key={opt.v} type="button" onClick={() => onTypeChange(opt.v as any)}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg border transition-colors ${type === opt.v
                  ? opt.v === 'leave' ? 'bg-orange-100 border-orange-300 text-orange-700 dark:bg-orange-900/30 dark:border-orange-600 dark:text-orange-300'
                    : opt.v === 'meeting' ? 'bg-sky-100 border-sky-300 text-sky-700 dark:bg-sky-900/30 dark:border-sky-600 dark:text-sky-300'
                      : 'bg-gray-100 border-gray-300 text-gray-700 dark:bg-gray-700 dark:border-gray-500 dark:text-gray-300'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300 dark:hover:border-gray-600'}`}>
                {opt.l}
              </button>
            ))}
          </div>

          <input autoFocus type="text" value={title} onChange={e => onTitleChange(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && title.trim() && currentUserId) onSave(); }}
            placeholder="عنوان رویداد..."
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 dark:focus:ring-sky-600 placeholder-gray-300 dark:placeholder-gray-600" />

          <button
            onClick={onSave}
            disabled={!title.trim()}
            className="w-full py-2 text-sm font-semibold rounded-lg transition-colors bg-gray-800 hover:bg-gray-700 dark:bg-gray-100 dark:hover:bg-white text-white dark:text-gray-900 disabled:opacity-40 disabled:cursor-not-allowed">
            ذخیره
          </button>
        </div>
      </div>
    </div>
  );
}

export { AllDayEventForm };
