import { FileText, Eye, Upload } from 'lucide-react';
import type { DraftFinalization } from './types';
import { InputField, TextareaField, ComingSoonBanner } from './fields';

interface SectionFinalProps {
  finalization: DraftFinalization;
  setFinalization: React.Dispatch<React.SetStateAction<DraftFinalization>>;
}

export function SectionFinal({ finalization, setFinalization }: SectionFinalProps) {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        نهایی‌سازی
      </h2>
      <ComingSoonBanner message="نهایی‌سازی و انتشار در نسخه بعدی فعال خواهد شد. در این مرحله اطلاعات نهایی‌سازی ذخیره نمی‌شوند." />
      <div className="opacity-50 pointer-events-none">
        <FinalForm finalization={finalization} setFinalization={setFinalization} />
      </div>
    </div>
  );
}

function FinalForm({ finalization, setFinalization }: SectionFinalProps) {
  const update = (field: keyof DraftFinalization, value: string) =>
    setFinalization(prev => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        نسخه نهایی و امضا
      </h2>

      {/* Preview area */}
      <div className="border border-gray-200 dark:border-gray-600 rounded-2xl p-6 bg-gray-50 dark:bg-gray-700/20 min-h-48 flex flex-col items-center justify-center gap-2">
        <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600" />
        <p className="text-sm text-gray-500 dark:text-gray-400">پیش‌نمایش صورت‌جلسه</p>
        <button className="mt-2 flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium hover:bg-blue-100 transition-colors">
          <Eye className="w-4 h-4" />
          نمایش پیش‌نمایش
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">بارگذاری نسخه امضاشده</label>
          <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl p-4 text-center hover:border-blue-400 transition-colors">
            <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
            <p className="text-xs text-gray-500 dark:text-gray-400">بارگذاری واقعی در این مرحله فعال نیست</p>
          </div>
        </div>
        <InputField id="sign-date" label="تاریخ امضا" placeholder="۱۴۰۳/۰۵/۱۸" value={finalization.signDate} onChange={v => update('signDate', v)} />
        <InputField id="version-number" label="شماره نسخه" placeholder="۱.۰" value={finalization.versionNumber} onChange={v => update('versionNumber', v)} />
        <div className="sm:col-span-2">
          <TextareaField id="version-notes" label="توضیحات نسخه" rows={2} value={finalization.versionNotes} onChange={v => update('versionNotes', v)} />
        </div>
      </div>
    </div>
  );
}
