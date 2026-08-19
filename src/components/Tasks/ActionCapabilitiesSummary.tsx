import React from 'react';
import { CheckSquare, FileText, FolderKanban, Link2, Bell, Clock3 } from 'lucide-react';

export function ActionCapabilitiesSummary() {
  const items = [
    ['چک‌لیست', CheckSquare],
    ['فایل‌ها', FileText],
    ['پروژه', FolderKanban],
    ['وابستگی', Link2],
    ['یادآور', Bell],
    ['زمان', Clock3],
  ] as const;
  return <div className="flex flex-wrap gap-2">{items.map(([label, Icon]) => <span key={label} className="inline-flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2.5 py-1 text-xs text-gray-500 dark:text-gray-400"><Icon className="w-3.5 h-3.5"/>{label}</span>)}</div>;
}
