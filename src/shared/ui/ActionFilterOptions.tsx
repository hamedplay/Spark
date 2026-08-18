import { Check } from 'lucide-react';

interface FilterOption<K extends string> { key: K; label: string }

export function MultiToggleFilterOption<K extends string>({ option, selected, onToggle }: { option: FilterOption<K>; selected: boolean; onToggle: (key: K) => void }) {
  return (
    <button type="button" onClick={() => onToggle(option.key)} className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg text-sm text-gray-700 dark:text-gray-200">
      {option.label}
      {selected && <Check className="w-4 h-4 text-teal-600" />}
    </button>
  );
}

export function SingleSelectFilterOption<K extends string>({ option, selected, customKey, onSelect, onClose }: { option: FilterOption<K>; selected: boolean; customKey: K; onSelect: (key: K) => void; onClose: () => void }) {
  return (
    <button type="button" onClick={() => { onSelect(option.key); if (option.key !== customKey) onClose(); }} className="w-full flex items-center justify-between px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-700/50 rounded-lg text-sm text-gray-700 dark:text-gray-200">
      {option.label}
      {selected && <Check className="w-4 h-4 text-teal-600" />}
    </button>
  );
}
