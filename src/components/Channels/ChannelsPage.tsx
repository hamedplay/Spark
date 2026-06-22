import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { ChannelSidebar } from './ChannelSidebar';
import { ChannelConversationView } from './ChannelConversationView';
import { CreateChannelModal } from './CreateChannelModal';
import { ChannelActionsPanel } from './ChannelActionsPanel';
import { ChatSettingsPage } from '../Chat/ChatSettingsPage';
import { Channel, ChannelType, ChannelWithMeta, ChannelProfile, GroupTask } from './types';
import { usePermissions } from '../../context/PermissionsContext';

interface Props {
  currentUserId: string | null;
  isAdmin: boolean;
  onNavigateToTasks?: (messageBody: string, messageId: string) => void;
  onOpenDirectChat?: (userId: string) => void;
}

type SidebarPanel = 'settings' | 'actions' | null;

export function ChannelsPage({ currentUserId, isAdmin, onNavigateToTasks, onOpenDirectChat }: Props) {
  const { hasPermission } = usePermissions();
  const [channels, setChannels] = useState<ChannelWithMeta[]>([]);
  const [groups, setGroups] = useState<ChannelWithMeta[]>([]);
  const [allProfiles, setAllProfiles] = useState<ChannelProfile[]>([]);
  const [activeTab, setActiveTab] = useState<'channels' | 'groups'>('channels');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createType, setCreateType] = useState<ChannelType>('channel');
  const [loading, setLoading] = useState(true);
  const [showConversation, setShowConversation] = useState(false);
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>(null);
  const [scrollToMessageId, setScrollToMessageId] = useState<string | null>(null);

  const fetchProfiles = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('user_id, full_name, email, avatar_url');
    if (data) setAllProfiles(data);
  }, []);

  const fetchChannels = useCallback(async () => {
    if (!currentUserId) { setLoading(false); return []; }
    try {
      const { data: memberRows, error: membErr } = await supabase
        .from('channel_members').select('channel_id, role').eq('user_id', currentUserId);
      if (membErr) throw membErr;
      if (!memberRows || !memberRows.length) { setChannels([]); setGroups([]); return []; }

      const channelIds = memberRows.map((m: any) => m.channel_id);
      const { data: raw, error: chanErr } = await supabase
        .from('channels').select('*').in('id', channelIds).order('created_at', { ascending: false });
      if (chanErr) throw chanErr;

      const roleMap = new Map(memberRows.map((m: any) => [m.channel_id, m.role]));

      const unreadMap = new Map<string, number>();
      try {
        const { data: unreadData } = await supabase.rpc('get_channel_unread_counts', { p_user_id: currentUserId });
        for (const row of (unreadData || [])) {
          unreadMap.set(row.channel_id, Number(row.unread_count));
        }
      } catch { /* unread count is non-critical */ }

      const all: ChannelWithMeta[] = (raw || []).map((c: any) => ({
        ...c, myRole: roleMap.get(c.id) ?? null, unreadCount: unreadMap.get(c.id) ?? 0,
      }));
      setChannels(all.filter(c => c.type === 'channel'));
      setGroups(all.filter(c => c.type === 'group'));
      return all;
    } catch (e: any) {
      toast.error(`خطا در بارگذاری: ${e?.message || e}`);
      setChannels([]); setGroups([]);
      return [];
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    fetchProfiles();
    fetchChannels();
    if (!currentUserId) return;
    const sub = supabase.channel('channels-list-rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channels' }, () => fetchChannels())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members' }, () => fetchChannels())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_messages' }, () => fetchChannels())
      .subscribe();
    return () => { supabase.removeChannel(sub); };
  }, [currentUserId, fetchChannels]);

  const handleCreate = async (data: { name: string; description: string; type: ChannelType; is_private: boolean }) => {
    if (!currentUserId) return;

    const { data: channelId, error } = await supabase.rpc('create_channel', {
      p_name: data.name,
      p_description: data.description || null,
      p_type: data.type,
      p_is_private: data.is_private,
    });
    if (error) { toast.error(`خطا در ایجاد: ${error.message}`); throw error; }

    toast.success(`${data.type === 'channel' ? 'کانال' : 'گروه'} با موفقیت ایجاد شد`);
    setShowCreate(false);

    const all = await fetchChannels();
    const newType = data.type === 'channel' ? 'channels' : 'groups';
    setActiveTab(newType);

    const created = (all || []).find(c => c.id === channelId);
    if (created) {
      setSelectedId(created.id);
      setSelectedChannel(created);
      setShowConversation(true);
    } else {
      const { data: ch } = await supabase.from('channels').select('*').eq('id', channelId).single();
      if (ch) { setSelectedId(ch.id); setSelectedChannel(ch); setShowConversation(true); }
    }
  };

  const handleSelect = (id: string) => {
    setSelectedId(id);
    const found = [...channels, ...groups].find(c => c.id === id);
    if (found) setSelectedChannel(found);
    setShowConversation(true);
    setSidebarPanel(null);
  };

  const handleOpenCreate = (type: ChannelType) => {
    if (type === 'channel' && !isAdmin) { toast.error('فقط مدیران می‌توانند کانال ایجاد کنند'); return; }
    setCreateType(type);
    setShowCreate(true);
  };

  const toggleSidebarPanel = (panel: SidebarPanel) => {
    setSidebarPanel(prev => prev === panel ? null : panel);
  };

  const emptyGroupTasks: GroupTask[] = [];

  return (
    <div className="flex h-full bg-gray-50 dark:bg-gray-900 overflow-hidden" dir="rtl">
      {/* Sidebar column — always w-72 on desktop; hides when conversation open on mobile */}
      <div className={`${showConversation ? 'hidden md:flex md:w-72' : 'flex w-full md:w-72'} flex-col h-full flex-shrink-0 border-l border-gray-100 dark:border-gray-700`}>
        {sidebarPanel === 'settings' ? (
          <ChatSettingsPage onClose={() => setSidebarPanel(null)} />
        ) : sidebarPanel === 'actions' ? (
          <ChannelActionsPanel
            currentUserId={currentUserId!}
            channelId={selectedChannel?.id}
            channelName={selectedChannel?.name}
            allProfiles={allProfiles}
            groupTasks={emptyGroupTasks}
            onClose={() => setSidebarPanel(null)}
            onNavigateToMessage={(msgId) => {
              setScrollToMessageId(msgId);
              setSidebarPanel(null);
              setShowConversation(true);
            }}
          />
        ) : (
          <ChannelSidebar
            channels={channels} groups={groups}
            activeTab={activeTab} selectedId={selectedId} isAdmin={isAdmin}
            onTabChange={setActiveTab} onSelect={handleSelect} onCreateChannel={handleOpenCreate}
            loading={loading}
            canCreateChannel={hasPermission('channels_create_channel')}
            canCreateGroup={hasPermission('channels_create_group')}
            onOpenSettings={() => toggleSidebarPanel('settings')}
            onOpenActions={() => toggleSidebarPanel('actions')}
          />
        )}
      </div>

      {/* Right: Conversation */}
      <div className={`flex-1 flex flex-col h-full min-w-0 ${!showConversation && !selectedChannel ? 'hidden md:flex' : 'flex'}`}>
        {selectedChannel ? (
          <ChannelConversationView
            key={selectedChannel.id}
            channel={selectedChannel}
            currentUserId={currentUserId}
            allProfiles={allProfiles}
            onBack={() => setShowConversation(false)}
            isMobile={showConversation}
            scrollToMessageId={scrollToMessageId}
            onScrollHandled={() => setScrollToMessageId(null)}
            onNavigateToTasks={onNavigateToTasks}
            onOpenDirectChat={onOpenDirectChat}
          />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-8">
            <div className="w-16 h-16 rounded-2xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
              <svg className="w-8 h-8 text-teal-500 dark:text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 20l4-16m2 16l4-16M6 9h14M4 15h14" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-bold text-gray-800 dark:text-white">کانال‌ها و گروه‌ها</h3>
              <p className="text-sm text-gray-400 mt-1">یک کانال یا گروه انتخاب کنید</p>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateChannelModal type={createType} onClose={() => setShowCreate(false)} onCreate={handleCreate} />}
    </div>
  );
}
