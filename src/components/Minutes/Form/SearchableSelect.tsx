import { useState, useRef, useEffect } from 'react';
import { Search, Check, X } from 'lucide-react';

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
}

interface SearchableSelectProps {
  id: string;
  value: string;
  options: SearchableOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  loading?: boolean;
  disabled?: boolean;
  allowClear?: boolean;
}

export function SearchableSelect({
  id, value, options, onChange,
  placeholder = 'انتخاب کنید',
  searchPlaceholder = 'جستجو...',
  emptyText = 'موردی یافت نشد',
  loading = false,
  disabled = false,
  allowClear = true,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find(o => o.value === value);

  const filtered = query.trim()
    ? options.filter(o => {
        const q = query.trim().toLowerCase();
        return o.label.toLowerCase().includes(q) ||
               (o.sublabel?.toLowerCase().includes(q) ?? false);
      })
    : options;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <span className={selected ? '' : 'text-gray-400'}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="flex items-center gap-1">
          {selected && allowClear && !disabled && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.stopPropagation(); onChange(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange(''); } }}
              className="text-gray-400 hover:text-red-400"
            >
              <X className="w-3.5 h-3.5" />
            </span>
          )}
          <Search className="w-4 h-4 text-gray-400" />
        </span>
      </button>

      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg max-h-64 overflow-hidden flex flex-col">
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              autoFocus
              className="w-full px-2.5 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="overflow-y-auto flex-1">
            {loading ? (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">در حال بارگذاری...</div>
            ) : filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">{emptyText}</div>
            ) : (
              filtered.map(opt => (
                <button
                  type="button"
                  key={opt.value}
                  onClick={() => { onChange(opt.value); setOpen(false); setQuery(''); }}
                  className={`w-full text-right px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-between gap-2 ${opt.value === value ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
                >
                  <span className="flex-1 min-w-0">
                    <span className="block truncate dark:text-white">{opt.label}</span>
                    {opt.sublabel && (
                      <span className="block text-xs text-gray-400 truncate">{opt.sublabel}</span>
                    )}
                  </span>
                  {opt.value === value && <Check className="w-4 h-4 text-blue-500 flex-shrink-0" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
