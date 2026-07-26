import { ArrowRight, Users, Pin, Search, X, Info, Star, GitFork, Settings } from 'lucide-react';
import type { Channel, MemberRole } from '../types';

export function ChannelHeader(props: {
  channel: Channel;
  isMobile: boolean;
  onBack: () => void;
  memberCount: number;
  showSearch: boolean;
  onToggleSearch: () => void;
  openGroupTasksCount: number;
  onShowTopics: () => void;
  onShowMembers: () => void;
  isAdmin: boolean;
  onShowSettings: () => void;
}) {
  const { channel, isMobile, onBack, memberCount, showSearch, onToggleSearch, openGroupTasksCount, onShowTopics, onShowMembers, isAdmin, onShowSettings } = props;
  return (
    <div className="flex items-center gap-2 px-2 sm:px-4 py-2.5 sm:py-3 border-b border-gray-100 dark:border-gray-700 flex-shrink-0 bg-white dark:bg-gray-800">
      {isMobile && (
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 flex-shrink-0">
          <ArrowRight className="w-5 h-5" />
        </button>
      )}
      <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0 text-sm font-bold text-teal-600 dark:text-teal-400">
        {channel.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-sm font-bold text-gray-800 dark:text-white truncate">{channel.name}</h2>
        <p className="text-[11px] text-gray-400">{memberCount || channel.member_count} عضو</p>
      </div>
      <div className="flex items-center gap-0.5 sm:gap-1 flex-shrink-0">
        <button onClick={onToggleSearch}
          className={`p-1.5 sm:p-2 rounded-xl transition-colors ${showSearch ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-600' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400'}`}>
          <Search className="w-4 h-4" />
        </button>
        {channel.type === 'group' && (
          <button onClick={onShowTopics}
            className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 relative">
            <GitFork className="w-4 h-4" />
            {openGroupTasksCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-teal-500 rounded-full flex items-center justify-center text-[9px] text-white font-bold px-0.5">{openGroupTasksCount}</span>
            )}
          </button>
        )}
        <button onClick={onShowMembers} className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
          <Users className="w-4 h-4" />
        </button>
        {isAdmin && (
          <button onClick={onShowSettings} className="p-1.5 sm:p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <Settings className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export function ChannelSearchBar({ searchQuery, setSearchQuery }: {
  searchQuery: string;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
}) {
  return (
    <div className="px-3 sm:px-4 py-2 border-b border-gray-100 dark:border-gray-700 flex-shrink-0 bg-gray-50 dark:bg-gray-700/50">
      <div className="relative">
        <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input autoFocus value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
          placeholder="جستجو در پیام‌ها..."
          className="w-full pr-9 pl-3 py-1.5 text-sm bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500/40" />
        {searchQuery && <button onClick={() => setSearchQuery('')} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>}
      </div>
    </div>
  );
}

export function ChannelDescription({ description }: { description: string }) {
  return (
    <div className="px-3 sm:px-4 py-2 bg-gray-50 dark:bg-gray-700/30 border-b border-gray-100 dark:border-gray-700 flex-shrink-0">
      <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5"><Info className="w-3 h-3 flex-shrink-0" />{description}</p>
    </div>
  );
}

export function FloatingPinButton({ count, active, onClick, topClass }: {
  count: number; active: boolean; onClick: () => void; topClass: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`absolute left-3 ${topClass} flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl shadow-lg border transition-all z-10 text-xs font-medium ${
        active
          ? 'bg-amber-500 text-white border-amber-500'
          : 'bg-white dark:bg-gray-800 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-700 hover:bg-amber-50 dark:hover:bg-amber-900/20'
      }`}
      title="پیام‌های پین شده"
    >
      <Pin className="w-3.5 h-3.5" />
      <span>{count}</span>
    </button>
  );
}

export function FloatingStarButton({ count, active, onClick, topClass }: {
  count: number; active: boolean; onClick: () => void; topClass: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`absolute left-3 ${topClass} transition-all z-10 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl shadow-lg border text-xs font-medium ${
        active
          ? 'bg-yellow-400 text-white border-yellow-400'
          : 'bg-white dark:bg-gray-800 text-yellow-600 dark:text-yellow-400 border-yellow-200 dark:border-yellow-700 hover:bg-yellow-50 dark:hover:bg-yellow-900/20'
      }`}
      title="پیام‌های نشان‌دار"
    >
      <Star className={`w-3.5 h-3.5 ${active ? 'fill-white' : 'fill-yellow-400'}`} />
      <span>{count}</span>
    </button>
  );
}
