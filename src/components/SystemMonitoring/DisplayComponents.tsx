import React from 'react';

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
