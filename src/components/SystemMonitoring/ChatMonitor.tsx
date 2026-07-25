import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, ListFilter as Filter, Search, EllipsisVertical as MoreVertical, Trash2, GitBranch, X, Loader as Loader2, RefreshCw, Lock, Eye, Hash as ChannelIcon } from 'lucide-react';
import { type ChatConversation, type ChatMessage, type ChannelRow, type ChannelMsgRow, type Profile } from './types';
import { toJalaliTime, toJalali, jalaliToGregorian, SEL, SUPERADMIN_CODE } from './utils';
import { Badge2, DataField, maskConfidential } from './DisplayComponents';
import { JalaliInput } from './JalaliInput';
import { ChatFlowModal } from './ChatFlowModal';
import { ConfirmDeleteModal } from './ConfirmDeleteModal';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

function ChatMonitor({ profiles }: { profiles: Profile[] }) {
  const [convs, setConvs] = useState<ChatConversation[]>([]);
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'channels'>('chat');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [filterUser, setFilterUser] = useState('all');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [filterHasMessages, setFilterHasMessages] = useState('all');
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [flowConv, setFlowConv] = useState<ChatConversation | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [superAdminCode, setSuperAdminCode] = useState('');
  const [superAdminVerified, setSuperAdminVerified] = useState(false);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadConvs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('chat_conversations').select('*').order('created_at', { ascending: false });
    if (error) { toast.error('خطا در بارگذاری چت'); setLoading(false); return; }

    const rows = await Promise.all((data || []).map(async (c: any) => {
      const { count } = await supabase.from('chat_messages').select('id', { count: 'exact', head: true }).eq('conversation_id', c.id);
      const { data: msgs } = await supabase
        .from('chat_messages')
        .select('id, conversation_id, sender_id, body, message_type, created_at')
        .eq('conversation_id', c.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const lastMsgAt = msgs && msgs.length > 0 ? msgs[0].created_at : null;

      const messages: ChatMessage[] = (msgs || []).reverse().map((msg: any) => ({
        ...msg,
        content: msg.body || msg.content || '',
        message_type: msg.message_type || null,
        sender_name: profiles.find(p => p.user_id === msg.sender_id)?.full_name || null,
      }));

      return {
        ...c,
        creator_name: profiles.find(p => p.user_id === c.creator_id)?.full_name || null,
        message_count: count ?? 0,
        last_message_at: lastMsgAt,
        messages,
      } as ChatConversation;
    }));
    setConvs(rows);
    setLoading(false);
  }, [profiles]);

  const loadChannels = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from('channels').select('*').order('created_at', { ascending: false });
    if (error) { toast.error('خطا در بارگذاری کانال‌ها'); setLoading(false); return; }

    const rows = await Promise.all((data || []).map(async (ch: any) => {
      const { count } = await supabase.from('channel_messages').select('id', { count: 'exact', head: true }).eq('channel_id', ch.id);
      const { data: msgs } = await supabase
        .from('channel_messages')
        .select('id, channel_id, sender_id, body, message_type, created_at')
        .eq('channel_id', ch.id)
        .order('created_at', { ascending: false })
        .limit(5);

      const messages: ChannelMsgRow[] = (msgs || []).reverse().map((msg: any) => ({
        ...msg,
        sender_name: profiles.find(p => p.user_id === msg.sender_id)?.full_name || null,
      }));

      return {
        ...ch,
        creator_name: profiles.find(p => p.user_id === ch.created_by)?.full_name || null,
        message_count: count ?? 0,
        messages,
      } as ChannelRow;
    }));
    setChannels(rows);
    setLoading(false);
  }, [profiles]);

  useEffect(() => {
    if (activeTab === 'chat') loadConvs();
    else loadChannels();
  }, [activeTab, loadConvs, loadChannels]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const deleteConv = async (id: string) => {
    await supabase.from('chat_messages').delete().eq('conversation_id', id);
    const { error } = await supabase.from('chat_conversations').delete().eq('id', id);
    if (error) { toast.error('خطا در حذف'); return; }
    toast.success('مکالمه حذف شد');
    setDeleteId(null);
    loadConvs();
  };

  const filtered = convs.filter(c => {
    if (search && !c.name?.toLowerCase().includes(search.toLowerCase()) && !c.creator_name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (filterType !== 'all' && c.type !== filterType) return false;
    if (filterUser !== 'all' && c.creator_id !== filterUser && !(c.participant_ids || []).includes(filterUser)) return false;
    if (filterDateFrom) {
      const fromIso = jalaliToGregorian(filterDateFrom);
      if (fromIso && c.created_at && new Date(c.created_at) < new Date(fromIso)) return false;
    }
    if (filterDateTo) {
      const toIso = jalaliToGregorian(filterDateTo);
      if (toIso && c.created_at && new Date(c.created_at) > new Date(toIso)) return false;
    }
    if (filterHasMessages === 'yes' && (c.message_count ?? 0) === 0) return false;
    if (filterHasMessages === 'no' && (c.message_count ?? 0) > 0) return false;
    return true;
  });

  const clearFilters = () => { setSearch(''); setFilterType('all'); setFilterUser('all'); setFilterDateFrom(''); setFilterDateTo(''); setFilterHasMessages('all'); };
  const hasFilter = search || filterType !== 'all' || filterUser !== 'all' || filterDateFrom || filterDateTo || filterHasMessages !== 'all';

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center shadow-sm flex-shrink-0">
          <MessageSquare className="w-9 h-9 text-teal-600 dark:text-teal-400" />
        </div>
        <div className="flex-1">
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">مدیریت چت سازمانی</h2>
          <p className="text-sm text-gray-500">
            {activeTab === 'chat' ? `${filtered.length} مکالمه از ${convs.length}` : `${channels.filter(ch => !search || ch.name?.toLowerCase().includes(search.toLowerCase())).length} کانال از ${channels.length}`}
          </p>
        </div>
        <button onClick={() => activeTab === 'chat' ? loadConvs() : loadChannels()} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-xl text-sm text-gray-600 dark:text-gray-300 transition-colors">
          <RefreshCw className="w-4 h-4" /> بارگذاری
        </button>
      </div>

      <div className="flex gap-2">
        <button onClick={() => setActiveTab('chat')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'chat' ? 'bg-teal-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
          <MessageSquare className="w-4 h-4" /> چت مستقیم / گروهی
        </button>
        <button onClick={() => setActiveTab('channels')} className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${activeTab === 'channels' ? 'bg-teal-500 text-white shadow-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
          <ChannelIcon className="w-4 h-4" /> کانال‌ها
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center gap-2 mb-3"><Filter className="w-4 h-4 text-teal-500" /><span className="text-sm font-semibold text-gray-700 dark:text-gray-300">فیلترهای پیشرفته</span></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو نام / ایجادکننده..." className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)} className={SEL}>
            <option value="all">همه انواع</option>
            <option value="direct">مستقیم</option>
            <option value="group">گروهی</option>
          </select>
          <select value={filterUser} onChange={e => setFilterUser(e.target.value)} className={SEL}>
            <option value="all">همه کاربران</option>
            {profiles.map(p => <option key={p.user_id} value={p.user_id}>{p.full_name || p.email}</option>)}
          </select>
          <select value={filterHasMessages} onChange={e => setFilterHasMessages(e.target.value)} className={SEL}>
            <option value="all">همه مکالمات</option>
            <option value="yes">دارای پیام</option>
            <option value="no">بدون پیام</option>
          </select>
          <div className="flex gap-2">
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">از (شمسی)</span>
              <JalaliInput value={filterDateFrom} onChange={setFilterDateFrom} placeholder="1403/01/01" />
            </div>
            <div className="flex-1 flex flex-col gap-1">
              <span className="text-xs text-gray-400">تا (شمسی)</span>
              <JalaliInput value={filterDateTo} onChange={setFilterDateTo} placeholder="1403/12/29" />
            </div>
          </div>
        </div>
        {hasFilter && (
          <button onClick={clearFilters} className="mt-3 flex items-center gap-1.5 text-xs text-red-500 hover:text-red-600">
            <X className="w-3.5 h-3.5" /> پاک کردن فیلترها
          </button>
        )}
      </div>

      {/* Superadmin code for confidential messages */}
      <div className="flex items-center gap-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-xl px-4 py-3">
        <Lock className="w-4 h-4 text-orange-500 flex-shrink-0" />
        <span className="text-xs text-orange-700 dark:text-orange-300 flex-1">پیام‌های محرمانه نیاز به کد سوپرادمین دارند</span>
        {superAdminVerified ? (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium">
            <Eye className="w-3.5 h-3.5" />دسترسی فعال است
          </span>
        ) : showCodeInput ? (
          <div className="flex items-center gap-2">
            <input type="password" value={superAdminCode} onChange={e => setSuperAdminCode(e.target.value)}
              placeholder="کد سوپرادمین" className="px-3 py-1.5 text-sm border border-orange-300 dark:border-orange-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white w-36 focus:outline-none focus:ring-2 focus:ring-orange-500" dir="ltr" />
            <button onClick={() => {
              if (superAdminCode === SUPERADMIN_CODE) { setSuperAdminVerified(true); toast.success('دسترسی محرمانه فعال شد'); }
              else { toast.error('کد اشتباه است'); setSuperAdminCode(''); }
              setShowCodeInput(false);
            }} className="px-3 py-1.5 bg-orange-500 text-white text-xs rounded-lg hover:bg-orange-600">تایید</button>
          </div>
        ) : (
          <button onClick={() => setShowCodeInput(true)} className="px-3 py-1.5 bg-orange-100 dark:bg-orange-800 text-orange-700 dark:text-orange-300 text-xs rounded-lg hover:bg-orange-200 dark:hover:bg-orange-700">وارد کردن کد</button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-teal-500" /></div>
      ) : activeTab === 'chat' ? (
        filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400"><MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm">هیچ مکالمه‌ای یافت نشد</p></div>
        ) : (
          <div className="space-y-3">
            {filtered.map(c => (
              <div key={c.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <h4 className="font-bold text-gray-900 dark:text-white text-sm">{c.name || 'مکالمه مستقیم'}</h4>
                      <Badge2 label={c.type === 'direct' ? 'مستقیم' : c.type === 'group' ? 'گروهی' : c.type} colorCls={c.type === 'direct' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'} />
                      <Badge2 label={`${c.message_count ?? 0} پیام`} colorCls="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400" />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
                      <DataField label="ایجادکننده" value={c.creator_name} />
                      <DataField label="تاریخ ایجاد" value={toJalali(c.created_at)} />
                      <DataField label="آخرین پیام" value={toJalaliTime(c.last_message_at)} />
                      <DataField label="شرکت‌کنندگان" value={`${(c.participant_ids || []).length} نفر`} />
                    </div>
                    {c.participant_ids && c.participant_ids.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.participant_ids.slice(0, 5).map(uid => (
                          <span key={uid} className="px-2 py-0.5 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 rounded-full text-xs">
                            {profiles.find(p => p.user_id === uid)?.full_name || uid.slice(0, 8)}
                          </span>
                        ))}
                        {c.participant_ids.length > 5 && <span className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded-full text-xs">+{c.participant_ids.length - 5}</span>}
                      </div>
                    )}
                    {c.messages && c.messages.length > 0 && (
                      <div className="mt-3 space-y-1.5 border-t border-gray-100 dark:border-gray-700 pt-2">
                        <p className="text-xs text-gray-400 font-medium">آخرین پیام‌ها:</p>
                        {c.messages.map((msg: any) => (
                          <div key={msg.id} className="flex items-start gap-2">
                            <div className="w-5 h-5 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center text-xs font-bold text-teal-600 dark:text-teal-400 flex-shrink-0">{(msg.sender_name || '?')[0]}</div>
                            <div className="flex-1 min-w-0">
                              <span className="text-xs font-medium text-gray-600 dark:text-gray-300 ml-1">{msg.sender_name || '—'}</span>
                              <span className="text-xs text-gray-300 dark:text-gray-600 ml-1">{toJalaliTime(msg.created_at)}</span>
                              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{maskConfidential(msg.content || msg.body || '', msg.message_type, superAdminVerified)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="relative flex-shrink-0" ref={menuOpen === c.id ? menuRef : undefined}>
                    <button onClick={() => setMenuOpen(menuOpen === c.id ? null : c.id)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400">
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {menuOpen === c.id && (
                      <div className="absolute left-0 top-8 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 min-w-[140px] overflow-hidden">
                        <button onClick={() => { setFlowConv(c); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
                          <GitBranch className="w-3.5 h-3.5 text-teal-500" /> فلوچارت
                        </button>
                        <button onClick={() => { setDeleteId(c.id); setMenuOpen(null); }} className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20">
                          <Trash2 className="w-3.5 h-3.5" /> حذف
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )
      ) : (
        /* Channels tab */
        channels.length === 0 ? (
          <div className="text-center py-16 text-gray-400"><ChannelIcon className="w-12 h-12 mx-auto mb-3 opacity-30" /><p className="text-sm">هیچ کانالی یافت نشد</p></div>
        ) : (
          <div className="space-y-3">
            {channels.filter(ch => !search || ch.name?.toLowerCase().includes(search.toLowerCase())).map(ch => (
              <div key={ch.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h4 className="font-bold text-gray-900 dark:text-white text-sm">{ch.name || '—'}</h4>
                  <Badge2 label={ch.is_private ? 'خصوصی' : 'عمومی'} colorCls={ch.is_private ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400' : 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'} />
                  <Badge2 label={`${ch.message_count ?? 0} پیام`} colorCls="bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400" />
                  <Badge2 label={`${ch.member_count ?? 0} عضو`} colorCls="bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 mb-2">
                  <DataField label="ایجادکننده" value={ch.creator_name} />
                  <DataField label="تاریخ ایجاد" value={toJalali(ch.created_at)} />
                  <DataField label="آخرین پیام" value={toJalaliTime(ch.last_message_at)} />
                </div>
                {ch.messages && ch.messages.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-gray-100 dark:border-gray-700 pt-2">
                    <p className="text-xs text-gray-400 font-medium">آخرین پیام‌ها:</p>
                    {ch.messages.map(msg => (
                      <div key={msg.id} className="flex items-start gap-2">
                        <div className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-xs font-bold text-blue-600 dark:text-blue-400 flex-shrink-0">{(msg.sender_name || '?')[0]}</div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-300 ml-1">{msg.sender_name || '—'}</span>
                          <span className="text-xs text-gray-300 dark:text-gray-600 ml-1">{toJalaliTime(msg.created_at)}</span>
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{maskConfidential(msg.body || '', msg.message_type, superAdminVerified)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {flowConv && <ChatFlowModal conv={flowConv} profiles={profiles} onClose={() => setFlowConv(null)} />}
      {deleteId && <ConfirmDeleteModal message="آیا از حذف این مکالمه و تمام پیام‌های آن اطمینان دارید؟" onConfirm={() => deleteConv(deleteId)} onCancel={() => setDeleteId(null)} />}
    </div>
  );
}

export { ChatMonitor };
