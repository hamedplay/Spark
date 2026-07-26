import { useState } from 'react';
import { Check, ChevronDown, Group as GroupIcon } from 'lucide-react';
import type { UserGroup } from './types';

export function GroupSelector({ groups, selected, onSelect }: { groups: UserGroup[]; selected: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = groups.find(g => g.id === selected);
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-700 dark:text-gray-200 hover:border-amber-400 transition-colors min-w-52">
        <GroupIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <span className="flex-1 text-right truncate">{current ? (current.display_name || current.name) : 'انتخاب گروه کاربری'}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1">
          {groups.map(g => (
            <button key={g.id} onClick={() => { onSelect(g.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right transition-colors ${selected === g.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
              <GroupIcon className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-sm text-gray-700 dark:text-gray-200">{g.display_name || g.name}</span>
              {selected === g.id && <Check className="w-3.5 h-3.5 text-amber-500 mr-auto flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
