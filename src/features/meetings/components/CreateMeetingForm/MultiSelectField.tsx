import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export interface MultiSelectOption {
  id: string;
  name: string;
  sub?: string;
}

export interface MultiSelectGroup {
  label: string;
  options: MultiSelectOption[];
}

export interface MultiSelectValue {
  id: string;
  name: string;
}

export interface MultiSelectFieldProps {
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  options: MultiSelectOption[];
  groups?: MultiSelectGroup[];
  selected: MultiSelectValue[];
  onAdd: (item: MultiSelectValue) => void;
  onRemove: (id: string) => void;
  tagColor: string;
}

export function MultiSelectField({
  label, icon, placeholder, options, groups, selected, onAdd, onRemove, tagColor,
}: MultiSelectFieldProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  // Flatten all group options for search/filter
  const allOptions = groups ? groups.flatMap(g => g.options) : options;

  const filtered = allOptions.filter(o =>
    !selected.find(s => s.id === o.id) &&
    (o.name.toLowerCase().includes(query.toLowerCase()) || (o.sub || '').toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => { setHighlightedIndex(0); }, [query, open]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (open && filtered.length > 0) {
        const item = filtered[highlightedIndex] || filtered[0];
        onAdd({ id: item.id, name: item.name });
        setQuery('');
        setHighlightedIndex(0);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlightedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const isSearching = query.trim().length > 0;

  return (
    <div ref={ref}>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{icon}{label}</label>
      <div className="flex flex-wrap gap-1.5 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cursor-text min-h-[42px]"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}>
        {selected.map(s => (
          <span key={s.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tagColor}`}>
            {s.name}
            <button type="button" onClick={ev => { ev.stopPropagation(); onRemove(s.id); }} className="hover:opacity-70"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <input ref={inputRef} type="text" value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white placeholder-gray-400" />
      </div>
      {open && (isSearching ? filtered.length > 0 : (groups ? groups.some(g => g.options.some(o => !selected.find(s => s.id === o.id))) : filtered.length > 0)) && (
        <div className="relative z-20">
          <div className="absolute w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-52 overflow-y-auto">
            {isSearching ? (
              // حالت جستجو — لیست مسطح
              filtered.length === 0
                ? <div className="p-3 text-sm text-gray-400">کاربری یافت نشد</div>
                : filtered.map((o, idx) => (
                  <button key={o.id} type="button"
                    onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); setOpen(false); }}
                    className={`w-full text-right px-3 py-2 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0 ${idx === highlightedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                    <span>{o.name}</span>
                    {o.sub && <span className="text-xs text-gray-400 truncate mr-2 max-w-[160px]">{o.sub}</span>}
                  </button>
                ))
            ) : groups ? (
              // حالت گروه‌بندی واحد سازمانی
              (() => {
                let flatIdx = 0;
                return groups.map(group => {
                  const groupItems = group.options.filter(o => !selected.find(s => s.id === o.id));
                  if (groupItems.length === 0) return null;
                  return (
                    <div key={group.label}>
                      <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wide bg-gray-50 dark:bg-gray-800 sticky top-0">
                        {group.label}
                      </div>
                      {groupItems.map(o => {
                        const currentIdx = flatIdx++;
                        return (
                          <button key={o.id} type="button"
                            onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); setOpen(false); }}
                            className={`w-full text-right px-3 py-2 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0 ${currentIdx === highlightedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                            <span>{o.name}</span>
                            {o.sub && <span className="text-xs text-gray-400 truncate mr-2 max-w-[160px]">{o.sub}</span>}
                          </button>
                        );
                      })}
                    </div>
                  );
                });
              })()
            ) : (
              // حالت قدیمی — لیست مسطح
              filtered.length === 0
                ? <div className="p-3 text-sm text-gray-400">کاربری یافت نشد</div>
                : filtered.slice(0, 8).map((o, idx) => (
                  <button key={o.id} type="button"
                    onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); setOpen(false); }}
                    className={`w-full text-right px-3 py-2 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0 ${idx === highlightedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                    <span>{o.name}</span>
                    {o.sub && <span className="text-xs text-gray-400">{o.sub}</span>}
                  </button>
                ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
