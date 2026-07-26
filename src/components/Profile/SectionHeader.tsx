import { ChevronDown, ChevronUp } from 'lucide-react';
import type { SectionId } from './types';

export function SectionHeader({ id, title, subtitle, openSection, onToggle }: { id: SectionId; title: string; subtitle: string; openSection: SectionId; onToggle: (id: SectionId) => void }) {
  return (
    <button
      type="button"
      onClick={() => onToggle(id)}
      className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 transition"
    >
      <div className="text-right">
        <p className="font-semibold text-gray-800 dark:text-white text-sm">{title}</p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
      </div>
      {openSection === id
        ? <ChevronUp className="w-4 h-4 text-gray-400" />
        : <ChevronDown className="w-4 h-4 text-gray-400" />}
    </button>
  );
}
