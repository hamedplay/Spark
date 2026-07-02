import { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronRight, Search, Phone, Video, Info, Star, Bell, X, Clock, MessageCircle, AtSign, CircleCheck as CheckCircle, Bookmark, CalendarDays } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { ChatMessage } from './ChatMessage';
import { ChatInputBar } from './ChatInputBar';
import { UserAvatar } from './ChatConversationItem';
import { loadChatTheme } from './ChatSettingsPage';
import type { ChatThemeSettings } from './ChatSettingsPage';
import moment from 'moment-jalaali';
import toast from 'react-hot-toast';
import { useGlobalCall } from '../../context/GlobalCallContext';
import type {
  ConversationWithProfile, MessageWithMeta, ChatMessage as ChatMsg,
  UserProfile, ReactionCount, MessageStatus, ChatReminder,
} from './types';

interface Props {
  conversation: ConversationWithProfile;
  currentUserId: string;
  currentUserProfile: UserProfile | null;
  onBack: () => void;
  onNavigateToCalendar?: (mentionedUserIds?: string[], bodyText?: string) => void;
  onNavigateToTasks?: (messageBody: string, messageId: string) => void;
  onConversationUpdate: () => void;
  initialScrollToMessageId?: string | null;
  onScrollToMessageConsumed?: () => void;
  onStartCall?: (callType: 'audio' | 'video') => void;
  onOpenDirectChat?: (userId: string) => void;
}

interface StarredItem {
  message: MessageWithMeta;
  conversationId: string;
  otherUserName: string;
}

