import { X, Download } from 'lucide-react';

interface MeetingShareDialogProps {
  imageUrl: string;
  onClose: () => void;
  onDownload: () => void;
}

export function MeetingShareDialog({ imageUrl, onClose, onDownload }: MeetingShareDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden" onClick={e => e.stopPropagation()} dir="rtl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-white text-base">اشتراک‌گذاری جلسه</h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          <img src={imageUrl} alt="تصویر جلسه" className="w-full rounded-xl shadow-md mb-4" />
          <button
            onClick={onDownload}
            className="w-full flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white py-3 rounded-xl text-sm font-medium transition-colors"
          >
            <Download className="w-4 h-4" />
            دانلود تصویر
          </button>
        </div>
      </div>
    </div>
  );
}
