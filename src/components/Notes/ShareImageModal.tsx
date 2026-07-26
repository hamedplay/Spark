import { X, Download, Image as ImageIcon, Loader as Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Note } from './types';

export function ShareImageModal({
  shareNote,
  shareImageData,
  onClose,
}: {
  shareNote: Note;
  shareImageData: string | null;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" dir="rtl" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center">
              <ImageIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            </div>
            <h3 className="font-bold text-gray-900 dark:text-white">اشتراک‌گذاری تصویر</h3>
          </div>
          <button onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4">
          {shareImageData ? (
            <div className="rounded-xl overflow-hidden shadow-lg mb-4">
              <img src={shareImageData} alt="تصویر یادداشت" className="w-full" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-32 bg-gray-100 dark:bg-gray-700 rounded-xl mb-4">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
            </div>
          )}
          <button
            disabled={!shareImageData}
            onClick={() => {
              if (!shareImageData) return;
              const link = document.createElement('a');
              link.href = shareImageData;
              link.download = `note-${shareNote.id}.png`;
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              toast.success('تصویر با موفقیت دانلود شد');
            }}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
          >
            <Download className="w-4 h-4" />
            دانلود تصویر
          </button>
        </div>
      </div>
    </div>
  );
}