export function ChatConversationView({
  conversation, currentUserId, currentUserProfile, onBack, onNavigateToCalendar, onNavigateToTasks,
  onConversationUpdate, onStartCall,
  onOpenDirectChat,
}: Props) {
  const { triggerUrgentAlarm: globalTriggerUrgentAlarm } = useGlobalCall();

  const playBeep = () => {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.4);
    } catch { /* audio not available */ }
  };
  const [messages, setMessages] = useState<MessageWithMeta[]>([]);
  const [replyingTo, setReplyingTo] = useState<ChatMsg | null>(null);
  const [editingMessage, setEditingMessage] = useState<ChatMsg | null>(null);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [reminderAlarm, setReminderAlarm] = useState<ChatReminder | null>(null);
  const [showStarredModal, setShowStarredModal] = useState(false);
  const [showRemindersModal, setShowRemindersModal] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [reminders, setReminders] = useState<ChatReminder[]>([]);
  const [globalStarred, setGlobalStarred] = useState<StarredItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [chatTheme, setChatTheme] = useState<ChatThemeSettings>(loadChatTheme);
  const ONLINE_THRESHOLD = 3 * 60 * 1000;
  const isUserOnline = (lastSeen?: string | null) => {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < ONLINE_THRESHOLD;
  };
  const getLastSeenText = (lastSeen?: string | null) => {
  if (!lastSeen) return 'آفلاین';

  const diff = Date.now() - new Date(lastSeen).getTime();

  if (diff < ONLINE_THRESHOLD) return 'آنلاین';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} دقیقه پیش`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)} ساعت پیش`;

  return moment(lastSeen).format('jYYYY/jMM/jDD');
  };
  const [otherUserPresence, setOtherUserPresence] = useState<{ last_seen: string | null } | null>(null);
  // Mention bar: messages in this conversation that mention the current user
  const [mentionBarItems, setMentionBarItems] = useState<{ id: string; body: string | null; senderName: string }[]>([]);
  const [dismissedMentionIds, setDismissedMentionIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`dismissed_mentions_conv_${conversation.id}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const reminderCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedReminderIds = useRef<Set<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const messageRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [jumpPickerDate, setJumpPickerDate] = useState<{ jy: number; jm: number; jd: number } | null>(null);

  useEffect(() => {
    fetchMessages();
    subscribeToMessages();
    markAsRead();
    fetchAllUsers();
    fetchReminders();
    fetchMentionBar();
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (reminderCheckRef.current) clearInterval(reminderCheckRef.current);
    };
  }, [conversation.id]);

  useEffect(() => {
    if (!currentUserId) return;
    const updatePresence = async () => {
      await supabase
        .from('user_presence')
        .upsert({
          user_id: currentUserId,
          last_seen: new Date().toISOString()
        });
    };
    updatePresence();
    const interval = setInterval(updatePresence, 20000);
    return () => clearInterval(interval);
  }, [currentUserId]);
  
  useEffect(() => {
  const loadPresence = async () => {
    const { data } = await supabase
      .from('user_presence')
      .select('last_seen')
      .eq('user_id', conversation.otherUser.user_id)
      .maybeSingle();

    if (data) setOtherUserPresence(data);
  };

  loadPresence();

  const channel = supabase
    .channel(`presence-${conversation.otherUser.user_id}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'user_presence',
        filter: `user_id=eq.${conversation.otherUser.user_id}`
      },
      (payload) => {
        setOtherUserPresence(payload.new as any);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
  }, [conversation.otherUser.user_id]);
  // Reminder alarm: check every 30s if any reminder's time has passed
  useEffect(() => {
    const check = () => {
      const now = Date.now();
      for (const r of reminders) {
        if (firedReminderIds.current.has(r.id)) continue;
        if (new Date(r.remind_at).getTime() <= now) {
          firedReminderIds.current.add(r.id);
          setReminderAlarm(r);
          playBeep();
        }
      }
    };
    reminderCheckRef.current = setInterval(check, 30_000);
    check(); // also check immediately when reminders update
    return () => { if (reminderCheckRef.current) clearInterval(reminderCheckRef.current); };
  }, [reminders]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail) setChatTheme(detail as ChatThemeSettings);
      else setChatTheme(loadChatTheme());
    };
    window.addEventListener('chatThemeChanged', handler);
    return () => window.removeEventListener('chatThemeChanged', handler);
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail?.conversationId === conversation.id) {
        fetchMessages();
      }
    };
    window.addEventListener('chat-messages-cleared', handler);
    return () => window.removeEventListener('chat-messages-cleared', handler);
  }, [conversation.id, fetchMessages]);

  const fetchAllUsers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, avatar_url')
      .limit(500);
    setAllUsers(data || []);
  };

  const fetchMentionBar = async () => {
    // Find messages in this conversation that mention the current user and were not sent by them
    const { data } = await supabase
      .from('chat_messages')
      .select('id, body, sender_id')
      .eq('conversation_id', conversation.id)
      .eq('deleted_for_all', false)
      .neq('sender_id', currentUserId)
      .contains('mentioned_user_ids', [currentUserId])
      .order('created_at', { ascending: false })
      .limit(20);
    if (!data || data.length === 0) return;
    const senderIds = [...new Set(data.map((m: any) => m.sender_id))];
    const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', senderIds);
    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
    setMentionBarItems(data.map((m: any) => ({
      id: m.id,
      body: m.body,
      senderName: profileMap.get(m.sender_id)?.full_name || profileMap.get(m.sender_id)?.email || 'کاربر',
    })));
  };

  const fetchReminders = async () => {
    const { data } = await supabase
      .from('chat_reminders')
      .select('*, chat_messages(id, body, conversation_id)')
      .eq('user_id', currentUserId)
      .eq('is_dismissed', false)
      .order('remind_at', { ascending: true });
    setReminders((data || []) as any);
  };

  const fetchGlobalStarred = async () => {
    // Get all starred messages by this user across all conversations
    const { data: stars } = await supabase
      .from('chat_message_stars')
      .select('message_id')
      .eq('user_id', currentUserId);
    if (!stars || stars.length === 0) { setGlobalStarred([]); return; }
    const msgIds = stars.map((s: any) => s.message_id);
    const { data: msgs } = await supabase
      .from('chat_messages')
      .select('*')
      .in('id', msgIds)
      .eq('deleted_for_all', false);
    if (!msgs) { setGlobalStarred([]); return; }

    // Get conversation info for each message
    const convIds = [...new Set(msgs.map((m: any) => m.conversation_id))];
    const { data: convs } = await supabase
      .from('chat_conversations')
      .select('id, participant_a, participant_b')
      .in('id', convIds);
    const otherUserIds = (convs || []).map((c: any) =>
      c.participant_a === currentUserId ? c.participant_b : c.participant_a
    );
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, email')
      .in('user_id', [...new Set(otherUserIds)]);
    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));
    const convMap = new Map((convs || []).map((c: any) => [c.id, c]));

    const items: StarredItem[] = msgs.map((m: any) => {
      const conv = convMap.get(m.conversation_id);
      const otherId = conv ? (conv.participant_a === currentUserId ? conv.participant_b : conv.participant_a) : null;
      const otherProfile = otherId ? profileMap.get(otherId) : null;
      return {
        message: { ...m, senderProfile: null, reactions: [], isStarred: true, replyTarget: null, tags: [], status: m.status || 'pending', read_by: m.read_by || [] },
        conversationId: m.conversation_id,
        otherUserName: otherProfile?.full_name || otherProfile?.email || 'کاربر',
      };
    });
    setGlobalStarred(items);
  };

  const fetchMessages = useCallback(async () => {
    const { data: msgs, error: msgsError } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('conversation_id', conversation.id)
      .eq('deleted_for_all', false)
      .order('created_at', { ascending: false })
      .limit(100);

    if (msgsError || !msgs) { setMessages([]); return; }

    // Empty conversation — no further queries needed
    if (msgs.length === 0) { setMessages([]); setTimeout(() => scrollToBottom(), 50); return; }

    const msgIds = msgs.map(m => m.id);
    const senderIds = [...new Set(msgs.map(m => m.sender_id))];

    const [reactionsRes, starsRes, profilesRes, tagsAssignRes] = await Promise.all([
      supabase.from('chat_message_reactions').select('*').in('message_id', msgIds),
      supabase.from('chat_message_stars').select('*').eq('user_id', currentUserId).in('message_id', msgIds),
      supabase.from('profiles').select('user_id, full_name, email, avatar_url').in('user_id', senderIds),
      supabase.from('chat_message_tag_assignments')
        .select('message_id, chat_tags(id, name, color, user_id)')
        .eq('user_id', currentUserId)
        .in('message_id', msgIds),
    ]);

    const reactionsMap = new Map<string, ReactionCount[]>();
    for (const r of (reactionsRes.data || [])) {
      const arr = reactionsMap.get(r.message_id) || [];
      const existing = arr.find(x => x.emoji === r.emoji);
      if (existing) { existing.count++; if (r.user_id === currentUserId) existing.reactedByMe = true; }
      else arr.push({ emoji: r.emoji, count: 1, reactedByMe: r.user_id === currentUserId });
      reactionsMap.set(r.message_id, arr);
    }

    const starredIds = new Set((starsRes.data || []).map((s: any) => s.message_id));
    const profileMap = new Map((profilesRes.data || []).map((p: any) => [p.user_id, p]));
    const tagsMap = new Map<string, any[]>();
    for (const a of (tagsAssignRes.data || [])) {
      const existing = tagsMap.get(a.message_id) || [];
      if ((a as any).chat_tags) existing.push((a as any).chat_tags);
      tagsMap.set(a.message_id, existing);
    }

    const replyIds = msgs.filter(m => m.reply_to_id).map(m => m.reply_to_id);
    const replyTargetMap = new Map<string, ChatMsg>();
    if (replyIds.length > 0) {
      const { data: replyMsgs } = await supabase.from('chat_messages').select('*').in('id', replyIds);
      (replyMsgs || []).forEach((m: ChatMsg) => replyTargetMap.set(m.id, m));
    }

    const enriched: MessageWithMeta[] = msgs
      .filter(m => !(m.deleted_for_sender && m.sender_id === currentUserId))
      .filter(m => !(m.deleted_for_receiver && m.sender_id !== currentUserId))
      .map(m => ({
        ...m,
        status: m.status || 'pending',
        read_by: m.read_by || [],
        senderProfile: profileMap.get(m.sender_id) || null,
        reactions: reactionsMap.get(m.id) || [],
        isStarred: starredIds.has(m.id),
        replyTarget: m.reply_to_id ? replyTargetMap.get(m.reply_to_id) || null : null,
        tags: tagsMap.get(m.id) || [],
      }))
      .reverse();

    setMessages(enriched);
    setTimeout(() => scrollToBottom(), 50);

    // Mark incoming as read using a secure DB function (atomically appends uid to read_by)
    const unreadIncoming = msgs.filter(m => m.sender_id !== currentUserId && !(m.read_by || []).includes(currentUserId));
    if (unreadIncoming.length > 0) {
      // Single RPC call marks all unread messages in this conversation as read
      supabase.rpc('mark_conversation_messages_read', { p_conversation_id: conversation.id })
        .then(() => { /* triggers realtime UPDATE for sender to see eye icon */ });

      // Show full-screen alarm for any unread urgent messages (uses global dedup to prevent re-firing)
      const urgentUnread = unreadIncoming.filter(m => m.message_type === 'urgent');
      if (urgentUnread.length > 0) {
        const latest = urgentUnread[urgentUnread.length - 1];
        globalTriggerUrgentAlarm({
          id: latest.id,
          body: latest.body,
          sender_name: profileMap.get(latest.sender_id)?.full_name || conversation.otherUser.full_name || 'کاربر',
          created_at: latest.created_at,
          conversation_id: conversation.id,
        });
      }
    }
  }, [conversation.id, currentUserId]);

  const subscribeToMessages = () => {

  // جلوگیری از duplicate channel
  if (channelRef.current) {
    console.log('Removing previous realtime channel...');
    supabase.removeChannel(channelRef.current);
    channelRef.current = null;
  }

  const channel = supabase
    .channel(`chat-msgs-${conversation.id}`)

    // NEW MESSAGE
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversation.id}`
      },
      (payload) => {
        const newMsg = payload.new as any;

        console.log('[RT INSERT]', {
          messageId: newMsg.id,
          sender: newMsg.sender_id,
          conversation: newMsg.conversation_id,
          myUserId: currentUserId,
          isMine: newMsg.sender_id === currentUserId
        });

        if (newMsg.sender_id !== currentUserId) {
          if (newMsg.message_type === 'important') {
            toast('پیام مهم دریافت شد', {
              duration: 4000,
              icon: '⚠️'
            });
          }
        }

        fetchMessages();
        onConversationUpdate();
      }
    )

    // UPDATE MESSAGE
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversation.id}`
      },
      (payload) => {
        console.log('[RT UPDATE]', payload);
        fetchMessages();
        onConversationUpdate();
      }
    )

    // DELETE MESSAGE
    .on(
      'postgres_changes',
      {
        event: 'DELETE',
        schema: 'public',
        table: 'chat_messages',
        filter: `conversation_id=eq.${conversation.id}`
      },
      (payload) => {
        console.log('[RT DELETE]', payload);
        fetchMessages();
        onConversationUpdate();
      }
    )

    // REACTIONS
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'chat_message_reactions'
      },
      (payload) => {
        console.log('[RT REACTION]', payload);
        fetchMessages();
      }
    )

    // READ RECEIPTS
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'chat_message_read_receipts',
        filter: `conversation_id=eq.${conversation.id}`
      },
      (payload) => {
        console.log('[RT READ RECEIPT]', payload);
        fetchMessages();
      }
    )

    .subscribe((status) => {
      console.log('Realtime status:', status);

      if (status === 'SUBSCRIBED') {
        console.log('✅ Realtime connected for conversation:', conversation.id);
      }

      if (status === 'CHANNEL_ERROR') {
        console.error('❌ Realtime channel error');
      }

      if (status === 'TIMED_OUT') {
        console.error('❌ Realtime timed out');
      }

      if (status === 'CLOSED') {
        console.warn('⚠️ Realtime channel closed');
      }
    });

  channelRef.current = channel;
};

  const dismissReminderAlarm = async () => {
    if (reminderAlarm) {
      await supabase.from('chat_reminders').update({ is_dismissed: true }).eq('id', reminderAlarm.id);
      fetchReminders();
    }
    setReminderAlarm(null);
  };

  const markAsRead = async () => {
    // Update read receipt timestamp
    await supabase.from('chat_message_read_receipts').upsert({
      conversation_id: conversation.id, user_id: currentUserId, last_read_at: new Date().toISOString(),
    }, { onConflict: 'conversation_id,user_id' });
    // Mark all unread messages as read via secure DB function
    await supabase.rpc('mark_conversation_messages_read', { p_conversation_id: conversation.id });
  };

  const scrollToBottom = () => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  };


  const scrollToMessage = async (messageId: string) => {
    const tryScroll = () => {
      const el = messageRefs.current.get(messageId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-amber-400', 'ring-offset-1');
        setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-1'), 2000);
        return true;
      }
      return false;
    };

    if (tryScroll()) return;

    // Message not in DOM — fetch it from DB and inject into messages list
    const { data: msg } = await supabase
      .from('chat_messages')
      .select('*')
      .eq('id', messageId)
      .maybeSingle();
    if (!msg) return;

    const senderIds = [...new Set([msg.sender_id])];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('user_id, full_name, email, avatar_url')
      .in('user_id', senderIds);
    const profileMap = new Map((profiles || []).map((p: any) => [p.user_id, p]));

    const injected: MessageWithMeta = {
      ...msg,
      status: msg.status || 'pending',
      read_by: msg.read_by || [],
      senderProfile: profileMap.get(msg.sender_id) || null,
      reactions: [],
      isStarred: false,
      replyTarget: null,
      tags: [],
    };

    setMessages(prev => {
      if (prev.some(m => m.id === messageId)) return prev;
      const insertIdx = prev.findIndex(m => m.created_at > msg.created_at);
      if (insertIdx === -1) return [...prev, injected];
      return [...prev.slice(0, insertIdx), injected, ...prev.slice(insertIdx)];
    });

    // Wait for render then scroll
    setTimeout(() => tryScroll(), 150);
  };

  const jumpToDate = async (jy: number, jm: number, jd: number) => {
    setJumpPickerDate(null);
    const startIso = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jMM/jDD').toISOString();
    const endIso = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jMM/jDD').endOf('day').toISOString();
    // Try to find first message on that day in current loaded messages
    const inMem = messages.find(m => m.created_at >= startIso && m.created_at <= endIso);
    if (inMem) { scrollToMessage(inMem.id); return; }
    // Fetch from DB
    const { data } = await supabase
      .from('chat_messages')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('deleted_for_all', false)
      .gte('created_at', startIso)
      .lte('created_at', endIso)
      .order('created_at', { ascending: true })
      .limit(1);
    if (data?.length) {
      scrollToMessage(data[0].id);
    } else {
      toast('پیامی در این تاریخ یافت نشد', { icon: '📅' });
    }
  };


  const handleReact = async (messageId: string, emoji: string) => {
    const msg = messages.find(m => m.id === messageId);
    if (!msg) return;
    const existing = msg.reactions.find(r => r.emoji === emoji && r.reactedByMe);
    if (existing) {
      await supabase.from('chat_message_reactions').delete().eq('message_id', messageId).eq('user_id', currentUserId).eq('emoji', emoji);
    } else {
      await supabase.from('chat_message_reactions').insert({ message_id: messageId, user_id: currentUserId, emoji });
    }
    fetchMessages();
  };

  const handleStar = async (messageId: string, isStarred: boolean) => {
    if (isStarred) {
      await supabase.from('chat_message_stars').delete().eq('message_id', messageId).eq('user_id', currentUserId);
    } else {
      await supabase.from('chat_message_stars').insert({ message_id: messageId, user_id: currentUserId });
      // Notification
      await supabase.from('notifications').insert({ user_id: currentUserId, title: 'پیام نشانه‌دار شد', message: 'یک پیام را نشانه‌دار کردید', type: 'chat', read: false });
    }
    fetchMessages();
  };

  const handleDeleteForMe = async (messageId: string) => {
    const { error } = await supabase.rpc('delete_chat_message_for_me', { p_message_id: messageId });
    if (error) {
      toast.error('خطا در حذف پیام');
    } else {
      fetchMessages();
    }
  };

  const handleDeleteForAll = async (messageId: string) => {
    const { error } = await supabase.rpc('delete_chat_message_for_all', { p_message_id: messageId });
    if (error) {
      toast.error('خطا در حذف برای همه');
    } else {
      fetchMessages(); onConversationUpdate();
    }
  };

  const handleStatusChange = async (messageId: string, status: MessageStatus) => {
    await supabase.from('chat_messages').update({ status }).eq('id', messageId);
    fetchMessages();
    // Notify
    await supabase.from('notifications').insert({
      user_id: currentUserId,
      title: 'وضعیت پیام تغییر کرد',
      message: status === 'done' ? 'پیام به وضعیت رسیدگی شده تغییر یافت' : status === 'in_progress' ? 'پیام در حال رسیدگی است' : 'وضعیت پیام بازنشانی شد',
      type: 'chat',
      read: false,
    });
  };

  const handleScheduleMeeting = (mentionedIds: string[], bodyText: string) => {
    onNavigateToCalendar?.(mentionedIds, bodyText);
  };

  const dismissReminder = async (reminderId: string) => {
    await supabase.from('chat_reminders').update({ is_dismissed: true }).eq('id', reminderId);
    fetchReminders();
  };

  const filteredMessages = searchQuery.trim()
    ? messages.filter(m => m.body?.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages;

  const grouped: { date: string; messages: MessageWithMeta[] }[] = [];
  for (const msg of filteredMessages) {
    const date = moment(msg.created_at).format('jYYYY/jMM/jDD');
    const last = grouped[grouped.length - 1];
    if (last && last.date === date) last.messages.push(msg);
    else grouped.push({ date, messages: [msg] });
  }

  const formatDate = (jDate: string) => {
    const today = moment().format('jYYYY/jMM/jDD');
    const yesterday = moment().subtract(1, 'day').format('jYYYY/jMM/jDD');
    if (jDate === today) return 'امروز';
    if (jDate === yesterday) return 'دیروز';
    return jDate;
  };

  const isSavedMessages = conversation.otherUser.user_id === currentUserId;
  const otherName = isSavedMessages ? 'پیام‌های ذخیره‌شده' : (conversation.otherUser.full_name || conversation.otherUser.email || 'کاربر');
  const localStarredCount = messages.filter(m => m.isStarred).length;

  return (
    <div className="flex flex-col h-full overflow-hidden" dir="rtl">
      {/* Reminder alarm — full-screen call-like modal */}
      {reminderAlarm && (
        <div
          className="fixed inset-0 flex items-center justify-center bg-black/75 backdrop-blur-sm"
          style={{ zIndex: 9998 }}
          onMouseDown={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
        >
          {/* Pulsing amber ring */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-80 h-80 rounded-full border-4 border-amber-400 animate-ping opacity-20" />
          </div>
          <div className="relative bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md mx-4 overflow-hidden border-4 border-amber-400">
            <div className="bg-amber-400 px-6 py-5 flex items-center gap-3">
              <Bell className="w-9 h-9 text-white animate-bounce flex-shrink-0" />
              <div>
                <p className="text-white font-bold text-xl">یادآوری!</p>
                <p className="text-amber-900 text-sm mt-0.5 font-medium">
                  {moment((reminderAlarm as any).remind_at).format('HH:mm — jYYYY/jMM/jDD')}
                </p>
              </div>
            </div>
            <div className="px-6 py-6">
              {(reminderAlarm as any).chat_messages?.body && (
                <div className="bg-gray-50 dark:bg-gray-800 rounded-xl px-4 py-3 mb-4 border border-gray-100 dark:border-gray-700">
                  <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">
                    {(reminderAlarm as any).chat_messages.body}
                  </p>
                </div>
              )}
              {reminderAlarm.note && (
                <p className="text-gray-800 dark:text-white text-base leading-relaxed font-medium">{reminderAlarm.note}</p>
              )}
              <p className="text-xs text-amber-500 mt-3 text-center animate-pulse">یادآوری رسیده است</p>
            </div>
            <div className="px-6 pb-6 flex gap-3">
              <button
                onClick={dismissReminderAlarm}
                className="flex-1 flex items-center justify-center gap-2 bg-amber-400 hover:bg-amber-500 active:bg-amber-600 text-white font-bold py-3.5 rounded-2xl transition-colors text-base shadow-lg"
              >
                <CheckCircle className="w-5 h-5" /> متوجه شدم
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 flex-shrink-0 min-w-0">
        <button onClick={onBack} className="lg:hidden p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg flex-shrink-0">
          <ChevronRight className="w-5 h-5 dark:text-white" />
        </button>
        {/* Avatar with status dot */}
        <div className="relative flex-shrink-0">
          {isSavedMessages ? (
            <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center">
              <Bookmark className="w-4 h-4 text-white" />
            </div>
          ) : (
            <>
              <UserAvatar name={otherName} size="sm" avatarUrl={conversation.otherUser.avatar_url} />
              {(() => {
                const online = isUserOnline(otherUserPresence?.last_seen);
                const dotColor = online ? 'bg-green-500' : 'bg-gray-400';
                return <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-white dark:border-gray-900 ${dotColor}`} />;
              })()}
            </>
          )}
        </div>
        {/* On desktop: show name + status; on mobile: avatar only */}
        <div className="hidden sm:block flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm truncate">{otherName}</h3>
          {isSavedMessages ? (
            <p className="text-xs text-teal-500 truncate">پیام‌های شخصی شما</p>
          ) : (
            (() => {
              const online = isUserOnline(otherUserPresence?.last_seen);
              return (
                <p className={`text-xs truncate ${online ? 'text-green-500' : 'text-gray-400'}`}>
                  {getLastSeenText(otherUserPresence?.last_seen)}
                </p>
              );
            })()
          )}
        </div>
        {/* On mobile: spacer to push icons to end */}
        <div className="flex-1 sm:hidden" />

        {/* Action icons — all visible on all screen sizes */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {/* Starred messages */}
          <button
            onClick={() => { setShowStarredModal(true); fetchGlobalStarred(); }}
            className="relative flex items-center justify-center p-2 rounded-xl transition-colors text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="پیام‌های نشانه‌دار"
          >
            <Star className={`w-4 h-4 ${localStarredCount > 0 ? 'fill-yellow-400 text-yellow-400' : ''}`} />
            {localStarredCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-yellow-400 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {localStarredCount}
              </span>
            )}
          </button>
          {/* Reminders */}
          <button
            onClick={() => { setShowRemindersModal(true); fetchReminders(); }}
            className="relative flex items-center justify-center p-2 rounded-xl transition-colors text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            title="یادآوری‌ها"
          >
            <Bell className="w-4 h-4" />
            {reminders.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-amber-400 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                {reminders.length}
              </span>
            )}
          </button>
          {/* Search */}
          <button
            onClick={() => { setShowSearch(v => !v); if (showSearch) setSearchQuery(''); }}
            className={`p-2 rounded-xl transition-colors ${showSearch ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500'}`}
            title="جستجو در پیام‌ها"
          >
            <Search className="w-4 h-4" />
          </button>
          {/* Voice call */}
          {!isSavedMessages && (
            <button
              onClick={() => onStartCall?.('audio')}
              className="p-2 rounded-xl transition-colors hover:bg-teal-50 dark:hover:bg-teal-900/20 text-teal-600 dark:text-teal-400"
              title="تماس صوتی"
            >
              <Phone className="w-4 h-4" />
            </button>
          )}
          {/* Video call */}
          {!isSavedMessages && (
            <button
              onClick={() => onStartCall?.('video')}
              className="p-2 rounded-xl transition-colors hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-600 dark:text-blue-400"
              title="تماس تصویری"
            >
              <Video className="w-4 h-4" />
            </button>
          )}
          <button onClick={() => setShowInfoPanel(v => !v)} className={`hidden sm:flex p-2 rounded-xl text-gray-500 transition-colors items-center justify-center ${showInfoPanel ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-600' : 'hover:bg-gray-100 dark:hover:bg-gray-800'}`} title="اطلاعات">
            <Info className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Search bar */}
      {showSearch && (
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
              {messages.filter(m => m.body?.toLowerCase().includes(searchQuery.toLowerCase())).length} نتیجه
            </p>
          )}
        </div>
      )}

      {/* Mentions bar — shows unread @mentions in this conversation */}
      {mentionBarItems.filter(m => !dismissedMentionIds.has(m.id)).length > 0 && (
        <MentionsBar
          items={mentionBarItems.filter(m => !dismissedMentionIds.has(m.id))}
          onScrollTo={id => scrollToMessage(id)}
          onDismiss={id => setDismissedMentionIds(prev => {
            const next = new Set([...prev, id]);
            try { localStorage.setItem(`dismissed_mentions_conv_${conversation.id}`, JSON.stringify([...next])); } catch {}
            return next;
          })}
          onDismissAll={() => {
            const all = new Set(mentionBarItems.map(m => m.id));
            try { localStorage.setItem(`dismissed_mentions_conv_${conversation.id}`, JSON.stringify([...all])); } catch {}
            setDismissedMentionIds(all);
          }}
        />
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto py-4"
        style={(() => {
          const dotColor = document.documentElement.classList.contains('dark') ? '#4d5049' : '#e5e7eb';
          const lineColor = document.documentElement.classList.contains('dark') ? '#4d5049' : '#e5e7eb';
          if (chatTheme.backgroundStyle === 'dots')
            return { backgroundImage: `radial-gradient(circle, ${dotColor} 1px, transparent 1px)`, backgroundSize: '20px 20px' };
          if (chatTheme.backgroundStyle === 'lines')
            return { backgroundImage: `repeating-linear-gradient(0deg, transparent, transparent 19px, ${lineColor} 19px, ${lineColor} 20px)` };
          if (chatTheme.backgroundStyle === 'gradient')
            return { background: `linear-gradient(135deg, ${chatTheme.backgroundGradientFrom}, ${chatTheme.backgroundGradientTo})` };
          return {};
        })()}
      >
        {grouped.map(group => {
          const jDate = moment(group.date, 'jYYYY/jMM/jDD');
          const jy = jDate.jYear();
          const jm = jDate.jMonth() + 1;
          const jd = jDate.jDate();
          return (
          <div key={group.date}>
            <div className="flex items-center justify-center my-3">
              <button
                onClick={() => setJumpPickerDate({ jy, jm, jd })}
                className="flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-xs rounded-full shadow-sm border border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                <CalendarDays className="w-3 h-3 flex-shrink-0" />
                {formatDate(group.date)} — {group.date}
              </button>
            </div>
            {group.messages.map(msg => (
              <div key={msg.id} ref={el => { if (el) messageRefs.current.set(msg.id, el); else messageRefs.current.delete(msg.id); }} className="transition-all duration-300 rounded-xl">
                <ChatMessage
                  message={msg}
                  isOwn={msg.sender_id === currentUserId}
                  currentUserId={currentUserId}
                  allUsers={allUsers}
                  onReply={() => setReplyingTo(msg)}
                  onEdit={() => setEditingMessage(msg)}
                  onStar={() => handleStar(msg.id, msg.isStarred)}
                  onDeleteForMe={() => handleDeleteForMe(msg.id)}
                  onDeleteForAll={() => handleDeleteForAll(msg.id)}
                  onReact={emoji => handleReact(msg.id, emoji)}
                  onStatusChange={status => handleStatusChange(msg.id, status)}
                  onScheduleMeeting={handleScheduleMeeting}
                  onTagsChanged={fetchMessages}
                  onReminderSet={fetchReminders}
                  onRegisterAsTask={onNavigateToTasks}
                  onOpenDirectChat={onOpenDirectChat}
                />
              </div>
            ))}
          </div>
          );
        })}
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-3 opacity-50">
            <MessageCircle className="w-12 h-12 text-gray-300" />
            <p className="text-gray-400 text-sm">اولین پیام را ارسال کنید</p>
          </div>
        )}
      </div>

      {/* Input bar */}
      <ChatInputBar
        conversationId={conversation.id}
        currentUserId={currentUserId}
        currentUserName={currentUserProfile?.full_name || null}
        currentUserAvatarUrl={currentUserProfile?.avatar_url || null}
        otherUserId={conversation.otherUser.user_id || null}
        replyingTo={replyingTo}
        editingMessage={editingMessage}
        allUsers={allUsers}
        onSent={() => { fetchMessages(); onConversationUpdate(); scrollToBottom(); }}
        onCancelReply={() => setReplyingTo(null)}
        onCancelEdit={() => setEditingMessage(null)}
        onScheduleMeetingWithMentions={onNavigateToCalendar ? (ids) => onNavigateToCalendar(ids) : undefined}
      />

      {/* Starred Messages Modal */}
      {showStarredModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16 px-4" dir="rtl">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[75vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 text-yellow-400 fill-yellow-400" />
                <h3 className="font-bold text-gray-900 dark:text-white text-base">پیام‌های نشانه‌دار ({globalStarred.length})</h3>
              </div>
              <button onClick={() => setShowStarredModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {globalStarred.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-50">
                  <Star className="w-10 h-10 text-gray-300" />
                  <p className="text-gray-400 text-sm">هیچ پیام نشانه‌داری وجود ندارد</p>
                </div>
              ) : globalStarred.map(item => (
                <div
                  key={item.message.id}
                  onClick={() => {
                    setShowStarredModal(false);
                    if (item.conversationId === conversation.id) {
                      setTimeout(() => scrollToMessage(item.message.id), 100);
                    }
                  }}
                  className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 border-b border-gray-50 dark:border-gray-800 cursor-pointer group transition-colors"
                >
                  <Star className="w-4 h-4 text-yellow-400 fill-yellow-400 flex-shrink-0 mt-1" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="text-xs font-bold text-blue-600 dark:text-blue-400">{item.otherUserName}</span>
                      <span className="text-[10px] text-gray-400">{moment(item.message.created_at).format('HH:mm jYYYY/jMM/jDD')}</span>
                    </div>
                    <p className="text-sm text-gray-800 dark:text-white line-clamp-2 leading-relaxed">{item.message.body || '📎 فایل'}</p>
                    <div className="flex items-center gap-1 mt-1">
                      <MessageCircle className="w-3 h-3 text-gray-400" />
                      <span className="text-[10px] text-gray-400">گفتگو با {item.otherUserName}</span>
                      {item.conversationId === conversation.id && (
                        <span className="text-[10px] text-teal-500 mr-1 group-hover:underline">رفتن به پیام ↩</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Reminders Modal */}
      {showRemindersModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center pt-16 px-4" dir="rtl">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden max-h-[75vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-800">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-amber-500" />
                <h3 className="font-bold text-gray-900 dark:text-white text-base">یادآوری‌های فعال ({reminders.length})</h3>
              </div>
              <button onClick={() => setShowRemindersModal(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              {reminders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-50">
                  <Bell className="w-10 h-10 text-gray-300" />
                  <p className="text-gray-400 text-sm">یادآوری فعالی وجود ندارد</p>
                </div>
              ) : reminders.map((r: any) => {
                const msgBody = r.chat_messages?.body;
                const msgId = r.chat_messages?.id;
                const msgConvId = r.chat_messages?.conversation_id;
                return (
                  <div key={r.id} className="flex items-start gap-4 px-6 py-4 border-b border-gray-50 dark:border-gray-800">
                    <Clock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-1" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-sm font-bold text-amber-600 dark:text-amber-400">
                          {moment(r.remind_at).format('HH:mm — jYYYY/jMM/jDD')}
                        </span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${moment(r.remind_at).isBefore(moment()) ? 'bg-red-100 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
                          {moment(r.remind_at).isBefore(moment()) ? 'گذشته' : 'پیش رو'}
                        </span>
                      </div>
                      {msgBody && (
                        <div
                          onClick={() => { if (msgConvId === conversation.id && msgId) { setShowRemindersModal(false); setTimeout(() => scrollToMessage(msgId), 100); } }}
                          className={`text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-3 py-2 rounded-lg mb-1 line-clamp-2 ${msgConvId === conversation.id ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700' : ''}`}
                        >
                          {msgBody}
                          {msgConvId === conversation.id && <span className="text-[10px] text-teal-500 mr-1">↩ رفتن</span>}
                        </div>
                      )}
                      {r.note && <p className="text-sm text-gray-800 dark:text-white">{r.note}</p>}
                    </div>
                    <button onClick={() => dismissReminder(r.id)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500 flex-shrink-0 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* User Info Panel */}
      {showInfoPanel && (
        <div className="fixed inset-0 z-[200] flex justify-end" dir="rtl">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-[1px]" onClick={() => setShowInfoPanel(false)} />
          <div className="relative w-80 bg-white dark:bg-gray-900 h-full shadow-2xl border-r border-gray-100 dark:border-gray-800 flex flex-col overflow-y-auto animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">اطلاعات گفتگو</h3>
              <button onClick={() => setShowInfoPanel(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex flex-col items-center py-6 px-5 border-b border-gray-100 dark:border-gray-800">
              {isSavedMessages ? (
                <div className="w-20 h-20 rounded-full bg-teal-500 flex items-center justify-center mb-3">
                  <Bookmark className="w-9 h-9 text-white" />
                </div>
              ) : (
                <div className="w-20 h-20 rounded-full overflow-hidden flex-shrink-0">
                  {conversation.otherUser.avatar_url ? (
                    <img src={conversation.otherUser.avatar_url} alt={otherName} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full bg-teal-500 flex items-center justify-center text-white text-3xl font-bold">
                      {otherName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
              )}
              <h4 className="mt-3 font-bold text-gray-900 dark:text-white text-base">{otherName}</h4>
              {!isSavedMessages && (
                <p className={`text-xs mt-1 ${isUserOnline(otherUserPresence?.last_seen) ? 'text-green-500' : 'text-gray-400'}`}>
                  {getLastSeenText(otherUserPresence?.last_seen)}
                </p>
              )}
              {!isSavedMessages && conversation.otherUser.email && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{conversation.otherUser.email}</p>
              )}
            </div>
            <div className="px-5 py-4 space-y-1">
              {!isSavedMessages && (
                <div className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800">
                  <span className="text-xs text-gray-500 dark:text-gray-400">وضعیت</span>
                  <div className="flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full ${isUserOnline(otherUserPresence?.last_seen) ? 'bg-green-500' : 'bg-gray-400'}`} />
                    <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
                      {isUserOnline(otherUserPresence?.last_seen) ? 'آنلاین' : 'آفلاین'}
                    </span>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800">
                <span className="text-xs text-gray-500 dark:text-gray-400">پیام‌های نشانه‌دار</span>
                <span className="text-xs font-semibold text-yellow-500">{localStarredCount}</span>
              </div>
              <div className="flex items-center justify-between py-2.5 border-b border-gray-50 dark:border-gray-800">
                <span className="text-xs text-gray-500 dark:text-gray-400">یادآوری‌های فعال</span>
                <span className="text-xs font-semibold text-amber-500">{reminders.length}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Jump-to-date picker */}
      {jumpPickerDate && (
        <JumpToDatePicker
          initial={jumpPickerDate}
          onConfirm={(jy, jm, jd) => jumpToDate(jy, jm, jd)}
          onClose={() => setJumpPickerDate(null)}
        />
      )}
    </div>
  );
}

// ─── Mentions Bar ─────────────────────────────────────────────────────────────
function MentionsBar({
  items,
  onScrollTo,
  onDismiss,
  onDismissAll,
}: {
  items: { id: string; body: string | null; senderName: string }[];
  onScrollTo: (id: string) => void;
  onDismiss: (id: string) => void;
  onDismissAll: () => void;
}) {
  const current = items[0];
  return (
    <div
      className="flex-shrink-0 flex items-center gap-2 px-3 py-2 bg-teal-50 dark:bg-teal-900/20 border-b border-teal-200 dark:border-teal-800"
      dir="rtl"
    >
      <div className="w-6 h-6 rounded-full bg-teal-500 flex items-center justify-center flex-shrink-0">
        <AtSign className="w-3.5 h-3.5 text-white" />
      </div>
      <button
        onClick={() => { onScrollTo(current.id); onDismiss(current.id); }}
        className="flex-1 min-w-0 text-right"
      >
        <span className="text-xs font-semibold text-teal-700 dark:text-teal-300 truncate block">
          {current.senderName} شما را منشن کرد
        </span>
        {current.body && (
          <span className="text-[11px] text-teal-600/80 dark:text-teal-400/80 truncate block leading-tight">
            {current.body.slice(0, 80)}
          </span>
        )}
      </button>
      {items.length > 1 && (
        <span className="text-[10px] text-teal-600 dark:text-teal-400 font-semibold bg-teal-100 dark:bg-teal-900/40 px-1.5 py-0.5 rounded-full flex-shrink-0">
          {items.length}
        </span>
      )}
      <button
        onClick={() => { onScrollTo(current.id); onDismiss(current.id); }}
        className="text-[11px] text-teal-700 dark:text-teal-300 font-semibold hover:underline flex-shrink-0"
      >
        رفتن
      </button>
      <button
        onClick={() => onDismiss(current.id)}
        title="بستن این منشن"
        className="p-1 text-teal-500 hover:text-teal-700 flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
      {items.length > 1 && (
        <button
          onClick={onDismissAll}
          title="بستن همه"
          className="text-[10px] text-teal-500 hover:text-teal-700 flex-shrink-0"
        >
          همه
        </button>
      )}
    </div>
  );
}
// ─── Jump-to-date picker ──────────────────────────────────────────────────────
function JumpToDatePicker({
  initial,
  onConfirm,
  onClose,
}: {
  initial: { jy: number; jm: number; jd: number };
  onConfirm: (jy: number, jm: number, jd: number) => void;
  onClose: () => void;
}) {
  const [jy, setJy] = useState(initial.jy);
  const [jm, setJm] = useState(initial.jm);
  const [jd, setJd] = useState(initial.jd);

  const MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
  const daysInMonth = jm <= 6 ? 31 : jm <= 11 ? 30 : (moment.jIsLeapYear(jy) ? 30 : 29);
  const years = Array.from({ length: 10 }, (_, i) => initial.jy - 5 + i);

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      dir="rtl"
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-5 w-72"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-bold text-gray-900 dark:text-white text-sm flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-blue-500" />
            رفتن به تاریخ
          </h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex gap-2 mb-4">
          <select
            value={jy}
            onChange={e => setJy(Number(e.target.value))}
            className="flex-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select
            value={jm}
            onChange={e => setJm(Number(e.target.value))}
            className="flex-1 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {MONTHS.map((name, i) => <option key={i+1} value={i+1}>{name}</option>)}
          </select>
          <select
            value={jd}
            onChange={e => setJd(Number(e.target.value))}
            className="w-16 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-400"
          >
            {Array.from({ length: daysInMonth }, (_, i) => i+1).map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <button
          onClick={() => onConfirm(jy, jm, jd)}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold text-sm py-2 rounded-xl transition-colors"
        >
          رفتن به این تاریخ
        </button>
      </div>
    </div>
  );
}
