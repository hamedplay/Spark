import { CirclePlus as PlusCircle, Loader as Loader2 } from 'lucide-react';

export function FormFooter({
  loading,
  orgUsersLoading,
  committing,
  editDecision,
  onCancel,
}: {
  loading: boolean;
  orgUsersLoading: boolean;
  committing: boolean;
  editDecision: unknown;
  onCancel: () => void;
}) {
  return (
    <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700 flex-shrink-0">
      <button type="submit" disabled={loading || orgUsersLoading || committing || !!editDecision}
        className="flex-1 flex items-center justify-center gap-2 bg-teal-600 text-white py-2.5 rounded-xl hover:bg-teal-700 disabled:opacity-50 font-medium text-sm transition-colors">
        {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <PlusCircle className="w-5 h-5" />}
        ثبت نهایی جلسه
      </button>
      <button type="button" onClick={onCancel}
        className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm font-medium transition-colors">
        انصراف
      </button>
    </div>
  );
}
