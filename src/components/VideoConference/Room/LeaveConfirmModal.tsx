import { PhoneOff, X } from 'lucide-react';

export function LeaveConfirmModal({ onLeaveOnly, onEndForAll, onCancel }: {
  onLeaveOnly: () => void;
  onEndForAll: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label="خروج از جلسه" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-sm text-center space-y-4" dir="rtl">
        <div className="w-14 h-14 rounded-full bg-red-900/40 flex items-center justify-center mx-auto">
          <PhoneOff className="w-7 h-7 text-red-400" />
        </div>
        <div>
          <h3 className="text-white font-bold text-lg mb-1">خروج از جلسه</h3>
          <p className="text-gray-400 text-sm">شما میزبان هستید. چه کاری انجام دهید؟</p>
        </div>
        <div className="flex flex-col gap-2">
          <button onClick={onLeaveOnly} autoFocus
            className="w-full py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-xl font-medium transition-colors text-sm">
            فقط خودم خارج شوم (جلسه ادامه دارد)
          </button>
          <button onClick={onEndForAll}
            className="w-full py-3 bg-red-600 hover:bg-red-500 text-white rounded-xl font-medium transition-colors text-sm">
            پایان دادن جلسه برای همه
          </button>
          <button onClick={onCancel}
            className="w-full py-2.5 text-gray-400 hover:text-white text-sm transition-colors">
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}
