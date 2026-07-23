import { Bell } from 'lucide-react';

export function AccessDenied({ onReturn }: { onReturn: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center" dir="rtl">
      <div className="w-16 h-16 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
        <Bell className="w-8 h-8 text-red-400" />
      </div>
      <h2 className="text-xl font-bold text-gray-800 dark:text-white">دسترسی محدود شده</h2>
      <p className="text-gray-500 dark:text-gray-400 max-w-sm text-sm">
        شما مجوز دسترسی به این بخش را ندارید. لطفاً با مدیر سیستم تماس بگیرید.
      </p>
      <button
        onClick={onReturn}
        className="px-5 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors"
      >
        بازگشت به پروفایل
      </button>
    </div>
  );
}
