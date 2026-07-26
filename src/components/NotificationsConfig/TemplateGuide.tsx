import { useState } from 'react';
import { Info, ChevronDown } from 'lucide-react';
import {
  TEMPLATE_PLACEHOLDERS as ALL_PLACEHOLDERS,
} from '../../config/templateCatalog';

export function TemplateGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <Info className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">راهنمای استفاده از قالب‌های اعلان</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-amber-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-amber-200 dark:border-amber-700 pt-4">
          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
            در عنوان و متن اعلان می‌توانید از متغیرهای زیر استفاده کنید. هنگام ارسال، سیستم این متغیرها را با مقدار واقعی جایگزین می‌کند. برای درج متغیر بنویسید:
            <code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5 mx-1 rounded text-amber-800 dark:text-amber-200">{'{{نام_متغیر}}'}</code>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ALL_PLACEHOLDERS.map(p => (
              <div key={p.key} className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-xl px-3 py-2">
                <code className="text-xs font-mono text-amber-600 dark:text-amber-400 flex-shrink-0">{`{{${p.key}}}`}</code>
                <span className="text-xs text-gray-400">←</span>
                <span className="text-xs text-gray-700 dark:text-gray-300">{p.label}</span>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-amber-100 dark:border-amber-800">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">نمونه اعلان:</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 font-semibold">{'عنوان: دعوت به جلسه «{{meeting_subject}}»'}</p>
            <p className="text-xs font-mono text-gray-600 dark:text-gray-400 leading-relaxed">
              {'شما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} دعوت شده‌اید.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
