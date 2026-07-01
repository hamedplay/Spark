import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, SlidersHorizontal, X, Check, ChevronDown, Star, GitFork } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import moment from 'moment-jalaali';
import type { ChannelProfile, GroupTask } from './types';

interface ChannelSearchResult {
  id: string;
  body: string | null;
  created_at: string;
  message_type: string;
  is_pinned: boolean;
  is_starred: boolean;
  read_by: string[];
  channel_id: string;
  sender_id: string | null;
  senderProfile: ChannelProfile | null;
  channelName: string;
}

interface Props {
  currentUserId: string;
  channelId?: string;
  channelName?: string;
  allProfiles: ChannelProfile[];
  groupTasks: GroupTask[];
  onClose: () => void;
  onNavigateToMessage?: (messageId: string) => void;
}

type TypeFilter = 'mention' | 'important' | 'urgent' | 'unread' | 'starred' | 'pinned' | 'group_task' | 'group_task_in_progress' | 'group_task_done';
type DateFilter = 'all' | 'today' | 'week' | '2weeks' | 'month' | 'custom';

const TYPE_OPTIONS: { key: TypeFilter; label: string }[] = [
  { key: 'mention', label: 'منشن‌ها' },
  { key: 'important', label: 'پیام مهم' },
  { key: 'urgent', label: 'پیام اورژانسی' },
  { key: 'unread', label: 'خوانده نشده' },
  { key: 'starred', label: 'نشان‌دار' },
  { key: 'pinned', label: 'پین شده' },
  { key: 'group_task', label: 'اقدامات گروهی' },
  { key: 'group_task_in_progress', label: 'در حال رسیدگی' },
  { key: 'group_task_done', label: 'رسیدگی شده' },
];

const DATE_OPTIONS: { key: DateFilter; label: string }[] = [
  { key: 'all', label: 'همه' },
  { key: 'today', label: 'امروز' },
  { key: 'week', label: 'یک هفته' },
  { key: '2weeks', label: 'دو هفته' },
  { key: 'month', label: 'یک ماه' },
  { key: 'custom', label: 'تاریخ دلخواه' },
];

