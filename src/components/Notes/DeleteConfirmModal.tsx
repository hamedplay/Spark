import { Trash2 } from 'lucide-react';

export function DeleteConfirmModal({ deleteConfirmId, onConfirm, onCancel }: {
  deleteConfirmId: string | null;
  onConfirm: (id: string) => void;
  onCancel: () => void;
}) {
  if (!deleteConfirmId) return null;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[2px]" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden">
        <div className="bg-red-500 px-5 py-4">
          <h3 className="text-white font-bold text-sm">حذف یادداشت</h3>
          <p className="text-red-100 text-xs mt-1">این یادداشت برای همیشه حذف خواهد شد</p>
        </div>
        <div className="p-5 space-y-3">
          <button
            onClick={() => onConfirm(deleteConfirmId)}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Trash2 className="w-4 h-4" /> حذف کامل
          </button>
          <button
            onClick={onCancel}
            className="w-full py-2.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
