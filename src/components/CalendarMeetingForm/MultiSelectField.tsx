import { useState, useEffect, useRef } from 'react';
import { X, Building2, ChevronDown, ChevronRight } from 'lucide-react';

export function MultiSelectField({
  label, icon, placeholder, options, groups, selected, onAdd, onRemove, tagColor,
}: {
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  options: { id: string; name: string; sub?: string }[];
  groups?: { label: string; options: { id: string; name: string; sub?: string }[] }[];
  selected: { id: string; name: string }[];
  onAdd: (item: { id: string; name: string }) => void;
  onRemove: (id: string) => void;
  tagColor: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // expand all groups by default when opened
  useEffect(() => {
    if (open && groups && expandedUnits.size === 0) {
      setExpandedUnits(new Set(groups.map(g => g.label)));
    }
  }, [open, groups]);

  const allOptions = groups ? groups.flatMap(g => g.options) : options;

  const isSelected = (id: string) => !!selected.find(s => s.id === id);

  const filtered = allOptions.filter(o =>
    !isSelected(o.id) &&
    (o.name.toLowerCase().includes(query.toLowerCase()) || (o.sub || '').toLowerCase().includes(query.toLowerCase()))
  );

  useEffect(() => { setHighlightedIndex(0); }, [query, open]);

  const toggleUnit = (label: string) => setExpandedUnits(prev => {
    const next = new Set(prev);
    next.has(label) ? next.delete(label) : next.add(label);
    return next;
  });

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

  const renderDropdown = () => {
    if (query || !groups) {
      // flat filtered list
      if (filtered.length === 0) return <div className="p-3 text-sm text-gray-400">کاربری یافت نشد</div>;
      return filtered.slice(0, 8).map((o, idx) => (
        <button key={o.id} type="button"
          onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); }}
          className={`w-full text-right px-3 py-2 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0 ${idx === highlightedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
          <span>{o.name}</span>
          {o.sub && <span className="text-xs text-gray-400 truncate max-w-[120px]">{o.sub}</span>}
        </button>
      ));
    }

    // grouped display — highlight uses flat filtered index
    let flatIdx = 0;
    return groups.map(g => {
      const groupOptions = g.options.filter(o => !isSelected(o.id));
      if (groupOptions.length === 0) return null;
      const expanded = expandedUnits.has(g.label);
      return (
        <div key={g.label}>
          <button type="button" onClick={() => toggleUnit(g.label)}
            className="w-full flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 dark:bg-gray-600/60 text-right hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors sticky top-0 z-10">
            <Building2 className="w-3 h-3 text-blue-400 flex-shrink-0" />
            <span className="flex-1 text-xs font-semibold text-gray-500 dark:text-gray-300 truncate">{g.label}</span>
            <span className="text-xs text-gray-400">{groupOptions.length}</span>
            {expanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
          </button>
          {expanded && groupOptions.map(o => {
            const currentIdx = flatIdx++;
            return (
              <button key={o.id} type="button"
                onClick={() => { onAdd({ id: o.id, name: o.name }); setQuery(''); }}
                className={`w-full text-right px-4 py-2 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0 pr-6 ${currentIdx === highlightedIndex ? 'bg-blue-50 dark:bg-blue-900/30' : 'hover:bg-gray-50 dark:hover:bg-gray-600'}`}>
                <span>{o.name}</span>
                {o.sub && <span className="text-xs text-gray-400 truncate max-w-[120px]">{o.sub}</span>}
              </button>
            );
          })}
        </div>
      );
    });
  };

  const hasItems = query ? filtered.length > 0 : (groups ? groups.some(g => g.options.some(o => !isSelected(o.id))) : filtered.length > 0);

  return (
    <div ref={ref}>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        {icon}{label}
      </label>
      <div
        className="flex flex-wrap gap-1.5 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cursor-text min-h-[42px]"
        onClick={() => { setOpen(true); inputRef.current?.focus(); }}
      >
        {selected.map(s => (
          <span key={s.id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${tagColor}`}>
            {s.name}
            <button type="button" onClick={e => { e.stopPropagation(); onRemove(s.id); }} className="hover:opacity-70">
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={selected.length === 0 ? placeholder : ''}
          className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white placeholder-gray-400"
        />
      </div>
      {open && hasItems && (
        <div className="relative z-20">
          <div className="absolute w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-52 overflow-y-auto">
            {renderDropdown()}
          </div>
        </div>
      )}
    </div>
  );
}
