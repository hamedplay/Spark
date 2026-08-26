import React from 'react';
import { Lock } from 'lucide-react';

export function Badge2({ label, colorCls }: { label: string; colorCls: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${colorCls}`}>{label}</span>;
}

export function DataField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-gray-400 dark:text-gray-500">{label}</span>
      <span className="text-sm text-gray-700 dark:text-gray-200 font-medium">{value ?? '—'}</span>
    </div>
  );
}

export function maskConfidential(body: string, msgType: string | null, revealed: boolean): React.ReactNode {
  if (msgType === 'confidential' && !revealed) {
    return (
      <span className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 italic">
        <Lock className="w-3 h-3" />پیام محرمانه ارسال شده است
      </span>
    );
  }
  return body;
}
