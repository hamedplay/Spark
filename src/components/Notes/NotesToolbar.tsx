import { Search } from 'lucide-react';
import type { NoteStatusFilter } from './types';

export function NotesToolbar({
  searchTerm,
  setSearchTerm,
  statusFilter,
  setStatusFilter,
}: {
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  statusFilter: NoteStatusFilter;
  setStatusFilter: React.Dispatch<React.SetStateAction<NoteStatusFilter>>;
}) {
  return (
    <div className="flex flex-col md:flex-row gap-4 mb-6">
      <div className="relative flex-1">
        <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="جستجو در یادداشت‌ها..."
          className="w-full pl-4 pr-10 py-2 rounded-lg border border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        />
      </div>
      <select
        value={statusFilter}
        onChange={(e) => setStatusFilter(e.target.value as NoteStatusFilter)}
        className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
      >
        <option value="all">همه یادداشت‌ها</option>
        <option value="active">یادداشت‌های فعال</option>
        <option value="archived">یادداشت‌های بایگانی شده</option>
      </select>
    </div>
  );
}