export function ChannelActionsPanel({ currentUserId, channelId, channelName, allProfiles, groupTasks: _groupTasksProp, onClose, onNavigateToMessage }: Props) {
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<'type' | 'date' | null>(null);
  const [typeFilters, setTypeFilters] = useState<Set<TypeFilter>>(new Set());
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [customDate, setCustomDate] = useState('');
  const [results, setResults] = useState<ChannelSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [showGroupTasks, setShowGroupTasks] = useState(false);
  const [localGroupTasks, setLocalGroupTasks] = useState<GroupTask[]>([]);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const profileMap = new Map(allProfiles.map(p => [p.user_id, p]));
  const myProfile = profileMap.get(currentUserId);

  const fetchGroupTasksInternal = useCallback(async () => {
    if (!channelId) return;
    setLoadingTasks(true);
    try {
      const { data: tasks } = await supabase.from('channel_group_tasks').select('*')
        .eq('channel_id', channelId).order('created_at', { ascending: false });
      if (!tasks || tasks.length === 0) { setLocalGroupTasks([]); return; }
      const taskIds = tasks.map((t: any) => t.id);
      const { data: assignments } = await supabase.from('channel_group_task_assignments').select('*').in('group_task_id', taskIds);
      const assignMap = new Map<string, any[]>();
      for (const a of (assignments || [])) {
        if (!assignMap.has(a.group_task_id)) assignMap.set(a.group_task_id, []);
        assignMap.get(a.group_task_id)!.push({ ...a, assigneeProfile: profileMap.get(a.assignee_id) || null });
      }
      setLocalGroupTasks(tasks.map((t: any) => ({ ...t, assignments: assignMap.get(t.id) || [] })));
    } finally { setLoadingTasks(false); }
  }, [channelId, allProfiles]);

  useEffect(() => {
    if (showGroupTasks) fetchGroupTasksInternal();
  }, [showGroupTasks]);

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
  }, [query, typeFilters, dateFilter, customDate]);

  const performSearch = async () => {
    if (typeFilters.has('group_task') || typeFilters.has('group_task_in_progress') || typeFilters.has('group_task_done')) { setShowGroupTasks(true); setResults([]); return; }
    setShowGroupTasks(false);
    setLoading(true);
    try {
      let fromDate: string | null = null;
      if (dateFilter === 'today') fromDate = moment().startOf('day').toISOString();
      else if (dateFilter === 'week') fromDate = moment().subtract(7, 'days').toISOString();
      else if (dateFilter === '2weeks') fromDate = moment().subtract(14, 'days').toISOString();
      else if (dateFilter === 'month') fromDate = moment().subtract(30, 'days').toISOString();
      else if (dateFilter === 'custom' && customDate) fromDate = moment(customDate, 'YYYY-MM-DD').toISOString();

      let q = supabase.from('channel_messages').select('*')
        .eq('deleted_for_all', false)
        .order('created_at', { ascending: false })
        .limit(60);

      if (channelId) q = q.eq('channel_id', channelId);
      if (query.trim()) q = q.ilike('body', `%${query.trim()}%`);
      if (fromDate) q = q.gte('created_at', fromDate);

      const msgTypeFilters: string[] = [];
      if (typeFilters.has('important')) msgTypeFilters.push('important');
      if (typeFilters.has('urgent')) msgTypeFilters.push('urgent');
      if (msgTypeFilters.length === 1) q = q.eq('message_type', msgTypeFilters[0]);
      else if (msgTypeFilters.length > 1) q = q.in('message_type', msgTypeFilters);
      if (typeFilters.has('pinned')) q = q.eq('is_pinned', true);

      const { data: msgs } = await q;
      if (!msgs) { setResults([]); return; }

      let filtered = msgs;
      if (typeFilters.has('unread')) {
        filtered = filtered.filter(m => m.sender_id !== currentUserId && !(m.read_by || []).includes(currentUserId));
      }
      if (typeFilters.has('mention')) {
        const myName = myProfile?.full_name || myProfile?.email;
        if (myName) filtered = filtered.filter(m => m.body && m.body.includes(`@${myName}`));
      }

      const msgIds = filtered.map(m => m.id);
      let starredIds = new Set<string>();
      if (msgIds.length > 0) {
        const { data: stars } = await supabase.from('channel_message_stars').select('message_id')
          .eq('user_id', currentUserId).in('message_id', msgIds);
        starredIds = new Set((stars || []).map((s: any) => s.message_id));
      }
      if (typeFilters.has('starred')) {
        filtered = filtered.filter(m => starredIds.has(m.id));
      }

      const channelIds = [...new Set(filtered.map(m => m.channel_id))];
      const channelNameMap = new Map<string, string>();
      if (!channelId && channelIds.length > 0) {
        const { data: channels } = await supabase.from('channels').select('id, name').in('id', channelIds);
        for (const c of (channels || [])) channelNameMap.set(c.id, c.name);
      } else if (channelId && channelName) {
        channelNameMap.set(channelId, channelName);
      }

      setResults(filtered.map(m => ({
        ...m,
        senderProfile: m.sender_id ? (profileMap.get(m.sender_id) || null) : null,
        channelName: channelNameMap.get(m.channel_id) || 'کانال',
        is_starred: starredIds.has(m.id),
      })));
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

  const hasActiveFilters = typeFilters.size > 0 || dateFilter !== 'all';

  return (
    <div className="flex flex-col h-full w-full bg-white dark:bg-gray-800" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
        <h2 className="font-bold text-gray-900 dark:text-white text-sm">اقدامات جاری</h2>
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
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
            placeholder="جستجو در پیام‌ها..."
            className="w-full pr-9 pl-9 py-2.5 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl outline-hidden focus:border-teal-400 dark:text-white placeholder-gray-400 transition-colors"
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

        {/* Filter row — org chat style */}
        {showFilters && (
          <div className="mt-2 flex gap-2" ref={dropdownRef}>
            {/* Type filter */}
            <div className="relative flex-1">
              <button
                onClick={() => setActiveDropdown(v => v === 'type' ? null : 'type')}
                className={`w-full flex items-center justify-between gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${typeFilters.size > 0 ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-300 text-teal-700 dark:text-teal-400' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
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

            {/* Date filter */}
            <div className="relative flex-1">
              <button
                onClick={() => setActiveDropdown(v => v === 'date' ? null : 'date')}
                className={`w-full flex items-center justify-between gap-1 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${dateFilter !== 'all' ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-300 text-teal-700 dark:text-teal-400' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400'}`}
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
          <button onClick={() => { setTypeFilters(new Set()); setDateFilter('all'); setCustomDate(''); }}
            className="text-[11px] text-gray-400 hover:text-red-500 transition-colors mr-1">
            پاک کردن همه
          </button>
        </div>
      )}

      {/* Results */}
      <div className="flex-1 overflow-y-auto">
        {showGroupTasks ? (
          <div className="p-3 space-y-3">
            {loadingTasks ? (
              <div className="flex items-center justify-center py-10">
                <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : (() => {
              let filtered = localGroupTasks;
              if (typeFilters.has('group_task_in_progress')) filtered = filtered.filter(t => t.status === 'open');
              else if (typeFilters.has('group_task_done')) filtered = filtered.filter(t => t.status === 'done' || t.status === 'archived');
              return (
                <>
                  <p className="text-[11px] text-gray-400 px-1">{filtered.length} اقدام گروهی</p>
                  {filtered.length === 0 ? (
                    <div className="flex flex-col items-center py-10 gap-2 opacity-40">
                      <GitFork className="w-8 h-8 text-gray-300" />
                      <p className="text-sm text-gray-400">اقدام گروهی وجود ندارد</p>
                    </div>
                  ) : filtered.map(task => {
                    const assignments = task.assignments || [];
                    const doneCount = assignments.filter(a => a.status === 'done' || a.status === 'archived').length;
                    const statusCls = task.status === 'done' ? 'text-green-600 bg-green-50' : task.status === 'archived' ? 'text-gray-500 bg-gray-100' : 'text-blue-600 bg-blue-50 dark:bg-blue-900/20';
                    const statusLabel = task.status === 'done' ? 'رسیدگی شده' : task.status === 'archived' ? 'بایگانی' : 'در حال رسیدگی';
                    return (
                      <div key={task.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-3">
                        <div className="flex items-start justify-between gap-2 mb-2">
                          <p className="text-sm font-semibold text-gray-800 dark:text-white flex-1">{task.title}</p>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${statusCls}`}>
                            {statusLabel}
                          </span>
                        </div>
                        {assignments.length > 0 && (
                          <>
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                                <div className="h-full bg-teal-500 rounded-full transition-all" style={{ width: `${(doneCount / assignments.length) * 100}%` }} />
                              </div>
                              <span className="text-[10px] text-gray-500">{doneCount}/{assignments.length}</span>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              {assignments.map(a => {
                                const p = allProfiles.find(pr => pr.user_id === a.assignee_id);
                                return (
                                  <span key={a.id} className={`text-[10px] px-1.5 py-0.5 rounded border ${a.status === 'done' ? 'text-green-600 border-green-200 bg-green-50' : 'text-gray-500 border-gray-200 bg-gray-50 dark:bg-gray-700'}`}>
                                    {p?.full_name || p?.email || 'کاربر'}
                                  </span>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 opacity-40">
            <Search className="w-10 h-10 text-gray-300" />
            <p className="text-sm text-gray-400">{query || hasActiveFilters ? 'نتیجه‌ای یافت نشد' : 'عبارتی جستجو کنید یا فیلتر انتخاب کنید'}</p>
          </div>
        ) : (
          <div>
            <p className="text-[11px] text-gray-400 px-4 py-1.5">{results.length} پیام یافت شد</p>
            {results.map(r => (
              <div key={r.id}
                onClick={() => { onNavigateToMessage?.(r.id); onClose(); }}
                className="flex items-start gap-3 px-4 py-3 hover:bg-teal-50 dark:hover:bg-teal-900/10 border-b border-gray-50 dark:border-gray-700 cursor-pointer transition-colors">
                <div className="w-8 h-8 rounded-full bg-teal-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {(r.senderProfile?.full_name || r.senderProfile?.email || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span className="text-xs font-semibold text-gray-800 dark:text-white truncate">
                      {r.senderProfile?.full_name || r.senderProfile?.email || 'کاربر'}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0">{moment(r.created_at).format('HH:mm')}</span>
                  </div>
                  <p className="text-sm text-gray-700 dark:text-gray-300 line-clamp-2 leading-relaxed">{r.body || '📎 فایل'}</p>
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    {r.message_type === 'important' && <span className="text-[10px] text-amber-600 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">مهم</span>}
                    {r.message_type === 'urgent' && <span className="text-[10px] text-red-600 bg-red-50 dark:bg-red-900/20 px-1.5 py-0.5 rounded">اورژانسی</span>}
                    {r.is_starred && <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />}
                    {r.is_pinned && <span className="text-[10px]">📌</span>}
                    {!(r.read_by || []).includes(currentUserId) && r.sender_id !== currentUserId && <span className="w-2 h-2 rounded-full bg-teal-500 shrink-0" />}
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
