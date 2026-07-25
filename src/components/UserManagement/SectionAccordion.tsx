import React from 'react';
import { CircleCheck as CheckCircle2 } from 'lucide-react';

function SectionAccordion({ title, subtitle, open, onToggle, children }: {
  title: string; subtitle: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-right">
        <div>
          <p className="font-semibold text-gray-800 dark:text-white text-sm">{title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors flex-shrink-0 mr-3 ${open ? 'border-teal-500 bg-teal-500' : 'border-gray-300 dark:border-gray-600'}`}>
          {open && <CheckCircle2 className="w-3 h-3 text-white" />}
        </div>
      </button>
      {open && <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">{children}</div>}
    </div>
  );
}

export { SectionAccordion };
