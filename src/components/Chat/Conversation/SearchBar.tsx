import { Search, X } from 'lucide-react';

export function SearchBar({ searchQuery, setSearchQuery, resultCount }: {
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
  resultCount: number;
}) {
  return (
    <div className="flex-shrink-0 px-4 py-2 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
        <input
          autoFocus
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="جستجو در پیام‌های این گفتگو..."
          className="w-full pr-9 pl-8 py-2 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-none focus:border-teal-400 dark:text-white placeholder-gray-400"
          dir="rtl"
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      {searchQuery && (
        <p className="text-[11px] text-gray-400 mt-1 text-right">
          {resultCount} نتیجه
        </p>
      )}
    </div>
  );
}
