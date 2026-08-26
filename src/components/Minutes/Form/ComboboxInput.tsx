import { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';

export interface ComboboxOption {
  value: string;
  label: string;
  sublabel?: string;
  metadata?: Record<string, unknown>;
}

interface ComboboxInputProps {
  id: string;
  value: string;
  options: ComboboxOption[];
  onChange: (value: string) => void;
  onSelect?: (option: ComboboxOption) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  /** When true, selecting an option calls onChange with the option's label
   *  (useful for name fields where the label IS the value). Default: false
   *  (onChange receives option.value). */
  useLabelAsValue?: boolean;
}

/**
 * Free-text input with a dropdown of filtered suggestions. Unlike
 * SearchableSelect (which is a closed select), this allows arbitrary typed
 * text AND optional selection from a suggestion list.
 */
export function ComboboxInput({
  id,
  value,
  options,
  onChange,
  onSelect,
  placeholder = '',
  emptyText = 'موردی یافت نشد',
  disabled = false,
  useLabelAsValue = false,
}: ComboboxInputProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const escHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('keydown', escHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escHandler);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(o =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel?.toLowerCase().includes(q) ?? false))
    : options;

  return (
    <div ref={containerRef} className="relative min-w-0">
      <div className="relative min-w-0">
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onChange={e => { onChange(e.target.value); setQuery(e.target.value); setOpen(true); }}
          onFocus={() => { setQuery(value); setOpen(true); }}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
          className="w-full min-w-0 pr-3 pl-10 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white disabled:opacity-60 disabled:cursor-not-allowed"
        />
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-4 h-4 text-gray-400 pointer-events-none" aria-hidden="true" />
      </div>

      {open && !disabled && (
        <div className="absolute z-50 mt-1 w-full min-w-0 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg max-h-56 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">{emptyText}</div>
          ) : (
            filtered.map(opt => (
              <button
                type="button"
                key={opt.value}
                onClick={() => {
                  const v = useLabelAsValue ? opt.label : opt.value;
                  onChange(v);
                  onSelect?.(opt);
                  setOpen(false);
                  inputRef.current?.focus();
                }}
                className="w-full min-w-0 text-right px-3 py-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-900/20 flex flex-col"
              >
                <span className="dark:text-white break-words">{opt.label}</span>
                {opt.sublabel && (
                  <span className="text-xs text-gray-400 break-words">{opt.sublabel}</span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
