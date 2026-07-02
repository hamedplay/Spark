import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Search, Plus, RefreshCw, EllipsisVertical as MoreVertical, CreditCard as Edit2, Trash2, UserPlus, ShieldCheck, X, Save, Check, Loader as Loader2, CircleAlert as AlertCircle, Activity, ListFilter as Filter, ChevronDown, Info, TriangleAlert as AlertTriangle, Zap, Group as GroupIcon } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────
interface UserGroup {
  id: string;
  name: string;
  display_name: string | null;
  description: string | null;
  is_system: boolean;
  is_public: boolean;
  permissions: Record<string, boolean>;
  member_count?: number;
}

interface Member {
  id: string;
  user_id: string;
  group_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  joined_at: string;
}

interface AuditRow {
  id: string;
  created_at: string;
  user_id: string | null;
  user_name: string | null;
  ip_address: string | null;
  module: string | null;
  action: string;
  details: string | null;
  severity: string;
}

interface AllProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
}

type Panel = 'list' | 'add' | 'edit' | 'delete' | 'members' | 'access' | 'events';

// ─── Shared helpers ───────────────────────────────────────────────────────────
const inp = 'w-full pr-10 pl-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-sm';

function BackHeader({ title, icon: Icon, color, onBack }: { title: string; icon: React.ElementType; color: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-3 mb-4">
      <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
        <X className="w-4 h-4" />
      </button>
      <Icon className={`w-5 h-5 ${color}`} />
      <h3 className="font-bold text-gray-800 dark:text-white text-lg">{title}</h3>
    </div>
  );
}

