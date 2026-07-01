import { useState, useEffect } from 'react';
import { Search, Plus, RefreshCw, SquareCheck as CheckSquare, Phone, MessageCircle, Settings2, Bookmark } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { ConversationWithProfile } from './types';
import { ChatConversationItem } from './ChatConversationItem';

export type SidebarTab = 'chats' | 'calls';

interface Props {
  conversations: ConversationWithProfile[];
  activeId: string | null;
  currentUserId: string | null;
  onSelect: (id: string) => void;
  onNewConversation: () => void;
  onRefresh: () => void;
  onTogglePin?: (convId: string) => void;
  onOpenSavedMessages?: () => void;
  onToggleActions: () => void;
  showActions: boolean;
  activeTab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  onOpenSettings?: () => void;
  onMentionClick?: (convId: string, messageId: string) => void;
}

export function ChatSidebar({
  conversations,
  activeId,
  currentUserId,
  onSelect,
  onNewConversation,
  onRefresh,
  onTogglePin,
  onOpenSavedMessages,
  onToggleActions,
  showActions,
  activeTab,
  onTabChange,
  onOpenSettings,
  onMentionClick,
}: Props) {

  const [search, setSearch] = useState('');
  const [presenceMap, setPresenceMap] = useState<Record<string, { last_seen: string | null; status: string | null }>>({});

  const filtered = conversations.filter(c =>
    // self-chats are shown via the static Saved Messages button, not in the regular list
    c.otherUser.user_id !== currentUserId &&
    ((c.otherUser.full_name || '').toLowerCase().includes(search.toLowerCase()) ||
    (c.otherUser.email || '').toLowerCase().includes(search.toLowerCase()))
  );

  const pinned = filtered.filter(c => c.isPinned);
  const unpinned = filtered.filter(c => !c.isPinned);

  useEffect(() => {
    if (!conversations.length) return;

    const userIds = conversations.map(c => c.otherUser.user_id);

    const loadPresence = async () => {
      const { data } = await supabase
        .from('user_presence')
        .select('user_id,last_seen,status')
        .in('user_id', userIds);

      if (!data) return;

      const map: Record<string, { last_seen: string | null; status: string | null }> = {};
      data.forEach(p => {
        map[p.user_id] = { last_seen: p.last_seen, status: p.status ?? null };
      });

      setPresenceMap(map);
    };

    loadPresence();

    const channel = supabase
      .channel(`sidebar-presence-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_presence'
        },
        payload => {
          const row = payload.new as any;

          setPresenceMap(prev => ({
            ...prev,
            [row.user_id]: { last_seen: row.last_seen, status: row.status ?? null }
          }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversations]);

  return (
    <div className="flex flex-col h-full" dir="rtl">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">چت سازمانی</h2>

        <div className="flex gap-1">

          <button
            onClick={onRefresh}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
            title="بازنشانی"
          >
            <RefreshCw className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>

          <button
            onClick={onNewConversation}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
            title="گفتگوی جدید"
          >
            <Plus className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>

          <button
            onClick={onToggleActions}
            className={`p-2 rounded-xl transition-colors ${
              showActions
                ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-600'
                : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500'
            }`}
          >
            <CheckSquare className="w-5 h-5" />
          </button>

          <button
            onClick={onOpenSettings}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors"
            title="تنظیمات چت"
          >
            <Settings2 className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>

        </div>
      </div>

      {/* Tabs */}
      <div className="flex mx-3 mt-2 mb-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 gap-1 shrink-0">

        <button
          onClick={() => onTabChange('chats')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg ${
            activeTab === 'chats'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
              : 'text-gray-500'
          }`}
        >
          <MessageCircle className="w-4 h-4" />
          پیام‌ها
        </button>

        <button
          onClick={() => onTabChange('calls')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-medium rounded-lg ${
            activeTab === 'calls'
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-xs'
              : 'text-gray-500'
          }`}
        >
          <Phone className="w-4 h-4" />
          تماس‌ها
        </button>

      </div>

      {/* Search */}
      {activeTab === 'chats' && (
        <div className="px-3 py-2 shrink-0">
          <div className="relative">

            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />

            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="جستجوی مخاطب..."
              className="w-full pr-9 pl-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-hidden focus:ring-2 focus:ring-teal-400 dark:text-white"
            />

          </div>
        </div>
      )}

      {/* Conversations */}
      {activeTab === 'chats' && (
        <div className="flex-1 overflow-y-auto">

          {/* Saved Messages — always at top */}
          {onOpenSavedMessages && (
            <button
              onClick={onOpenSavedMessages}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-colors border-b border-gray-50 dark:border-gray-700/50 text-right"
            >
              <div className="w-11 h-11 rounded-full bg-teal-500 flex items-center justify-center shrink-0">
                <Bookmark className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 dark:text-white">پیام‌های ذخیره‌شده</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 truncate">یادداشت‌ها و فایل‌های شخصی</p>
              </div>
            </button>
          )}

          {pinned.length > 0 && (
            <>
              {pinned.map(c => (
                <ChatConversationItem
                  key={c.id}
                  conversation={{
                    ...c,
                    otherUser: {
                      ...c.otherUser,
                      status: presenceMap[c.otherUser.user_id]?.status ?? c.otherUser.status,
                    },
                  }}
                  lastSeen={presenceMap[c.otherUser.user_id]?.last_seen ?? null}
                  isActive={c.id === activeId}
                  currentUserId={currentUserId}
                  onClick={() => onSelect(c.id)}
                  onMentionClick={msgId => onMentionClick?.(c.id, msgId)}
                  onTogglePin={onTogglePin}
                  onAction={onRefresh}
                />
              ))}
              {unpinned.length > 0 && (
                <div className="mx-4 border-t border-gray-100 dark:border-gray-700/60 my-0.5" />
              )}
            </>
          )}

          {unpinned.map(c => (
            <ChatConversationItem
              key={c.id}
              conversation={{
                ...c,
                otherUser: {
                  ...c.otherUser,
                  status: presenceMap[c.otherUser.user_id]?.status ?? c.otherUser.status,
                },
              }}
              lastSeen={presenceMap[c.otherUser.user_id]?.last_seen ?? null}
              isActive={c.id === activeId}
              currentUserId={currentUserId}
              onClick={() => onSelect(c.id)}
              onMentionClick={msgId => onMentionClick?.(c.id, msgId)}
              onTogglePin={onTogglePin}
              onAction={onRefresh}
            />
          ))}

        </div>
      )}
    </div>
  );
}
