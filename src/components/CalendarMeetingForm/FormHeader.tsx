import { X } from 'lucide-react';

export function FormHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex-shrink-0 bg-teal-600">
      <h2 className="text-base font-bold text-white">تنظیم جلسه در تقویم</h2>
      <button type="button" onClick={onClose} className="p-1.5 rounded-lg bg-white/20 hover:bg-white/30">
        <X className="w-5 h-5 text-white" />
      </button>
    </div>
  );
}
