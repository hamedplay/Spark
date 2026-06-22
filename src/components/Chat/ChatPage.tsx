import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { MessageCircle, Plus, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { ChatSidebar } from './ChatSidebar';
import type { SidebarTab } from './ChatSidebar';
import { ChatConversationView } from './ChatConversationView';
import { ChatActionsPanel } from './ChatActionsPanel';
import { ChatSettingsPage } from './ChatSettingsPage';
import { CallHistoryPage } from './CallHistoryPage';
import { NewConversationModal } from './NewConversationModal';
import type { ConversationWithProfile, UserProfile } from './types';
import { useGlobalCall } from '../../context/GlobalCallContext';

interface Props {
  onNavigateToCalendar?: (mentionedUserIds?: string[], bodyText?: string) => void;
  onNavigateToTasks?: (messageBody: string, messageId: string) => void;
  initialOpenUserId?: string | null;
  onInitialOpenUserConsumed?: () => void;
}

export function ChatPage({ onNavigateToCalendar, onNavigateToTasks, initialOpenUserId, onInitialOpenUserConsumed }: Props) {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserProfile, setCurrentUserProfile] = useState<UserProfile | null>(null);
  const [conversations, setConversations] = useState<ConversationWithProfile[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showNewConv, setShowNewConv] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('chats');

  // Navigation from actions panel
  const [navToConvId, setNavToConvId] = useState<string | null>(null);
  const [navToMsgId, setNavToMsgId] = useState<string | null>(null);

  // Call state is managed globally in GlobalCallContext
  const { startCall: globalStartCall } = useGlobalCall();

  const convChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pendingConvIdRef = useRef<string | null>(null);

  // ── Fetch conversations ──────────────────────────────────────────────────
  const fetchConversations = useCallback(async (uid: string) => {
    const { data, error } = await supabase
      .from('chat_conversations')
      .select('*')
      .or(`participant_a.eq.${uid},participant_b.eq.${uid}`)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (error) { console.error('fetchConversations:', error.message); setLoadingConvs(false); return; }

    // Filter out conversations the current user has deleted
    const visibleData = (data || []).filter(c =>
      c.participant_a === uid ? !c.deleted_for_a : !c.deleted_for_b
    );

    if (visibleData.length === 0) { setConversations([]); setLoadingConvs(false); return; }

    const otherIds = [...new Set(
      visibleData.map(c => c.participant_a === uid ? c.participant_b : c.participant_a).filter(Boolean)
    )] as string[];

    const convIds = visibleData.map(c => c.id);
    const threshold = new Date(Date.now() - 3 * 60 * 1000).toISOString();

    // Fetch profiles, presence, bulk unread counts, and mentions all in parallel
    const [profilesRes, presenceRes, unreadRes, mentionRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('user_id, full_name, email, avatar_url')
        .in('user_id', otherIds),
      supabase
        .from('user_presence')
        .select('user_id, is_online, status, last_seen')
        .in('user_id', otherIds),
      supabase.rpc('get_unread_counts', { p_user_id: uid }),
      supabase
        .from('chat_messages')
        .select('id, conversation_id')
        .in('conversation_id', convIds)
        .neq('sender_id', uid)
        .not('read_by', 'cs', `{${uid}}`)
        .contains('mentioned_user_ids', [uid])
        .order('created_at', { ascending: false }),
    ]);

    const presenceMap = new Map<string, { is_online: boolean; status: string; last_seen: string }>(
      (presenceRes.data || []).map((p: any) => [p.user_id, {
        is_online: p.is_online && p.last_seen >= threshold,
        status: p.status || 'offline',
        last_seen: p.last_seen,
      }])
    );

    const profileMap = new Map<string, UserProfile>(
      (profilesRes.data || []).map((p: any) => {
        const presence = presenceMap.get(p.user_id);
        return [p.user_id, {
          ...p,
          status: presence?.status ?? 'offline',
          is_online: presence?.is_online ?? false,
          last_seen: presence?.last_seen ?? null,
        }];
      })
    );

    const countMap = new Map<string, number>(
      (unreadRes.data || []).map((r: any) => [r.conversation_id, Number(r.unread_count)])
    );

    // First unread mention per conversation
    const mentionMap = new Map<string, string>();
    for (const m of (mentionRes.data || [])) {
      if (!mentionMap.has(m.conversation_id)) mentionMap.set(m.conversation_id, m.id);
    }

    const mapped = visibleData.map(c => {
      const otherId = c.participant_a === uid ? c.participant_b : c.participant_a;
      return {
        ...c,
        otherUser: profileMap.get(otherId) ?? { user_id: otherId, full_name: null, email: null },
        unreadCount: countMap.get(c.id) || 0,
        hasMention: mentionMap.has(c.id),
        mentionMessageId: mentionMap.get(c.id) || null,
        isPinned: c.participant_a === uid ? !!c.pinned_for_a : !!c.pinned_for_b,
      };
    });
    setConversations(mapped);
    // If the active conversation was deleted, clear it and return to sidebar
    setActiveId(prev => prev && mapped.some(c => c.id === prev) ? prev : null);
    setLoadingConvs(false);
  }, []);

  // ── Init ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const channelName = `convs-${Date.now()}`;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || cancelled) return;
      setCurrentUserId(user.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('user_id, full_name, email, avatar_url')
        .eq('user_id', user.id)
        .maybeSingle();
      if (cancelled) return;
      setCurrentUserProfile(profile || { user_id: user.id, full_name: null, email: user.email || null });

      await fetchConversations(user.id);
      if (cancelled) return;

      convChannelRef.current = supabase
        .channel(channelName)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_conversations' },
          () => fetchConversations(user.id))
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'chat_messages' },
          () => fetchConversations(user.id))
        .subscribe();

    })();
    return () => {
      cancelled = true;
      if (convChannelRef.current) {
        supabase.removeChannel(convChannelRef.current);
        convChannelRef.current = null;
      }
    };
  }, []);

  // ── Activate pending conversation after fetch ────────────────────────────
  useEffect(() => {
    if (!pendingConvIdRef.current) return;
    const found = conversations.find(c => c.id === pendingConvIdRef.current);
    if (found) {
      setActiveId(pendingConvIdRef.current);
      pendingConvIdRef.current = null;
    }
  }, [conversations]);

  // ── When the active conversation is removed (e.g. deleted), show sidebar ──
  useEffect(() => {
    if (activeId === null) setShowSidebar(true);
  }, [activeId]);

  // ── Auto-open DM from external navigation ───────────────────────────────
  useEffect(() => {
    if (!initialOpenUserId || !currentUserId || loadingConvs) return;
    (async () => {
      const { data: convId, error } = await supabase.rpc('find_or_create_direct_conversation', {
        user_a: currentUserId,
        user_b: initialOpenUserId,
      });
      if (error || !convId) { toast.error('خطا در باز کردن چت'); return; }
      pendingConvIdRef.current = convId as string;
      await fetchConversations(currentUserId);
      setShowSidebar(false);
      setSidebarTab('chats');
      onInitialOpenUserConsumed?.();
    })();
  }, [initialOpenUserId, currentUserId, loadingConvs]);

  // ── New conversation ─────────────────────────────────────────────────────
  const handleNewConv = async (user: UserProfile) => {
    if (!currentUserId) return;
    const { data: convId, error } = await supabase.rpc('find_or_create_direct_conversation', {
      user_a: currentUserId,
      user_b: user.user_id,
    });
    if (error || !convId) { toast.error('خطا: ' + (error?.message || 'ناشناس')); return; }
    setShowNewConv(false);
    pendingConvIdRef.current = convId as string;
    await fetchConversations(currentUserId);
    setShowSidebar(false);
    setSidebarTab('chats');
  };

  // ── Optimistic pin toggle ─────────────────────────────────────────────────
  const handleTogglePin = useCallback((convId: string) => {
    setConversations(prev => prev.map(c =>
      c.id === convId ? { ...c, isPinned: !c.isPinned } : c
    ));
  }, []);

  // ── Open / create Saved Messages (self-chat) ──────────────────────────────
  const handleOpenSavedMessages = async () => {
    if (!currentUserId) return;
    const { data: convId, error } = await supabase.rpc('find_or_create_direct_conversation', {
      user_a: currentUserId,
      user_b: currentUserId,
    });
    if (error || !convId) { toast.error('خطا در باز کردن پیام‌های ذخیره‌شده'); return; }
    pendingConvIdRef.current = convId as string;
    await fetchConversations(currentUserId);
    setShowSidebar(false);
    setSidebarTab('chats');
  };

  // ── Call helpers ─────────────────────────────────────────────────────────
  const startCall = async (callType: 'audio' | 'video') => {
    if (!currentUserId || !activeConv) return;
    await globalStartCall(callType, activeConv.otherUser, activeConv.id);
  };

  // ── Navigation from actions panel ────────────────────────────────────────
  const handleNavigateToMessage = (convId: string, msgId: string) => {
    setShowActions(false);
    setSidebarTab('chats');
    setNavToConvId(convId);
    setNavToMsgId(msgId);
    if (activeId !== convId) {
      setActiveId(convId);
    }
    setShowSidebar(false);
  };

  const handleSelectConv = (id: string) => {
    setActiveId(id);
    setShowSidebar(false);
    setShowSettings(false);
    setSidebarTab('chats');
  };

  // ── Call from history ────────────────────────────────────────────────────
  const handleStartCallFromHistory = async (otherUser: UserProfile, callType: 'audio' | 'video') => {
    if (!currentUserId) return;
    const { data: convId, error } = await supabase.rpc('find_or_create_direct_conversation', {
      user_a: currentUserId,
      user_b: otherUser.user_id,
    });
    if (error || !convId) { toast.error('خطا در برقراری تماس'); return; }
    pendingConvIdRef.current = convId as string;
    await fetchConversations(currentUserId);
    setSidebarTab('chats');
    setShowSidebar(false);
    await globalStartCall(callType, otherUser, convId as string);
  };

  const activeConv = conversations.find(c => c.id === activeId) || null;

  if (!currentUserId) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-teal-500" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden" dir="rtl">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <div className={`${showSidebar ? 'flex' : 'hidden lg:flex'} w-full lg:w-80 xl:w-96 flex-shrink-0 flex-col border-l border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800`}>
        {loadingConvs ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-7 h-7 animate-spin text-teal-500" />
          </div>
        ) : showActions ? (
          <ChatActionsPanel
            currentUserId={currentUserId}
            onClose={() => setShowActions(false)}
            onNavigateToMessage={handleNavigateToMessage}
          />
        ) : showSettings ? (
          <ChatSettingsPage onClose={() => setShowSettings(false)} />
        ) : sidebarTab === 'calls' ? (
          <CallHistoryPage
            currentUserId={currentUserId}
            onStartCall={handleStartCallFromHistory}
            onClose={() => setSidebarTab('chats')}
          />
        ) : (
          <ChatSidebar
            conversations={conversations}
            activeId={activeId}
            currentUserId={currentUserId}
            onSelect={handleSelectConv}
            onNewConversation={() => setShowNewConv(true)}
            onRefresh={() => fetchConversations(currentUserId)}
            onTogglePin={handleTogglePin}
            onOpenSavedMessages={handleOpenSavedMessages}
            onToggleActions={() => { setShowActions(v => !v); setShowSettings(false); }}
            showActions={showActions}
            activeTab={sidebarTab}
            onTabChange={tab => { setSidebarTab(tab); }}
            onOpenSettings={() => { setShowSettings(true); setShowActions(false); }}
            onMentionClick={(convId, msgId) => {
              setActiveId(convId);
              setNavToConvId(convId);
              setNavToMsgId(msgId);
              setShowSidebar(false);
            }}
          />
        )}
      </div>

      {/* ── Main area ───────────────────────────────────────────────────── */}
      <div className={`${!showSidebar ? 'flex' : 'hidden lg:flex'} flex-1 flex-col overflow-hidden`}>
        {/* Conversation view */}
        {sidebarTab === 'chats' && (
          activeConv ? (
            <ChatConversationView
              key={activeConv.id}
              conversation={activeConv}
              currentUserId={currentUserId}
              currentUserProfile={currentUserProfile}
              onBack={() => { setShowSidebar(true); setActiveId(null); }}
              onNavigateToCalendar={onNavigateToCalendar}
              onNavigateToTasks={onNavigateToTasks}
              onConversationUpdate={() => fetchConversations(currentUserId)}
              initialScrollToMessageId={navToConvId === activeConv.id ? navToMsgId : null}
              onScrollToMessageConsumed={() => { setNavToConvId(null); setNavToMsgId(null); }}
              onStartCall={startCall}
              onOpenDirectChat={async (userId) => {
                const { data: convId, error } = await supabase.rpc('find_or_create_direct_conversation', {
                  user_a: currentUserId,
                  user_b: userId,
                });
                if (error || !convId) { toast.error('خطا در باز کردن چت'); return; }
                pendingConvIdRef.current = convId as string;
                await fetchConversations(currentUserId);
                setShowSidebar(false);
                setSidebarTab('chats');
              }}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900">
              <MessageCircle className="w-16 h-16 opacity-20" />
              <p className="text-lg font-medium">یک مکالمه را انتخاب کنید</p>
              <p className="text-sm opacity-70">یا گفتگوی جدید شروع کنید</p>
              <button
                onClick={() => setShowNewConv(true)}
                className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 text-white px-5 py-2.5 rounded-xl font-medium transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" /> گفتگوی جدید
              </button>
            </div>
          )
        )}
        {(sidebarTab === 'calls' || showActions || showSettings) && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-900">
            <MessageCircle className="w-16 h-16 opacity-20" />
            <p className="text-lg font-medium">یک مکالمه را انتخاب کنید</p>
          </div>
        )}
      </div>

      {/* ── New conversation modal ───────────────────────────────────────── */}
      {showNewConv && (
        <NewConversationModal
          currentUserId={currentUserId}
          onSelect={handleNewConv}
          onClose={() => setShowNewConv(false)}
        />
      )}
    </div>
  );
}