function GroupBadge({ group }: { group: UserGroup }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3 mb-4">
      <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
        <GroupIcon className="w-5 h-5 text-white" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-gray-800 dark:text-white">{group.display_name || group.name}</p>
        <p className="text-xs text-gray-400 font-mono">{group.name}</p>
      </div>
      <div className="flex gap-2 flex-shrink-0">
        {group.is_system && <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2 py-1 rounded-full">سیستمی</span>}
        {group.is_public && <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 px-2 py-1 rounded-full">عمومی</span>}
        <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full">{group.member_count ?? 0} عضو</span>
      </div>
    </div>
  );
}

// ─── Edit / Add form ──────────────────────────────────────────────────────────
function GroupForm({ group, onBack, onDone }: {
  group: UserGroup | null; onBack: () => void; onDone: () => void;
}) {
  const isNew = !group;
  const [form, setForm] = useState({
    name: group?.name ?? '',
    display_name: group?.display_name ?? '',
    description: group?.description ?? '',
    is_public: group?.is_public ?? false,
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('نام گروه الزامی است'); return; }
    setSaving(true);
    if (isNew) {
      const { error } = await supabase.from('user_groups').insert([{ ...form, is_system: false, permissions: {} }]);
      if (error) { toast.error('خطا در ایجاد گروه'); setSaving(false); return; }
      toast.success('گروه ایجاد شد');
    } else {
      const { error } = await supabase.from('user_groups').update({ display_name: form.display_name, description: form.description, is_public: form.is_public }).eq('id', group!.id);
      if (error) { toast.error('خطا در ذخیره'); setSaving(false); return; }
      toast.success('گروه ویرایش شد');
    }
    setSaving(false);
    onDone();
  };

  const fields = [
    { label: 'نام (انگلیسی)', key: 'name', disabled: !isNew, dir: 'ltr' as const, placeholder: 'example_group' },
    { label: 'نام نمایشی', key: 'display_name', disabled: false, dir: 'rtl' as const, placeholder: 'نام قابل نمایش' },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      <BackHeader title={isNew ? 'ایجاد گروه جدید' : 'ویرایش گروه'} icon={isNew ? Plus : Edit2} color={isNew ? 'text-blue-500' : 'text-teal-500'} onBack={onBack} />
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 space-y-4">
        {fields.map(({ label, key, disabled, dir, placeholder }) => (
          <div key={key}>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">{label}</label>
            <input
              className={inp + (disabled ? ' opacity-60 cursor-not-allowed bg-gray-50 dark:bg-gray-600' : '')}
              disabled={disabled}
              dir={dir}
              value={(form as any)[key]}
              onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
              placeholder={placeholder}
            />
          </div>
        ))}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">توضیحات</label>
          <textarea rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
            className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 transition text-sm resize-none"
            placeholder="توضیح کوتاه درباره گروه" />
        </div>
        <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-gray-50 dark:bg-gray-700">
          <span className="text-sm font-medium text-gray-700 dark:text-gray-300">گروه عمومی (قابل دیدن توسط همه)</span>
          <button type="button" onClick={() => setForm(f => ({ ...f, is_public: !f.is_public }))}
            className={`w-10 h-5 rounded-full relative transition-colors ${form.is_public ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.is_public ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'در حال ذخیره...' : isNew ? 'ایجاد گروه' : 'ذخیره'}
          </button>
          <button onClick={onBack} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
        </div>
      </div>
    </div>
  );
}

// ─── Delete panel ─────────────────────────────────────────────────────────────
function DeletePanel({ group, onBack, onDone }: { group: UserGroup; onBack: () => void; onDone: () => void }) {
  const [deleting, setDeleting] = useState(false);

  const handle = async () => {
    if (group.is_system) { toast.error('گروه‌های سیستمی قابل حذف نیستند'); return; }
    setDeleting(true);
    await supabase.from('user_group_members').delete().eq('group_id', group.id);
    const { error } = await supabase.from('user_groups').delete().eq('id', group.id);
    if (error) { toast.error('خطا در حذف'); setDeleting(false); return; }
    toast.success('گروه حذف شد');
    onDone();
  };

  return (
    <div className="space-y-4" dir="rtl">
      <BackHeader title="حذف گروه" icon={Trash2} color="text-red-500" onBack={onBack} />
      <GroupBadge group={group} />
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
        {group.is_system ? (
          <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            گروه‌های سیستمی قابل حذف نیستند. این گروه برای عملکرد سامانه ضروری است.
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-5">
              آیا مطمئن هستید که می‌خواهید گروه «<strong>{group.display_name || group.name}</strong>» را حذف کنید؟
              تمام اعضای این گروه از آن خارج خواهند شد.
            </p>
            <div className="flex gap-3">
              <button onClick={handle} disabled={deleting}
                className="flex items-center gap-2 px-6 py-2.5 bg-red-500 hover:bg-red-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                {deleting ? 'در حال حذف...' : 'حذف گروه'}
              </button>
              <button onClick={onBack} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Members panel ─────────────────────────────────────────────────────────────
function MembersPanel({ group, onBack }: { group: UserGroup; onBack: () => void }) {
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
    const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email, avatar_url').in('user_id', userIds);
    const profileMap = Object.fromEntries((profiles || []).map(p => [p.user_id, p]));
    setMembers(data.map(m => ({
      id: m.id, user_id: m.user_id, group_id: m.group_id, joined_at: m.added_at,
      full_name: profileMap[m.user_id]?.full_name ?? null,
      email: profileMap[m.user_id]?.email ?? null,
      avatar_url: profileMap[m.user_id]?.avatar_url ?? null,
    })));
    setLoading(false);
  }, [group.id]);

  useEffect(() => {
    loadMembers();
    supabase.from('profiles').select('user_id, full_name, email, avatar_url').order('full_name').then(({ data }) => setAllProfiles((data || []) as AllProfile[]));
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

  const initials = (m: Member) => (m.full_name || m.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const filtered = members.filter(m => !search || (m.full_name || '').includes(search) || (m.email || '').includes(search));
  const addFiltered = allProfiles.filter(p =>
    !members.find(m => m.user_id === p.user_id) &&
    (!addSearch || (p.full_name || '').includes(addSearch) || (p.email || '').includes(addSearch))
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
                          {(p.full_name || p.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                        </div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{p.full_name || '—'}</p>
                    <p className="text-xs text-gray-400 truncate">{p.email}</p>
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
                <p className="text-xs text-gray-400 truncate">{m.email}</p>
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

// ─── Access panel ─────────────────────────────────────────────────────────────
function AccessPanel({ group, onBack }: { group: UserGroup; onBack: () => void }) {
  const PERMISSION_GROUPS = [
    {
      label: 'ماژول‌های اصلی',
      color: 'text-blue-500',
      items: [
        { key: 'meetings', label: 'جلسات و برنامه‌ریزی', desc: 'دسترسی به بخش جلسات' },
        { key: 'calendar', label: 'تقویم', desc: 'دسترسی به تقویم سازمانی' },
        { key: 'chat', label: 'چت سازمانی', desc: 'دسترسی به چت' },
        { key: 'channels', label: 'کانال‌ها و گروه‌ها', desc: 'دسترسی به کانال‌ها و گروه‌های سازمانی' },
        { key: 'video_conference', label: 'ویدیو کنفرانس', desc: 'دسترسی به تماس تصویری' },
        { key: 'tasks', label: 'اقدامات و وظایف', desc: 'دسترسی به وظایف' },
        { key: 'notes', label: 'یادداشت‌ها', desc: 'دسترسی به یادداشت‌ها' },
        { key: 'contacts', label: 'مخاطبین', desc: 'دسترسی به مخاطبین' },
        { key: 'reports', label: 'گزارشات تحلیلی', desc: 'دسترسی به گزارشات' },
        { key: 'admin_panel', label: 'پنل مدیریت', desc: 'دسترسی به پیکربندی سیستم' },
      ],
    },
    {
      label: 'جلسات — عملیات',
      color: 'text-cyan-600',
      items: [
        { key: 'meetings_create', label: 'ایجاد جلسه', desc: 'اجازه ایجاد جلسه جدید' },
        { key: 'meetings_edit', label: 'ویرایش جلسه', desc: 'اجازه ویرایش جلسات' },
        { key: 'meetings_delete', label: 'حذف جلسه', desc: 'اجازه حذف جلسات' },
        { key: 'meetings_approve', label: 'تایید جلسه', desc: 'اجازه تغییر وضعیت جلسه' },
      ],
    },
    {
      label: 'اقدامات — عملیات',
      color: 'text-green-600',
      items: [
        { key: 'tasks_create', label: 'ایجاد اقدام', desc: 'اجازه ثبت اقدام جدید' },
        { key: 'tasks_edit', label: 'ویرایش اقدام', desc: 'اجازه ویرایش اقدامات' },
        { key: 'tasks_delete', label: 'حذف اقدام', desc: 'اجازه حذف اقدامات' },
      ],
    },
    {
      label: 'یادداشت‌ها — عملیات',
      color: 'text-amber-600',
      items: [
        { key: 'notes_create', label: 'ایجاد یادداشت', desc: 'اجازه ثبت یادداشت جدید' },
        { key: 'notes_edit', label: 'ویرایش یادداشت', desc: 'اجازه ویرایش یادداشت‌ها' },
        { key: 'notes_delete', label: 'حذف یادداشت', desc: 'اجازه حذف یادداشت‌ها' },
      ],
    },
    {
      label: 'مخاطبین — عملیات',
      color: 'text-orange-600',
      items: [
        { key: 'contacts_create', label: 'ایجاد مخاطب', desc: 'اجازه افزودن مخاطب' },
        { key: 'contacts_edit', label: 'ویرایش مخاطب', desc: 'اجازه ویرایش مخاطبین' },
        { key: 'contacts_delete', label: 'حذف مخاطب', desc: 'اجازه حذف مخاطبین' },
      ],
    },
    {
      label: 'تقویم — عملیات',
      color: 'text-teal-600',
      items: [
        { key: 'calendar_create_event', label: 'ایجاد رویداد', desc: 'اجازه ایجاد رویداد در تقویم' },
        { key: 'calendar_edit_event', label: 'ویرایش رویداد', desc: 'اجازه ویرایش رویدادها' },
        { key: 'calendar_delete_event', label: 'حذف رویداد', desc: 'اجازه حذف رویدادها' },
        { key: 'calendar_hide_offhours', label: 'پنهان کردن ساعات غیرکاری', desc: 'امکان پنهان/نمایش ساعات خارج از وقت کاری در تقویم' },
      ],
    },
    {
      label: 'چت — امکانات پیشرفته',
      color: 'text-rose-600',
      items: [
        { key: 'chat_send_urgent', label: 'ارسال پیام اورژانسی', desc: 'اجازه ارسال پیام نوع اورژانسی' },
        { key: 'chat_send_confidential', label: 'ارسال پیام محرمانه', desc: 'اجازه ارسال پیام محرمانه' },
        { key: 'chat_delete_messages', label: 'حذف پیام‌ها', desc: 'اجازه حذف پیام برای همه' },
      ],
    },
    {
      label: 'کانال‌ها — عملیات',
      color: 'text-teal-600',
      items: [
        { key: 'channels_create', label: 'ایجاد کانال', desc: 'اجازه ایجاد کانال جدید' },
        { key: 'channels_create_group', label: 'ایجاد گروه', desc: 'اجازه ایجاد گروه جدید' },
        { key: 'channels_pin_messages', label: 'پین کردن پیام', desc: 'اجازه پین کردن پیام در کانال/گروه' },
        { key: 'channels_delete_messages', label: 'حذف پیام', desc: 'اجازه حذف پیام در کانال/گروه' },
        { key: 'channels_manage_members', label: 'مدیریت اعضا', desc: 'اجازه افزودن و حذف اعضای کانال/گروه' },
        { key: 'channels_send_urgent', label: 'ارسال پیام اورژانسی', desc: 'اجازه ارسال پیام اورژانسی در کانال' },
        { key: 'channels_send_confidential', label: 'ارسال پیام محرمانه', desc: 'اجازه ارسال پیام محرمانه در کانال' },
        { key: 'channels_group_tasks', label: 'ایجاد اقدام گروهی', desc: 'اجازه ایجاد اقدامات گروهی' },
      ],
    },
    {
      label: 'گزارشات — عملیات',
      color: 'text-gray-600',
      items: [
        { key: 'reports_export', label: 'خروجی گزارش', desc: 'اجازه دانلود و خروجی گرفتن' },
      ],
    },
    {
      label: 'پیکربندی سیستم — دسترسی',
      color: 'text-red-600',
      items: [
        { key: 'config_view', label: 'مشاهده پیکربندی', desc: 'مشاهده آیکون و ورود به پیکربندی' },
        { key: 'config_platform', label: 'تنظیمات پلتفرم', desc: 'تنظیمات کلی، ظاهر، منطقه‌ای' },
        { key: 'config_users', label: 'مدیریت کاربران', desc: 'فهرست کاربران، گروه‌ها، ساختار سازمانی' },
        { key: 'config_access', label: 'حقوق دسترسی', desc: 'تنظیمات امنیت و دسترسی سرور' },
        { key: 'config_audit', label: 'گزارش رخدادها', desc: 'مشاهده لاگ‌های سیستم' },
        { key: 'config_notifications', label: 'اعلان‌ها و پیامک', desc: 'تنظیم قالب اعلان، پیامک، بات' },
        { key: 'config_modules', label: 'مدیریت موجودیت‌ها', desc: 'ویدیو کنفرانس، تقویم، مانیتورینگ' },
        { key: 'config_spark', label: 'دستیار اسپارک', desc: 'پیکربندی هوش مصنوعی' },
        { key: 'config_backup', label: 'پشتیبان‌گیری', desc: 'دسترسی به خروجی پشتیبان دیتابیس' },
      ],
    },
  ];

  const [perms, setPerms] = useState<Record<string, boolean>>(group.permissions || {});
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => setPerms(p => ({ ...p, [key]: !p[key] }));

  // When a module is enabled, also enable its sub-permissions automatically, and vice versa
  const toggleModule = (moduleKey: string) => {
    const newVal = !perms[moduleKey];
    const subGroup = PERMISSION_GROUPS.find(g => {
      const moduleMapping: Record<string, string> = {
        'جلسات — عملیات': 'meetings',
        'اقدامات — عملیات': 'tasks',
        'یادداشت‌ها — عملیات': 'notes',
        'مخاطبین — عملیات': 'contacts',
        'تقویم — عملیات': 'calendar',
        'چت — امکانات پیشرفته': 'chat',
        'گزارشات — عملیات': 'reports',
      };
      return moduleMapping[g.label] === moduleKey;
    });
    setPerms(p => {
      const updated = { ...p, [moduleKey]: newVal };
      // If disabling a module, disable its sub-perms too
      if (!newVal && subGroup) {
        subGroup.items.forEach(item => { updated[item.key] = false; });
      }
      return updated;
    });
  };

  const mainModuleKeys = new Set(PERMISSION_GROUPS[0].items.map(i => i.key));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('user_groups').update({ permissions: perms }).eq('id', group.id);
    if (error) { toast.error('خطا در ذخیره'); } else { toast.success('دسترسی‌ها ذخیره شد'); }
    setSaving(false);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <BackHeader title="حقوق دسترسی گروه" icon={ShieldCheck} color="text-teal-500" onBack={onBack} />
      <GroupBadge group={group} />
      <div className="space-y-3">
        {PERMISSION_GROUPS.map(group => (
          <div key={group.label} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-2.5 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <ShieldCheck className={`w-4 h-4 ${group.color}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${group.color}`}>{group.label}</span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {group.items.map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  </div>
                  <button
                    onClick={() => mainModuleKeys.has(key) ? toggleModule(key) : toggle(key)}
                    className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${perms[key] ? 'bg-teal-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${perms[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-900 pt-2 pb-4">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition w-full justify-center sm:w-auto">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'در حال ذخیره...' : 'ذخیره دسترسی‌ها'}
        </button>
      </div>
    </div>
  );
}

// ─── Events panel (all audit logs) ───────────────────────────────────────────
export function GroupEventsPanel() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
    if (severityFilter !== 'all') q = q.eq('severity', severityFilter);
    if (moduleFilter !== 'all') q = q.eq('module', moduleFilter);
    const { data } = await q;
    setLogs((data || []) as AuditRow[]);
    setLoading(false);
  }, [severityFilter, moduleFilter]);

  useEffect(() => { load(); }, [load]);

  const modules = Array.from(new Set(logs.map(l => l.module).filter(Boolean))) as string[];
  const filtered = logs.filter(l => !search || l.action.includes(search) || (l.user_name || '').includes(search) || (l.module || '').includes(search) || (l.details || '').includes(search));

  const sevIcon = (s: string) => {
    if (s === 'critical' || s === 'error') return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    if (s === 'warning') return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
    if (s === 'success') return <Check className="w-3.5 h-3.5 text-green-500" />;
    return <Info className="w-3.5 h-3.5 text-blue-400" />;
  };

  const sevBadge = (s: string) => {
    if (s === 'critical' || s === 'error') return 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400';
    if (s === 'warning') return 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400';
    if (s === 'success') return 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400';
    return 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400';
  };

  const sevLabel: Record<string, string> = { info: 'اطلاع', success: 'موفق', warning: 'هشدار', error: 'خطا', critical: 'بحرانی' };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header + filter bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />رخدادها
          <span className="text-sm font-normal text-gray-400">({filtered.length})</span>
        </h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو..."
              className="pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-44" />
          </div>
          <button onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-colors border ${showFilters ? 'bg-blue-500 text-white border-blue-500' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-400'}`}>
            <Filter className="w-4 h-4" />فیلتر
          </button>
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex flex-wrap gap-4">
          <div className="flex-1 min-w-48">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1.5">سطح رویداد</label>
            <div className="relative">
              <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
                className="w-full appearance-none pr-3 pl-8 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="all">همه سطوح</option>
                <option value="info">اطلاع</option>
                <option value="success">موفق</option>
                <option value="warning">هشدار</option>
                <option value="error">خطا</option>
                <option value="critical">بحرانی</option>
              </select>
              <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div className="flex-1 min-w-48">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1.5">ماژول</label>
            <div className="relative">
              <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}
                className="w-full appearance-none pr-3 pl-8 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="all">همه ماژول‌ها</option>
                {modules.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div className="flex items-end">
            <button onClick={() => { setSeverityFilter('all'); setModuleFilter('all'); setSearch(''); }}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition">
              پاک کردن فیلترها
            </button>
          </div>
        </div>
      )}

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(sevLabel).map(([key, label]) => {
          const count = logs.filter(l => l.severity === key).length;
          if (!count) return null;
          return (
            <button key={key} onClick={() => setSeverityFilter(severityFilter === key ? 'all' : key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${severityFilter === key ? 'ring-2 ring-offset-1 ring-blue-400' : ''} ${sevBadge(key)} border-transparent`}>
              {sevIcon(key)}{label}: {count}
            </button>
          );
        })}
      </div>

      {/* Log table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading && <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-300" /></div>}
        {!loading && filtered.length === 0 && <div className="py-14 text-center text-gray-400 text-sm">رخدادی یافت نشد</div>}
        <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[65vh] overflow-y-auto">
          {filtered.map(log => (
            <div key={log.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <div className="mt-0.5 flex-shrink-0">{sevIcon(log.severity)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm font-medium text-gray-800 dark:text-white">{log.action}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{new Date(log.created_at).toLocaleString('fa-IR')}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {log.user_name && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <Zap className="w-3 h-3" />{log.user_name}
                    </span>
                  )}
                  {log.module && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sevBadge(log.severity)}`}>{log.module}</span>
                  )}
                  {log.ip_address && <span className="text-xs text-gray-400 font-mono">{log.ip_address}</span>}
                  {log.details && <span className="text-xs text-gray-400 truncate max-w-xs">{log.details}</span>}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${sevBadge(log.severity)}`}>
                {sevLabel[log.severity] || log.severity}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main UserGroupsPanel ─────────────────────────────────────────────────────
interface Props { currentUserId: string; }

export function UserGroupsPanel({}: Props) {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [panel, setPanel] = useState<Panel>('list');
  const [selected, setSelected] = useState<UserGroup | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('user_groups').select('*').order('name');
    if (!data) return;
    const withCounts = await Promise.all(data.map(async g => {
      const { count } = await supabase.from('user_group_members').select('id', { count: 'exact', head: true }).eq('group_id', g.id);
      return { ...g, permissions: (g.permissions || {}) as Record<string, boolean>, member_count: count ?? 0 };
    }));
    setGroups(withCounts);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const openPanel = (p: Panel, group: UserGroup) => {
    setSelected(group);
    setPanel(p);
    setMenuOpen(null);
  };

  const goBack = () => { setPanel('list'); setSelected(null); };
  const doneAndBack = () => { load(); goBack(); };

  const filtered = groups.filter(g =>
    !search || (g.display_name || '').includes(search) || g.name.includes(search) || (g.description || '').includes(search)
  );

  const menuItems = (g: UserGroup) => [
    { icon: Edit2, label: 'ویرایش گروه', panel: 'edit' as Panel, color: 'text-blue-500' },
    { icon: Users, label: 'مدیریت اعضا', panel: 'members' as Panel, color: 'text-teal-500' },
    { icon: ShieldCheck, label: 'حقوق دسترسی', panel: 'access' as Panel, color: 'text-green-500' },
    { icon: Trash2, label: 'حذف گروه', panel: 'delete' as Panel, color: g.is_system ? 'text-gray-300' : 'text-red-500' },
  ];

  // ── non-list panels ────────────────────────────────────────────────────────
  if (panel === 'add') return <GroupForm group={null} onBack={goBack} onDone={doneAndBack} />;
  if (panel === 'edit' && selected) return <GroupForm group={selected} onBack={goBack} onDone={doneAndBack} />;
  if (panel === 'delete' && selected) return <DeletePanel group={selected} onBack={goBack} onDone={doneAndBack} />;
  if (panel === 'members' && selected) return <MembersPanel group={selected} onBack={goBack} />;
  if (panel === 'access' && selected) return <AccessPanel group={selected} onBack={goBack} />;

  // ── List ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <GroupIcon className="w-5 h-5 text-blue-500" />گروه‌های کاربری
          <span className="text-sm font-normal text-gray-400">({groups.length})</span>
        </h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو..."
              className="pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-40" />
          </div>
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setPanel('add')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />گروه جدید
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-right">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">گروه</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">اعضا</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">سیستمی</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">عمومی</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(g => (
                <tr key={g.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center flex-shrink-0">
                        <GroupIcon className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <div className="font-medium text-gray-800 dark:text-white">{g.display_name || g.name}</div>
                        <div className="text-xs text-gray-400 font-mono">{g.name}</div>
                        {g.description && <div className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{g.description}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 font-semibold text-sm">
                      <Users className="w-3.5 h-3.5" />{g.member_count}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {g.is_system
                      ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/30"><Check className="w-3 h-3 text-amber-600 dark:text-amber-400" /></span>
                      : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700"><X className="w-3 h-3 text-gray-400" /></span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {g.is_public
                      ? <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-900/30"><Check className="w-3 h-3 text-green-600 dark:text-green-400" /></span>
                      : <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 dark:bg-gray-700"><X className="w-3 h-3 text-gray-400" /></span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="relative inline-block" ref={menuOpen === g.id ? menuRef : undefined}>
                      <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === g.id ? null : g.id); }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {menuOpen === g.id && (
                        <div
                          className="absolute left-0 top-full mt-1 w-48 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1"
                          onClick={e => e.stopPropagation()}>
                          {menuItems(g).map(({ icon: Icon, label, panel: target, color }) => (
                            <button key={target} onClick={() => openPanel(target, g)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-right">
                              <Icon className={`w-4 h-4 flex-shrink-0 ${color}`} />
                              <span className="text-sm text-gray-700 dark:text-gray-200">{label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="text-center py-14 text-gray-400">گروهی یافت نشد</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
