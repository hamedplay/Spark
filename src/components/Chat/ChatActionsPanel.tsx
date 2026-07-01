import { useState, useEffect, useRef } from 'react';
import { Search, SlidersHorizontal, X, Check, ChevronDown, Clock, Star } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { UserAvatar } from './ChatConversationItem';
import moment from 'moment-jalaali';
import type { UserProfile, ChatTag } from './types';

interface SearchResult {
  id: string;
  body: string | null;
  created_at: string;
  message_type: string;
  status: string;
  is_starred: boolean;
  read_by: string[];
  conversation_id: string;
  sender_id: string;
  senderProfile: UserProfile | null;
  otherUserName: string;
  tags: ChatTag[];
}

interface Props {
  currentUserId: string;
  onClose: () => void;
  onNavigateToMessage?: (conversationId: string, messageId: string) => void;
}

type TypeFilter = 'mention' | 'important' | 'urgent' | 'unread' | 'starred' | 'pending' | 'done';
type DateFilter = 'all' | 'today' | 'week' | '2weeks' | 'month' | 'custom';

export function ChatActionsPanel({ currentUserId, onClose, onNavigateToMessage }: Props) {
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<'type' | 'date' | 'tag' | null>(null);

  // Filters
  const [typeFilters, setTypeFilters] = useState<Set<TypeFilter>>(new Set());
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDate, setCustomDate] = useState('');
  const [tagFilters, setTagFilters] = useState<Set<string>>(new Set());

  const [results, setResults] = useState<SearchResult[]>([]);
  const [userTags, setUserTags] = useState<ChatTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    supabase.from('chat_tags').select('*').eq('user_id', currentUserId).then(({ data }) => setUserTags(data || []));
    supabase.from('profiles').select('user_id, full_name, email').not('is_hidden', 'eq', true).then(({ data }) => setAllUsers(data || []));
  }, [currentUserId]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setActiveDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => performSearch(), 350);
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  }, [query, typeFilters, dateFilter, customDate, tagFilters, allUsers, currentUserId]);

  const performSearch = async () => {
    setLoading(true);
    try {
      // Build date filter
      let fromDate: string | null = null;
      if (dateFilter === 'today') fromDate = moment().startOf('day').toISOString();
      else if (dateFilter === 'week') fromDate = moment().subtract(7, 'days').toISOString();
      else if (dateFilter === '2weeks') fromDate = moment().subtract(14, 'days').toISOString();
      else if (dateFilter === 'month') fromDate = moment().subtract(30, 'days').toISOString();
      else if (dateFilter === 'custom' && customDate) fromDate = moment(customDate, 'YYYY-MM-DD').toISOString();

      // Fetch conversations for this user
      const { data: convs } = await supabase
        .from('chat_conversations')
        .select('id, participant_a, participant_b')
        .or(`participant_a.eq.${currentUserId},participant_b.eq.${currentUserId}`);

      if (!convs || convs.length === 0) { setResults([]); setLoading(false); return; }
      const convIds = convs.map(c => c.id);

      // Build query
      let q = supabase
        .from('chat_messages')
        .select('*')
        .in('conversation_id', convIds)
        .eq('deleted_for_all', false)
        .order('created_at', { ascending: false })
        .limit(50);

      if (query.trim()) q = q.ilike('body', `%${query.trim()}%`);
      if (fromDate) q = q.gte('created_at', fromDate);

      // Type-based filters (message_type filters combined with OR if both selected)
      const msgTypeFilters: string[] = [];
      if (typeFilters.has('important')) msgTypeFilters.push('important');
      if (typeFilters.has('urgent')) msgTypeFilters.push('urgent');
      if (msgTypeFilters.length === 1) q = q.eq('message_type', msgTypeFilters[0]);
      else if (msgTypeFilters.length > 1) q = q.in('message_type', msgTypeFilters);
      if (typeFilters.has('pending') && !typeFilters.has('done')) q = q.eq('status', 'pending');
      if (typeFilters.has('done') && !typeFilters.has('pending')) q = q.eq('status', 'done');

      const { data: msgs } = await q;
      if (!msgs) { setResults([]); setLoading(false); return; }

      // Post-filter (things we can't do in SQL easily)
      let filtered = msgs;
      if (typeFilters.has('unread')) {
        filtered = filtered.filter(m => m.sender_id !== currentUserId && !(m.read_by || []).includes(currentUserId));
      }
      if (typeFilters.has('mention')) {
        const myProfile = allUsers.find(u => u.user_id === currentUserId);
        const myName = myProfile?.full_name || myProfile?.email;
        if (myName) filtered = filtered.filter(m => m.body && m.body.includes(`@${myName}`));
      }

      // Fetch stars
      const msgIds = filtered.map(m => m.id);
      let starredIds = new Set<string>();
      if (msgIds.length > 0) {
        const { data: stars } = await supabase.from('chat_message_stars').select('message_id').eq('user_id', currentUserId).in('message_id', msgIds);
        starredIds = new Set((stars || []).map((s: any) => s.message_id));
      }

      if (typeFilters.has('starred')) {
        filtered = filtered.filter(m => starredIds.has(m.id));
      }

      // Fetch tags if tag filter active
      let tagMsgIds = new Set<string>();
      if (tagFilters.size > 0 && msgIds.length > 0) {
        const { data: tagAssigns } = await supabase
          .from('chat_message_tag_assignments')
          .select('message_id, tag_id')
          .eq('user_id', currentUserId)
          .in('message_id', msgIds)
          .in('tag_id', [...tagFilters]);
        tagMsgIds = new Set((tagAssigns || []).map((a: any) => a.message_id));
        filtered = filtered.filter(m => tagMsgIds.has(m.id));
      }

      // Fetch tags for each message
      let tagsMap = new Map<string, ChatTag[]>();
      if (msgIds.length > 0) {
        const { data: tagAssigns } = await supabase
          .from('chat_message_tag_assignments')
          .select('message_id, chat_tags(id, name, color, user_id)')
          .eq('user_id', currentUserId)
          .in('message_id', msgIds);
        for (const a of (tagAssigns || [])) {
          const existing = tagsMap.get(a.message_id) || [];
          if ((a as any).chat_tags) existing.push((a as any).chat_tags);
          tagsMap.set(a.message_id, existing);
        }
      }

      // Enrich with profile + conversation info
      const profileMap = new Map(allUsers.map(u => [u.user_id, u]));
      const convMap = new Map(convs.map(c => [c.id, c]));

      const enriched: SearchResult[] = filtered.map(m => {
        const conv = convMap.get(m.conversation_id);
        const otherId = conv ? (conv.participant_a === currentUserId ? conv.participant_b : conv.participant_a) : null;
        const otherProfile = otherId ? profileMap.get(otherId) : null;
        return {
          ...m,
          senderProfile: profileMap.get(m.sender_id) || null,
          otherUserName: otherProfile?.full_name || otherProfile?.email || 'کاربر',
          is_starred: starredIds.has(m.id),
          tags: tagsMap.get(m.id) || [],
        };
      });

      setResults(enriched);
    } finally {
      setLoading(false);
    }
  };

  const toggleTypeFilter = (f: TypeFilter) => {
    setTypeFilters(prev => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f); else next.add(f);
      return next;
    });
  };

  const toggleTagFilter = (tagId: string) => {
    setTagFilters(prev => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId); else next.add(tagId);
      return next;
    });
  };

  const hasActiveFilters = typeFilters.size > 0 || dateFilter !== 'all' || tagFilters.size > 0;

  const TYPE_OPTIONS: { key: TypeFilter; label: string }[] = [
    { key: 'mention', label: 'منشن' },
    { key: 'important', label: 'پیام مهم' },
    { key: 'urgent', label: 'پیام اورژانسی' },
    { key: 'unread', label: 'خوانده نشده' },
    { key: 'starred', label: 'نشان دار' },
    { key: 'pending', label: 'منتظر' },
    { key: 'done', label: 'رسیدگی شده' },
  ];

  const DATE_OPTIONS: { key: DateFilter; label: string }[] = [
    { key: 'all', label: 'همه' },
    { key: 'today', label: 'امروز' },
    { key: 'week', label: 'یک هفته' },
    { key: '2weeks', label: 'دو هفته' },
    { key: 'month', label: 'یک ماه' },
    { key: 'custom', label: 'تاریخ دلخواه' },
  ];

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-700" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
        <h2 className="font-bold text-gray-900 dark:text-white text-sm">اقدامات جاری</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Search bar */}
      <div className="px-3 pt-3 pb-2">
        <div className="relative flex items-center">
          <Search className="absolute right-3 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="جستجو در همه پیام‌ها..."
            className="w-full pr-9 pl-9 py-2.5 text-sm bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl outline-hidden focus:border-teal-400 dark:text-white placeholder-gray-400 transition-colors"
          />
          <button
            onClick={() => setShowFilters(v => !v)}
            className={`absolute left-2.5 w-6 h-6 flex items-center justify-center rounded-lg transition-colors ${showFilters || hasActiveFilters ? 'text-teal-500' : 'text-gray-400 hover:text-gray-600'}`}
            title="فیلترها"
          >
            <SlidersHorizontal className="w-4 h-4" />
            {hasActiveFilters && <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-teal-500 rounded-full" />}
          </button>
        </div>

        {/* Filter row */}
        {showFilters && (
          <div className="mt-2 flex gap-2" ref={dropdownRef}>
            {/* Type */}
            <div className="relative flex-1">
              <button
                onClick={() => setActiveDropdown(v => v === 'type' ? null : 'type')}
                className={`w-full flex items-center justify-between gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${typeFilters.size > 0 ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-300 text-teal-700 dark:text-teal-400' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}
              >
                <span>نوع {typeFilters.size > 0 ? `(${typeFilters.size})` : ''}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'type' ? 'rotate-180' : ''}`} />
              </button>
              {activeDropdown === 'type' && (
                <div className="absolute top-full mt-1 right-0 w-44 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 py-1 z-50">
                  {TYPE_OPTIONS.map(opt => (
                    <button key={opt.key} onClick={() => toggleTypeFilter(opt.key)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-gray-700 dark:text-gray-300">
                      <span>{opt.label}</span>
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${typeFilters.has(opt.key) ? 'bg-teal-500 border-teal-500' : 'border-gray-300 dark:border-gray-600'}`}>
                        {typeFilters.has(opt.key) && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Date */}
            <div className="relative flex-1">
              <button
                onClick={() => setActiveDropdown(v => v === 'date' ? null : 'date')}
                className={`w-full flex items-center justify-between gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${dateFilter !== 'all' ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-300 text-teal-700 dark:text-teal-400' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}
              >
                <span>{DATE_OPTIONS.find(d => d.key === dateFilter)?.label || 'تاریخ'}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'date' ? 'rotate-180' : ''}`} />
              </button>
              {activeDropdown === 'date' && (
                <div className="absolute top-full mt-1 right-0 w-44 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 py-1 z-50">
                  {DATE_OPTIONS.map(opt => (
                    <div key={opt.key}>
                      <button onClick={() => { setDateFilter(opt.key); if (opt.key !== 'custom') setActiveDropdown(null); }}
                        className={`w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${dateFilter === opt.key ? 'text-teal-600 dark:text-teal-400 font-semibold' : 'text-gray-700 dark:text-gray-300'}`}>
                        <span>{opt.label}</span>
                        {dateFilter === opt.key && <Check className="w-3.5 h-3.5 text-teal-500" />}
                      </button>
                      {opt.key === 'custom' && dateFilter === 'custom' && (
                        <div className="px-3 pb-2">
                          <input type="date" value={customDate} onChange={e => setCustomDate(e.target.value)}
                            className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 dark:text-white outline-hidden focus:border-teal-400" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Tag */}
            <div className="relative flex-1">
              <button
                onClick={() => setActiveDropdown(v => v === 'tag' ? null : 'tag')}
                className={`w-full flex items-center justify-between gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${tagFilters.size > 0 ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-300 text-teal-700 dark:text-teal-400' : 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400'}`}
              >
                <span>برچسب {tagFilters.size > 0 ? `(${tagFilters.size})` : ''}</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${activeDropdown === 'tag' ? 'rotate-180' : ''}`} />
              </button>
              {activeDropdown === 'tag' && (
                <div className="absolute top-full mt-1 right-0 w-44 bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-100 dark:border-gray-700 py-1 z-50">
                  {userTags.length === 0 ? (
                    <p className="text-xs text-gray-400 px-3 py-2">تگی ایجاد نشده</p>
                  ) : userTags.map(tag => (
                    <button key={tag.id} onClick={() => toggleTagFilter(tag.id)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                        <span className="text-gray-700 dark:text-gray-300">{tag.name}</span>
                      </div>
                      <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${tagFilters.has(tag.id) ? 'bg-teal-500 border-teal-500' : 'border-gray-300 dark:border-gray-600'}`}>
                        {tagFilters.has(tag.id) && <Check className="w-2.5 h-2.5 text-white" />}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Active filters summary */}
      {hasActiveFilters && (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          {[...typeFilters].map(f => (
            <span key={f} onClick={() => toggleTypeFilter(f)}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 rounded-full text-[11px] font-medium cursor-pointer hover:bg-teal-100 transition-colors border border-teal-200 dark:border-teal-700">
              {TYPE_OPTIONS.find(t => t.key === f)?.label}
              <X className="w-2.5 h-2.5" />
            </span>
          ))}
          {dateFilter !== 'all' && (
            <span onClick={() => { setDateFilter('all'); setCustomDate(''); }}
              className="inline-flex items-center gap-1 px-2 py-0.5 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 rounded-full text-[11px] font-medium cursor-pointer hover:bg-teal-100 transition-colors border border-teal-200 dark:border-teal-700">
              {DATE_OPTIONS.find(d => d.key === dateFilter)?.label}
              <X className="w-2.5 h-2.5" />
            </span>
          )}
          {[...tagFilters].map(tid => {
            const tag = userTags.find(t => t.id === tid);
            return tag ? (
              <span key={tid} onClick={() => toggleTagFilter(tid)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-white cursor-pointer hover:opacity-80 transition-opacity"
                style={{ backgroundColor: tag.color }}>
                {tag.name}<X className="w-2.5 h-2.5" />
              </span>
            ) : null;
          })}
          <button onClick={() => { setTypeFilters(new Set()); setDateFilter('all'); setCustomDate(''); setTagFilters(new Set()); }}
            className="text-[11px] text-gray-400 hover:text-red-500 transition-colors mr-1">
            پاک کردن همه
          </button>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
            <Search className="w-10 h-10 text-gray-300" />
            <p className="text-sm text-gray-400">{query || hasActiveFilters ? 'نتیجه‌ای یافت نشد' : 'عبارتی جستجو کنید'}</p>
          </div>
        ) : (
          <div>
            <p className="text-[11px] text-gray-400 px-4 py-1.5">{results.length} پیام یافت شد</p>
            {results.map(r => (
              <div key={r.id}
                onClick={() => { onNavigateToMessage?.(r.conversation_id, r.id); }}
                className="flex items-start gap-3 px-4 py-3 hover:bg-teal-50 dark:hover:bg-teal-900/10 border-b border-gray-50 dark:border-gray-800 cursor-pointer group transition-colors active:bg-teal-100">
                <UserAvatar name={r.senderProfile?.full_name || 'U'} size="sm" />
                <div className="flex-1 min-w-0">
                  {/* Top: sender → other user, time */}
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <div className="flex items-center gap-1 text-xs min-w-0">
                      <span className="font-semibold text-gray-800 dark:text-white truncate">
                        {r.senderProfile?.full_name || r.senderProfile?.email || 'کاربر'}
                      </span>
                      <span className="text-gray-400">›</span>
                      <span className="text-gray-500 truncate">{r.otherUserName}</span>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">{moment(r.created_at).format('HH:mm')}</span>
                  </div>
                  {/* Body */}
                  <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 leading-relaxed">{r.body || '📎 فایل'}</p>
                  {/* Badges */}
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {r.message_type === 'important' && <span className="text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">مهم</span>}
                    {r.message_type === 'urgent' && <span className="text-[10px] text-red-600 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded">اورژانسی</span>}
                    {r.is_starred && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
                    {r.status === 'done' && <Check className="w-3 h-3 text-teal-500" />}
                    {r.status === 'pending' && r.sender_id !== currentUserId && <Clock className="w-3 h-3 text-gray-400" />}
                    {r.tags.map(tag => (
                      <span key={tag.id} className="text-[10px] text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: tag.color }}>{tag.name}</span>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
