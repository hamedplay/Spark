import { AttachmentManager } from '../Shared/AttachmentManager';

export interface SectionAttachmentsProps {
  minuteId: string | null;
  canManage: boolean;
}

export function SectionAttachments({ minuteId, canManage }: SectionAttachmentsProps) {
  if (!minuteId) {
    return (
      <div className="space-y-5" dir="rtl">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
          پیوست‌ها
        </h2>
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-400">
          برای بارگذاری پیوست ابتدا باید پیش‌نویس صورت‌جلسه ذخیره شود. روی «ذخیره پیش‌نویس» کلیک کنید تا صورت‌جلسه ایجاد شود.
        </div>
      </div>
    );
  }
  return <AttachmentManager minuteId={minuteId} canManage={canManage} />;
}
