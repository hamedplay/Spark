import { Bell, X } from 'lucide-react';

interface ExternalOption {
  id: string;
  name: string;
  sub?: string;
}

export function ExternalInformeesSection(props: {
  searchRef: React.RefObject<HTMLDivElement | null>;
  selected: string[];
  setSelected: React.Dispatch<React.SetStateAction<string[]>>;
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  showDropdown: boolean;
  setShowDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  options: ExternalOption[];
}) {
  const {
    searchRef,
    selected,
    setSelected,
    search,
    setSearch,
    showDropdown,
    setShowDropdown,
    options,
  } = props;

  return (
    <div ref={searchRef}>
      <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
        <Bell className="w-4 h-4" />
        مطلعین خارج سازمان
      </label>
      <div
        className="flex flex-wrap gap-1.5 p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 cursor-text min-h-[42px]"
        onClick={() => setShowDropdown(true)}
      >
        {selected.map(name => (
          <span
            key={name}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
          >
            {name}
            <button
              type="button"
              onClick={event => {
                event.stopPropagation();
                setSelected(previous => previous.filter(item => item !== name));
              }}
              className="hover:opacity-70"
              aria-label={`حذف ${name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={search}
          onChange={event => {
            setSearch(event.target.value);
            setShowDropdown(true);
          }}
          onFocus={() => setShowDropdown(true)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (options.length > 0) {
                setSelected(previous => previous.includes(options[0].name) ? previous : [...previous, options[0].name]);
                setSearch('');
                setShowDropdown(false);
              }
            } else if (event.key === 'Escape') {
              setShowDropdown(false);
            }
          }}
          placeholder={selected.length === 0 ? 'جستجوی مخاطبین...' : ''}
          className="flex-1 min-w-[120px] outline-none bg-transparent text-sm dark:text-white placeholder-gray-400"
        />
      </div>

      {showDropdown && (
        <div className="relative z-20">
          <div className="absolute w-full mt-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-44 overflow-y-auto">
            {options.slice(0, 8).map(contact => (
              <button
                key={contact.id}
                type="button"
                onClick={() => {
                  setSelected(previous => previous.includes(contact.name) ? previous : [...previous, contact.name]);
                  setSearch('');
                  setShowDropdown(false);
                }}
                className="w-full text-right px-3 py-2 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-sm dark:text-white flex items-center justify-between border-b border-gray-50 dark:border-gray-600 last:border-0"
              >
                <span>{contact.name}</span>
                <span className="text-xs text-gray-400">{contact.sub}</span>
              </button>
            ))}
            {options.length === 0 && (
              <div className="p-3 text-sm text-gray-400">مخاطبی یافت نشد</div>
            )}
          </div>
        </div>
      )}
      <p className="mt-1 text-[11px] leading-5 text-gray-400">این افراد شرکت‌کننده جلسه محسوب نمی‌شوند و فقط برای اطلاع‌رسانی انتخاب می‌شوند.</p>
    </div>
  );
}
