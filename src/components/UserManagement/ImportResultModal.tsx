import React from 'react';
import { Upload, X, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle2 } from 'lucide-react';
import type { ImportResult } from './types';

function ImportResultModal({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const reasonCounts: Record<string, number> = {};
  result.errors.forEach(e => { reasonCounts[e.reason] = (reasonCounts[e.reason] || 0) + 1; });
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const allSameReason = topReason && result.errors.every(e => e.reason === topReason);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" dir="rtl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-gray-800 dark:text-white text-lg flex items-center gap-2">
            <Upload className="w-5 h-5 text-amber-500" />نتایج ورود دسته‌ای
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 p-5 border-b border-gray-100 dark:border-gray-700">
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{result.total}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">کل سطرها</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{result.created}</p>
            <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">ایجاد شد</p>
          </div>
          <div className={`rounded-xl p-3 text-center ${result.failed > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-700/50'}`}>
            <p className={`text-2xl font-bold ${result.failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{result.failed}</p>
            <p className={`text-xs mt-0.5 ${result.failed > 0 ? 'text-red-500' : 'text-gray-400'}`}>ناموفق</p>
          </div>
        </div>

        {result.failed > 0 && topReason && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-300">
              <span className="font-bold">{allSameReason ? 'دلیل همه خطاها:' : `شایع‌ترین خطا (${reasonCounts[topReason]} سطر):`}</span>
              {' '}{topReason}
            </div>
          </div>
        )}

        {result.errors.length > 0 ? (
          <div className="flex-1 overflow-y-auto p-5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">جزئیات سطرهای ناموفق</p>
            <div className="space-y-2">
              {result.errors.map((e, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800">
                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                    <span className="text-xs font-bold text-red-600 dark:text-red-400">{e.row}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-red-700 dark:text-red-400 truncate">{e.email || '(بدون ایمیل)'}</p>
                    <p className="text-xs text-red-500 dark:text-red-400 mt-0.5 break-words">{e.reason || '(علت نامشخص)'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-6 flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">همه کاربران با موفقیت ایجاد شدند</p>
          </div>
        )}

        <div className="p-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose}
            className="w-full py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition">
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

export { ImportResultModal };
