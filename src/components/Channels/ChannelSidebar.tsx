import { useState } from 'react';
import { Search, Plus, Users, Hash, Settings, ListTodo } from 'lucide-react';
import { ChannelWithMeta, ChannelType } from './types';

interface Props {
  channels: ChannelWithMeta[];
  groups: ChannelWithMeta[];
  activeTab: 'channels' | 'groups';
  selectedId: string | null;
  isAdmin: boolean;
  loading: boolean;
  canCreateChannel?: boolean;
  canCreateGroup?: boolean;
  onTabChange: (tab: 'channels' | 'groups') => void;
  onSelect: (id: string) => void;
  onCreateChannel: (type: ChannelType) => void;
  onOpenSettings: () => void;
  onOpenActions: () => void;
}

function ChannelItem({ ch, selected, onClick }: { ch: ChannelWithMeta; selected: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-right ${
        selected
          ? 'bg-teal-500 text-white shadow-xs'
          : 'hover:bg-gray-100 dark:hover:bg-gray-700/60 text-gray-700 dark:text-gray-200'
      }`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold ${
        selected ? 'bg-teal-400/40 text-white' : 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'
      }`}>
        {ch.name.charAt(0)}
      </div>
      <div className="flex-1 min-w-0 text-right">
        <div className="flex items-center justify-between gap-1">
          <span className="text-sm font-semibold truncate">{ch.name}</span>
          {ch.unreadCount > 0 && (
            <span className={`shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${selected ? 'bg-white/20 text-white' : 'bg-teal-500 text-white'}`}>
              {ch.unreadCount > 99 ? '99+' : ch.unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Users className={`w-3 h-3 shrink-0 ${selected ? 'text-teal-200' : 'text-gray-400'}`} />
          <span className={`text-[11px] truncate ${selected ? 'text-teal-100' : 'text-gray-400 dark:text-gray-500'}`}>
            {ch.member_count} عضو
            {ch.last_message_preview && ` · ${ch.last_message_preview}`}
          </span>
        </div>
      </div>
    </button>
  );
}

export function ChannelSidebar({
  channels, groups, activeTab, selectedId, isAdmin, loading,
  canCreateChannel = true, canCreateGroup = true,
  onTabChange, onSelect, onCreateChannel, onOpenSettings, onOpenActions,
}: Props) {
  const [search, setSearch] = useState('');

  const items = activeTab === 'channels' ? channels : groups;
  const filtered = search ? items.filter(c => c.name.toLowerCase().includes(search.toLowerCase())) : items;

  const canCreate = activeTab === 'channels' ? canCreateChannel : canCreateGroup;

  return (
    <div className="w-full md:w-72 flex flex-col h-full bg-white dark:bg-gray-800 border-l border-gray-100 dark:border-gray-700">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-gray-800 dark:text-white">کانال‌ها</h2>
          <div className="flex items-center gap-1">
            <button
              onClick={onOpenActions}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              title="اقدامات جاری"
            >
              <ListTodo className="w-4 h-4" />
            </button>
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
              title="تنظیمات"
            >
              <Settings className="w-4 h-4" />
            </button>
            {(isAdmin || canCreate) && (
              <button
                onClick={() => onCreateChannel(activeTab === 'channels' ? 'channel' : 'group')}
                className="p-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white transition-colors"
                title={activeTab === 'channels' ? 'کانال جدید' : 'گروه جدید'}
              >
                <Plus className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex bg-gray-100 dark:bg-gray-700/60 rounded-xl p-0.5">
          {(['channels', 'groups'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => onTabChange(tab)}
              className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
                activeTab === tab
                  ? 'bg-teal-500 text-white shadow-xs'
                  : 'text-gray-500 dark:text-gray-400'
              }`}
            >
              {tab === 'channels' ? 'کانال‌های من' : 'گروه‌های من'}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="relative mt-2">
          <Search className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="جستجو..."
            className="w-full pr-8 pl-3 py-1.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg dark:text-white focus:outline-hidden focus:ring-2 focus:ring-teal-500/40"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        {loading ? (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-10">
            <div className="w-12 h-12 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center mx-auto mb-3">
              {activeTab === 'channels' ? <Hash className="w-6 h-6 text-gray-400" /> : <Users className="w-6 h-6 text-gray-400" />}
            </div>
            <p className="text-xs text-gray-400">{search ? 'موردی یافت نشد' : `هنوز ${activeTab === 'channels' ? 'کانالی' : 'گروهی'} ندارید`}</p>
          </div>
        ) : (
          filtered.map(ch => (
            <ChannelItem key={ch.id} ch={ch} selected={selectedId === ch.id} onClick={() => onSelect(ch.id)} />
          ))
        )}
      </div>
    </div>
  );
}
