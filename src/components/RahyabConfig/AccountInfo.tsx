import { TriangleAlert as AlertTriangle } from 'lucide-react';

export function AccountInfo(props: {
  info: { credit: string; expireDate: string } | null;
  error: string;
  loading: boolean;
}) {
  const { info, error, loading } = props;

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {loading && !info && <div className="py-16 flex justify-center"><div className="w-6 h-6 border-2 border-gray-300 border-t-teal-500 rounded-full animate-spin" /></div>}

      {info && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">اعتبار باقی‌مانده</p>
            <p className="text-2xl font-bold text-teal-600 dark:text-teal-400" dir="ltr">{info.credit}</p>
            <p className="text-xs text-gray-400 mt-1">تومان / ریال</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">تاریخ انقضا</p>
            <p className="text-2xl font-bold text-gray-700 dark:text-white" dir="ltr">{info.expireDate || '—'}</p>
          </div>
        </div>
      )}

      {info && (
        <div className="bg-teal-50 dark:bg-teal-900/20 rounded-2xl border border-teal-100 dark:border-teal-800 px-4 py-3">
          <p className="text-xs text-teal-700 dark:text-teal-300">
            برای گزارشات تفصیلی‌تر به پنل رهیاب رایان مراجعه کنید:
            <a href="https://RahvabBulk.ir/" target="_blank" rel="noopener noreferrer"
              className="font-mono mr-1 underline hover:no-underline" dir="ltr">
              https://RahvabBulk.ir/
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
