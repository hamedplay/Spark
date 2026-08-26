import { useState, useEffect, useCallback } from 'react';
import { Users, Search, Plus, UserPlus, Loader as Loader2, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { BackHeader, GroupBadge } from './Shared';
import type { UserGroup, Member, AllProfile } from './types';

export function MembersPanel({ group, onBack }: { group: UserGroup; onBack: () => void }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [allProfiles, setAllProfiles] = useState<AllProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [addSearch, setAddSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('user_group_members')
      .select('id, user_id, group_id, added_at')
      .eq('group_id', group.id);
    if (error || !data) { setLoading(false); return; }
    if (data.length === 0) { setMembers([]); setLoading(false); return; }
    const userIds = data.map(m => m.user_id);
    const { data: profiles } = await supabase.from('profiles_public').select('user_id, full_name, username, avatar_url').in('user_id', userIds);
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));
    setMembers(data.map(m => ({
      id: m.id, user_id: m.user_id, group_id: m.group_id, joined_at: m.added_at,
      full_name: profileMap[m.user_id]?.full_name ?? null,
      username: profileMap[m.user_id]?.username ?? null,
      avatar_url: profileMap[m.user_id]?.avatar_url ?? null,
    })));
    setLoading(false);
  }, [group.id]);

  useEffect(() => {
    loadMembers();
    supabase.from('profiles_public').select('user_id, full_name, username, avatar_url').order('full_name').then(({ data }) => setAllProfiles((data || []) as AllProfile[]));
  }, [loadMembers]);

  const removeMember = async (memberId: string) => {
    await supabase.from('user_group_members').delete().eq('id', memberId);
    toast.success('عضو حذف شد');
    loadMembers();
  };

  const addMember = async (userId: string) => {
    const exists = members.find(m => m.user_id === userId);
    if (exists) { toast.error('کاربر قبلاً عضو این گروه است'); return; }
    const { error } = await supabase.from('user_group_members').insert([{ group_id: group.id, user_id: userId }]);
    if (error) { toast.error('خطا در افزودن'); return; }
    toast.success('عضو افزوده شد');
    setShowAdd(false);
    setAddSearch('');
    loadMembers();
  };

  const initials = (m: Member) => (m.full_name || m.username || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const filtered = members.filter(m => !search || (m.full_name || '').includes(search) || (m.username || '').includes(search));
  const addFiltered = allProfiles.filter(p =>
    !members.find(m => m.user_id === p.user_id) &&
    (!addSearch || (p.full_name || '').includes(addSearch) || (p.username || '').includes(addSearch))
  );

  return (
    <div className="space-y-4" dir="rtl">
      <BackHeader title="مدیریت اعضا" icon={Users} color="text-blue-500" onBack={onBack} />
      <GroupBadge group={{ ...group, member_count: members.length }} />

      {/* Add member */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
          <span className="font-semibold text-gray-700 dark:text-gray-200 text-sm">افزودن عضو</span>
          <button onClick={() => setShowAdd(v => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-medium transition">
            <UserPlus className="w-3.5 h-3.5" />{showAdd ? 'بستن' : 'افزودن'}
          </button>
        </div>
        {showAdd && (
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <div className="relative mb-3">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input value={addSearch} onChange={e => setAddSearch(e.target.value)} placeholder="جستجوی کاربر..."
                className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="max-h-52 overflow-y-auto space-y-1">
              {addFiltered.slice(0, 20).map(p => (
                <div key={p.user_id} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <div className="w-8 h-8 rounded-lg overflow-hidden flex-shrink-0 bg-gradient-to-br from-teal-400 to-blue-500">
                    {p.avatar_url
                      ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                      : <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                          {(p.full_name || p.username || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                        </div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{p.full_name || '—'}</p>
                    <p className="text-xs text-gray-400 truncate">{p.username}</p>
                  </div>
                  <button onClick={() => addMember(p.user_id)}
                    className="flex items-center gap-1 px-2.5 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg text-xs font-medium hover:bg-blue-200 dark:hover:bg-blue-900/50 transition flex-shrink-0">
                    <Plus className="w-3 h-3" />افزودن
                  </button>
                </div>
              ))}
              {addFiltered.length === 0 && <p className="text-center text-gray-400 text-xs py-4">کاربری یافت نشد</p>}
            </div>
          </div>
        )}
      </div>

      {/* Members list */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700">
          <span className="font-semibold text-gray-700 dark:text-gray-200 text-sm">اعضای گروه ({filtered.length})</span>
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو..."
              className="pr-9 pl-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40" />
          </div>
        </div>
        {loading && <div className="py-10 text-center text-gray-400"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>}
        {!loading && filtered.length === 0 && <div className="py-10 text-center text-gray-400 text-sm">هیچ عضوی یافت نشد</div>}
        <div className="divide-y divide-gray-100 dark:divide-gray-700">
          {filtered.map(m => (
            <div key={m.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <div className="w-9 h-9 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-teal-400 to-blue-500">
                {m.avatar_url
                  ? <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">{initials(m)}</div>}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{m.full_name || '—'}</p>
                <p className="text-xs text-gray-400 truncate">{m.username}</p>
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0">{new Date(m.joined_at).toLocaleDateString('fa-IR')}</span>
              <button onClick={() => removeMember(m.id)}
                className="p-1.5 rounded-lg text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
