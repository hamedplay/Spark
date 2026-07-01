import { useState, useEffect, useCallback } from 'react';
import { Users, MessageSquare, Plus, Search, X, Check, Loader as Loader2, Send, ChevronDown, Trash2, CreditCard as Edit2, CircleAlert as AlertCircle, Info, Building2, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabase';
import { OrgUserProfile } from '../lib/useOrgUsers';

interface Profile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  department: string | null;
  position: string | null;
}

interface UserGroup {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  is_system: boolean;
  is_public: boolean;
  member_count?: number;
}

interface BroadcastMessage {
  id: string;
  title: string;
  body: string;
  sender_id: string;
  scope: string;
  target_group_ids: string[];
  sent_at: string;
  sender_name?: string;
}

const inp = 'w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-sm';

// ─── Group Card ───────────────────────────────────────────────────────────────
function GroupCard({ group, onEdit, onManageMembers, onDelete, isAdmin }: {
  group: UserGroup;
  onEdit: () => void;
  onManageMembers: () => void;
  onDelete: () => void;
  isAdmin: boolean;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center shrink-0">
          <Users className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-bold text-gray-900 dark:text-white text-sm">{group.display_name || group.name}</h3>
          <p className="text-xs text-gray-400 font-mono mt-0.5">{group.name}</p>
          {group.description && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">{group.description}</p>
          )}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-xs bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">
              {group.member_count ?? 0} عضو
            </span>
            {group.is_system && <span className="text-xs bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full">سیستمی</span>}
            {group.is_public && <span className="text-xs bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 px-2 py-0.5 rounded-full">عمومی</span>}
          </div>
        </div>
        {isAdmin && (
          <div className="flex flex-col gap-1 shrink-0">
            <button onClick={onManageMembers} title="مدیریت اعضا"
              className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors">
              <Users className="w-4 h-4" />
            </button>
            {!group.is_system && (
              <>
                <button onClick={onEdit} title="ویرایش"
                  className="p-1.5 text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 rounded-lg transition-colors">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={onDelete} title="حذف"
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Group Form Modal ─────────────────────────────────────────────────────────
function GroupFormModal({ group, onClose, onDone }: {
  group: UserGroup | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const isNew = !group;
  const [form, setForm] = useState({
    name: group?.name ?? '',
    display_name: group?.display_name ?? '',
    description: group?.description ?? '',
    is_public: group?.is_public ?? false,
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.name.trim()) { toast.error('نام گروه الزامی است'); return; }
    setSaving(true);
    if (isNew) {
      const { error } = await supabase.from('user_groups').insert({
        name: form.name.trim(), display_name: form.display_name.trim() || null,
        description: form.description.trim() || null, is_public: form.is_public,
        is_system: false, permissions: {},
      });
      if (error) { toast.error('خطا در ایجاد گروه'); setSaving(false); return; }
      toast.success('گروه ایجاد شد');
    } else {
      const { error } = await supabase.from('user_groups').update({
        name: form.name.trim(), display_name: form.display_name.trim() || null,
        description: form.description.trim() || null, is_public: form.is_public,
      }).eq('id', group!.id);
      if (error) { toast.error('خطا در ویرایش گروه'); setSaving(false); return; }
      toast.success('گروه ویرایش شد');
    }
    setSaving(false);
    onDone();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-gray-900 dark:text-white">{isNew ? 'ایجاد گروه جدید' : 'ویرایش گروه'}</h3>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">نام سیستمی (فارسی/انگلیسی، بدون فاصله)</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className={inp} placeholder="مثلاً: marketing_team" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">نام نمایشی</label>
            <input value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} className={inp} placeholder="مثلاً: تیم بازاریابی" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">توضیحات (اختیاری)</label>
            <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} className={inp + ' resize-none'} rows={3} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input type="checkbox" checked={form.is_public} onChange={e => setForm(f => ({ ...f, is_public: e.target.checked }))} className="w-4 h-4 accent-blue-500" />
            <span className="text-sm text-gray-700 dark:text-gray-300">گروه عمومی (قابل مشاهده برای همه)</span>
          </label>
        </div>
        <div className="flex gap-2 pt-2">
          <button onClick={save} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium text-sm transition-colors">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {isNew ? 'ایجاد گروه' : 'ذخیره تغییرات'}
          </button>
          <button onClick={onClose} className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-colors">
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Members Modal ────────────────────────────────────────────────────────────
function MembersModal({ group, onClose }: { group: UserGroup; onClose: () => void }) {
  const [memberIds, setMemberIds] = useState<string[]>([]);
  const [allProfiles, setAllProfiles] = useState<OrgUserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  const fetchData = useCallback(async () => {
  setLoading(true);
  const [memRes, profilesRes, orgRes] = await Promise.all([
    supabase.from('group_members').select('user_id').eq('group_id', group.id),
    supabase.from('profiles').select('user_id, full_name, email, avatar_url, position').not('is_active', 'eq', false).order('full_name'),
    supabase.from('org_position_members').select(`user_id, org_positions ( title, level, unit_id, org_units ( id, name ) )`).eq('is_primary', true),
  ]);

  const orgMap: Record<string, { unit_id: string | null; unit_name: string | null; position_title: string | null; level: number | null }> = {};
  for (const m of (orgRes.data || [])) {
    const pos = (m as any).org_positions;
    if (!pos) continue;
    const unit = pos.org_units;
    orgMap[m.user_id] = { unit_id: unit?.id || null, unit_name: unit?.name || null, position_title: pos.title || null, level: pos.level || null };
  }

  const enriched: OrgUserProfile[] = (profilesRes.data || []).map(p => ({
    user_id: p.user_id, full_name: p.full_name, email: p.email, avatar_url: p.avatar_url, position: p.position,
    unit_id: orgMap[p.user_id]?.unit_id || null, unit_name: orgMap[p.user_id]?.unit_name || null,
    position_title: orgMap[p.user_id]?.position_title || null, level: orgMap[p.user_id]?.level || null,
  }));

  setMemberIds((memRes.data || []).map((r: any) => r.user_id));
  setAllProfiles(enriched);

    // expand all units by default
    const units = new Set<string>();
    for (const p of enriched) units.add(p.unit_id || '__no_unit__');
    setExpandedUnits(units);
    setLoading(false);
  }, [group.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const toggle = async (profile: OrgUserProfile) => {
    const isMember = memberIds.includes(profile.user_id);
    setActing(profile.user_id);
    if (isMember) {
      await supabase.from('group_members').delete().eq('group_id', group.id).eq('user_id', profile.user_id);
    } else {
      await supabase.from('group_members').insert({ group_id: group.id, user_id: profile.user_id });
    }
    setActing(null);
    fetchData();
  };

  const toggleUnit = (key: string) => setExpandedUnits(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const filtered = allProfiles.filter(p =>
    !search || (p.full_name || '').includes(search) || (p.email || '').includes(search)
  );

  // group by unit
  const unitMap = new Map<string, { label: string; users: OrgUserProfile[] }>();
  for (const p of filtered) {
    const key = p.unit_id || '__no_unit__';
    if (!unitMap.has(key)) unitMap.set(key, { label: p.unit_name || 'بدون واحد سازمانی', users: [] });
    unitMap.get(key)!.users.push(p);
  }
  const unitGroups = [...unitMap.entries()].sort((a, b) => {
    if (a[0] !== '__no_unit__' && b[0] === '__no_unit__') return -1;
    if (a[0] === '__no_unit__' && b[0] !== '__no_unit__') return 1;
    return a[1].label.localeCompare(b[1].label, 'fa');
  });

  const memberCount = memberIds.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[80vh]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <div>
            <h3 className="font-bold text-gray-900 dark:text-white">اعضای گروه</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">{group.display_name || group.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجوی کاربر..."
              className="w-full pr-9 pl-4 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-blue-500" /></div>
          ) : search ? (
            filtered.map(p => <MemberRow key={p.user_id} p={p} isMember={memberIds.includes(p.user_id)} isLoading={acting === p.user_id} onToggle={toggle} />)
          ) : (
            unitGroups.map(([key, { label, users }]) => {
              const expanded = expandedUnits.has(key);
              return (
                <div key={key}>
                  <button onClick={() => toggleUnit(key)} className="w-full flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-700/60 border-b border-gray-100 dark:border-gray-700 text-right sticky top-0 z-10 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                    <Building2 className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                    <span className="flex-1 text-xs font-semibold text-gray-600 dark:text-gray-300 truncate">{label}</span>
                    <span className="text-xs text-gray-400">{users.filter(u => memberIds.includes(u.user_id)).length}/{users.length}</span>
                    {expanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                  </button>
                  {expanded && users.map(p => <MemberRow key={p.user_id} p={p} isMember={memberIds.includes(p.user_id)} isLoading={acting === p.user_id} onToggle={toggle} />)}
                </div>
              );
            })
          )}
        </div>
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 shrink-0">
          <p className="text-xs text-gray-400">{memberCount} عضو فعال در این گروه</p>
        </div>
      </div>
    </div>
  );
}

function MemberRow({ p, isMember, isLoading, onToggle }: { p: OrgUserProfile; isMember: boolean; isLoading: boolean; onToggle: (p: OrgUserProfile) => void }) {
  return (
    <button onClick={() => onToggle(p)}
      className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-right border-b border-gray-50 dark:border-gray-700/50 last:border-0 ${isMember ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}>
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold ${isMember ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : (p.full_name || '?')[0]}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{p.full_name || '—'}</div>
        <div className="text-xs text-gray-400 truncate">{p.position_title || p.email}</div>
      </div>
      {isMember && <Check className="w-4 h-4 text-blue-500 shrink-0" />}
    </button>
  );
}

// ─── Broadcast Tab ────────────────────────────────────────────────────────────
function BroadcastTab({ currentUserId, isAdmin }: { currentUserId: string | null; isAdmin: boolean }) {
  const [messages, setMessages] = useState<BroadcastMessage[]>([]);
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ title: '', body: '', scope: 'all', target_group_ids: [] as string[] });

  const canBroadcast = isAdmin;

  const fetchMessages = useCallback(async () => {
    setLoading(true);
    const [msgRes, groupsRes, profilesRes] = await Promise.all([
      supabase.from('broadcast_messages').select('*').order('sent_at', { ascending: false }).limit(50),
      supabase.from('user_groups').select('id, name, display_name').order('name'),
      supabase.from('profiles').select('user_id, full_name').order('full_name'),
    ]);
    const msgs = (msgRes.data || []) as BroadcastMessage[];
    const profs = profilesRes.data || [];
    const enriched = msgs.map(m => ({
      ...m,
      sender_name: profs.find(p => p.user_id === m.sender_id)?.full_name || '—',
    }));
    setMessages(enriched);
    setGroups(groupsRes.data || []);
    setAllProfiles(profs);
    setLoading(false);
  }, []);

  useEffect(() => { fetchMessages(); }, [fetchMessages]);

  const send = async () => {
    if (!form.title.trim() || !form.body.trim()) { toast.error('عنوان و متن پیام الزامی است'); return; }
    if (!currentUserId) return;
    setSending(true);

    const { data: msg, error } = await supabase.from('broadcast_messages').insert({
      title: form.title.trim(),
      body: form.body.trim(),
      sender_id: currentUserId,
      scope: form.scope,
      target_group_ids: form.scope === 'group' ? form.target_group_ids : [],
    }).select().maybeSingle();

    if (error || !msg) { toast.error('خطا در ارسال پیام'); setSending(false); return; }

    // Build recipient list
    let recipientIds: string[] = [];
    if (form.scope === 'all') {
      recipientIds = allProfiles.map(p => p.user_id).filter(id => id !== currentUserId);
    } else if (form.scope === 'group' && form.target_group_ids.length > 0) {
      const { data: mems } = await supabase.from('group_members')
        .select('user_id').in('group_id', form.target_group_ids);
      recipientIds = [...new Set((mems || []).map((m: any) => m.user_id))].filter(id => id !== currentUserId);
    }

    if (recipientIds.length > 0) {
      await supabase.from('broadcast_recipients').insert(
        recipientIds.map(uid => ({ message_id: msg.id, user_id: uid, is_read: false }))
      );
    }

    toast.success(`پیام برای ${recipientIds.length} نفر ارسال شد`);
    setForm({ title: '', body: '', scope: 'all', target_group_ids: [] });
    setShowForm(false);
    setSending(false);
    fetchMessages();
  };

  const scopeLabel = (scope: string, targetGroupIds: string[]) => {
    if (scope === 'all') return 'کل سازمان';
    if (scope === 'group') {
      const names = targetGroupIds.map(gid => groups.find(g => g.id === gid)?.display_name || '?').join('، ');
      return names || 'گروه‌های انتخابی';
    }
    return scope;
  };

  return (
    <div className="space-y-4">
      {canBroadcast && (
        <div className="flex justify-end">
          <button onClick={() => setShowForm(v => !v)}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm transition-colors">
            <Plus className="w-4 h-4" />
            پیام گروهی جدید
          </button>
        </div>
      )}

      {showForm && canBroadcast && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 space-y-4 shadow-xs">
          <h3 className="font-bold text-gray-900 dark:text-white text-sm">ارسال پیام گروهی</h3>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">عنوان پیام</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className={inp} placeholder="عنوان پیام را بنویسید..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">متن پیام</label>
            <textarea value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              className={inp + ' resize-none'} rows={4} placeholder="متن پیام را بنویسید..." />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">مخاطبان</label>
            <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value, target_group_ids: [] }))} className={inp}>
              <option value="all">کل سازمان</option>
              <option value="group">گروه‌های خاص</option>
            </select>
          </div>
          {form.scope === 'group' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">انتخاب گروه‌ها</label>
              <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 dark:border-gray-600 rounded-xl p-2">
                {groups.map(g => (
                  <label key={g.id} className="flex items-center gap-2 cursor-pointer px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded-lg">
                    <input type="checkbox"
                      checked={form.target_group_ids.includes(g.id)}
                      onChange={e => setForm(f => ({
                        ...f,
                        target_group_ids: e.target.checked
                          ? [...f.target_group_ids, g.id]
                          : f.target_group_ids.filter(id => id !== g.id),
                      }))}
                      className="w-4 h-4 accent-blue-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{g.display_name || g.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl text-xs text-blue-600 dark:text-blue-400">
            <Info className="w-3.5 h-3.5 shrink-0" />
            این پیام به صورت اعلان درون‌برنامه‌ای برای دریافت‌کنندگان ارسال می‌شود.
          </div>
          <div className="flex gap-2">
            <button onClick={send} disabled={sending}
              className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium text-sm transition-colors">
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              ارسال پیام
            </button>
            <button onClick={() => setShowForm(false)} className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-colors">
              انصراف
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /></div>
      ) : messages.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">هنوز پیام گروهی ارسال نشده است</p>
        </div>
      ) : (
        <div className="space-y-3">
          {messages.map(m => (
            <div key={m.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h4 className="font-semibold text-gray-900 dark:text-white text-sm">{m.title}</h4>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${m.scope === 'all' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400'}`}>
                      {scopeLabel(m.scope, m.target_group_ids)}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{m.body}</p>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-3 pt-3 border-t border-gray-50 dark:border-gray-700/50 text-xs text-gray-400">
                <span>فرستنده: {m.sender_name}</span>
                <span>·</span>
                <span>{new Date(m.sent_at).toLocaleDateString('fa-IR', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Groups Tab ───────────────────────────────────────────────────────────────
function GroupsTab({ isAdmin }: { currentUserId: string | null; isAdmin: boolean }) {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [targetEdit, setTargetEdit] = useState<UserGroup | null>(null);
  const [membersGroup, setMembersGroup] = useState<UserGroup | null>(null);
  const [deleteGroup, setDeleteGroup] = useState<UserGroup | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('user_groups').select(`
      id, name, display_name, description, is_system, is_public, permissions,
      member_count:group_members(count)
    `).order('name');
    const normalized = (data || []).map((g: any) => ({
      ...g,
      member_count: Array.isArray(g.member_count) ? g.member_count[0]?.count ?? 0 : g.member_count ?? 0,
    }));
    setGroups(normalized);
    setLoading(false);
  }, []);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const filtered = groups.filter(g =>
    !search || (g.display_name || g.name || '').includes(search)
  );

  const confirmDelete = async () => {
    if (!deleteGroup) return;
    setDeleting(true);
    const { error } = await supabase.from('user_groups').delete().eq('id', deleteGroup.id);
    setDeleting(false);
    if (error) { toast.error('خطا در حذف گروه'); return; }
    toast.success('گروه حذف شد');
    setDeleteGroup(null);
    fetchGroups();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجوی گروه..."
            className="w-full pr-9 pl-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition" />
        </div>
        {isAdmin && (
          <button onClick={() => { setTargetEdit(null); setShowForm(true); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium text-sm transition-colors shrink-0">
            <Plus className="w-4 h-4" />
            گروه جدید
          </button>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-7 h-7 animate-spin text-blue-500" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400 dark:text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">گروهی یافت نشد</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filtered.map(g => (
            <GroupCard key={g.id} group={g} isAdmin={isAdmin}
              onEdit={() => { setTargetEdit(g); setShowForm(true); }}
              onManageMembers={() => setMembersGroup(g)}
              onDelete={() => setDeleteGroup(g)} />
          ))}
        </div>
      )}

      {showForm && (
        <GroupFormModal
          group={targetEdit}
          onClose={() => setShowForm(false)}
          onDone={() => { setShowForm(false); fetchGroups(); }}
        />
      )}

      {membersGroup && (
        <MembersModal group={membersGroup} onClose={() => { setMembersGroup(null); fetchGroups(); }} />
      )}

      {deleteGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" dir="rtl">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h3 className="font-bold text-gray-900 dark:text-white">حذف گروه</h3>
                <p className="text-xs text-gray-500">{deleteGroup.display_name || deleteGroup.name}</p>
              </div>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">آیا از حذف این گروه مطمئن هستید؟ این عمل برگشت‌پذیر نیست.</p>
            <div className="flex gap-2">
              <button onClick={confirmDelete} disabled={deleting}
                className="flex-1 flex items-center justify-center gap-2 bg-red-600 text-white py-2.5 rounded-xl hover:bg-red-700 disabled:opacity-50 font-medium text-sm transition-colors">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                حذف گروه
              </button>
              <button onClick={() => setDeleteGroup(null)}
                className="px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 text-sm transition-colors">
                انصراف
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export function GroupsPage({ currentUserId, isAdmin }: { currentUserId: string | null; isAdmin: boolean }) {
  const [tab, setTab] = useState<'groups' | 'broadcast'>('groups');

  const tabs = [
    { key: 'groups' as const, label: 'گروه‌ها', icon: Users },
    { key: 'broadcast' as const, label: 'پیام گروهی', icon: MessageSquare },
  ];

  return (
    <div className="space-y-6" dir="rtl">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
          <Users className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">گروه‌ها</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">مدیریت گروه‌ها و ارسال پیام گروهی</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.key ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-xs' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'}`}>
              <Icon className="w-4 h-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {tab === 'groups' ? (
        <GroupsTab currentUserId={currentUserId} isAdmin={isAdmin} />
      ) : (
        <BroadcastTab currentUserId={currentUserId} isAdmin={isAdmin} />
      )}
    </div>
  );
}
