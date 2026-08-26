import { ArrowRight, FileText, CircleAlert as AlertCircle } from 'lucide-react';
import { EmptyState, TableSkeleton } from '../MinutesShared';

export function DetailLoadingView() {
  return (
    <div dir="rtl" className="space-y-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <TableSkeleton rows={3} />
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <TableSkeleton rows={5} />
      </div>
    </div>
  );
}

export function DetailErrorView({ error }: { error: string }) {
  return (
    <div dir="rtl" className="space-y-4">
      <EmptyState
        icon={<AlertCircle className="w-8 h-8" />}
        title="خطا در بارگذاری صورت‌جلسه"
        description={error}
      />
    </div>
  );
}

export function DetailNotFoundView({ onNavigate }: { onNavigate: (page: string) => void }) {
  return (
    <div dir="rtl" className="space-y-4">
      <EmptyState
        icon={<FileText className="w-8 h-8" />}
        title="صورت‌جلسه‌ای یافت نشد"
        description="این صورت‌جلسه وجود ندارد، حذف شده است، یا شما دسترسی مشاهده آن را ندارید."
        action={
          <button
            onClick={() => onNavigate('minutes')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            بازگشت به لیست
          </button>
        }
      />
    </div>
  );
}
