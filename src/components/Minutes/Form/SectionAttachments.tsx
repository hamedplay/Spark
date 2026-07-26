import { Paperclip } from 'lucide-react';
import { ComingSoonBanner } from './fields';

export function SectionAttachments() {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        پیوست‌ها
      </h2>
      <ComingSoonBanner message="آپلود پیوست در نسخه بعدی فعال خواهد شد." />
      <div className="border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-2xl p-10 text-center opacity-50 pointer-events-none">
        <Paperclip className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
        <p className="text-sm text-gray-400 dark:text-gray-500">آپلود فایل در نسخه بعدی</p>
      </div>
    </div>
  );
}
