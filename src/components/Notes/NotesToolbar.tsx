import { Search, SlidersHorizontal } from 'lucide-react';

export function NotesToolbar({ searchTerm, setSearchTerm, statusFilter, setStatusFilter }: {
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  statusFilter: 'all' | 'active' | 'archived';
  setStatusFilter: React.Dispatch<React.SetStateAction<'all' | 'active' | 'archived'>>;
}) {
  return (
    <section className="notes-toolbar mb-3 rounded-xl border border-slate-200/80 bg-white/85 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70 sm:p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2.5">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="جستجو در عنوان یا متن یادداشت..."
            className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-9 text-xs text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:focus:border-violet-500/40"
          />
        </div>

        <div className="relative sm:w-48">
          <SlidersHorizontal className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'archived')}
            className="h-9 w-full appearance-none rounded-lg border border-slate-200 bg-white px-8 text-xs text-slate-700 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option value="all">همه یادداشت‌ها</option>
            <option value="active">یادداشت‌های فعال</option>
            <option value="archived">بایگانی‌شده</option>
          </select>
        </div>
      </div>
    </section>
  );
}
