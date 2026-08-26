import React, { useEffect, useRef, useState } from 'react';
import {
  CreditCard as Edit2,
  Save,
  X,
  Plus,
  Loader as Loader2,
  Search,
  Phone,
  Upload,
  Download,
  Trash2,
  Users,
  Building2,
  Briefcase,
  Share2,
  Check,
  Sparkles,
  ContactRound,
  Smartphone,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { usePermissions } from '../context/PermissionsContext';
import { ContactFormFields } from './Contacts/ContactFormFields';

interface Contact {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  position: string | null;
  user_id: string;
  created_at: string;
}

interface UserProfile {
  user_id: string;
  full_name: string | null;
}

type AddMode = 'single' | 'bulk';

function ShareContactModal({ contact, currentUserId, onClose }: {
  contact: Contact;
  currentUserId: string;
  onClose: () => void;
}) {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [search, setSearch] = useState('');
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Set<string>>(new Set());

  useEffect(() => {
    supabase.rpc('get_selectable_users')
      .then(({ data }) => setUsers((data || []).filter((u: UserProfile) => u.user_id !== currentUserId)));
  }, [currentUserId]);

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return u.full_name?.toLowerCase().includes(q);
  });

  const shareToUser = async (u: UserProfile) => {
    setSending(u.user_id);
    try {
      const { error: fnError } = await supabase.rpc('share_contact_to_user', {
        p_name: contact.name,
        p_email: contact.email || '',
        p_phone: contact.phone || '',
        p_company: contact.company || '',
        p_target_user_id: u.user_id,
      });
      if (fnError) throw fnError;

      await supabase.rpc('create_notification', {
        p_user_id: u.user_id,
        p_title: 'مخاطب جدید دریافت شد',
        p_message: `مخاطب «${contact.name}» از طرف یک همکار برای شما ارسال شد.`,
        p_type: 'info',
      });

      setSent(prev => new Set([...prev, u.user_id]));
      toast.success(`مخاطب به ${u.full_name || 'همکار'} ارسال شد`);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ارسال مخاطب');
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm" dir="rtl">
      <div className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)] dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-slate-800">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-cyan-600 dark:bg-cyan-500/10 dark:text-cyan-300">
              <Share2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white">ارسال مخاطب</h2>
              <p className="mt-0.5 truncate text-[10px] text-slate-400">«{contact.name}»</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
            aria-label="بستن"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-3.5">
          <div className="relative mb-3">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="جستجوی همکار..."
              autoFocus
              className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-9 text-xs text-slate-800 outline-none transition focus:border-cyan-300 focus:ring-2 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
            />
          </div>

          <div className="max-h-72 space-y-1.5 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                <Users className="mb-2 h-7 w-7 opacity-40" />
                <p className="text-xs">کاربری یافت نشد</p>
              </div>
            ) : filtered.map(u => (
              <div key={u.user_id} className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 dark:border-slate-800 dark:bg-slate-800/45">
                <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 text-xs font-bold text-white">
                  {(u.full_name || '?')[0].toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-bold text-slate-800 dark:text-white">{u.full_name || '—'}</p>
                </div>
                {sent.has(u.user_id) ? (
                  <span className="flex items-center gap-1 whitespace-nowrap text-[10px] font-bold text-emerald-600 dark:text-emerald-300">
                    <Check className="h-3.5 w-3.5" /> ارسال شد
                  </span>
                ) : (
                  <button
                    onClick={() => shareToUser(u)}
                    disabled={sending === u.user_id}
                    className="flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg bg-cyan-600 px-2.5 text-[10px] font-bold text-white transition hover:bg-cyan-500 disabled:opacity-50"
                  >
                    {sending === u.user_id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Share2 className="h-3.5 w-3.5" />}
                    ارسال
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ContactsPage({ currentUserId: propUserId }: { currentUserId?: string | null }) {
  const { hasPermission } = usePermissions();
  const canCreate = hasPermission('contacts_create');
  const canEdit = hasPermission('contacts_edit');
  const canDelete = hasPermission('contacts_delete');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [userId, setUserId] = useState<string | null>(propUserId ?? null);
  const [showAddPanel, setShowAddPanel] = useState(false);
  const [addMode, setAddMode] = useState<AddMode>('single');
  const [newContact, setNewContact] = useState({ name: '', phone: '', company: '', position: '' });
  const [bulkText, setBulkText] = useState('');
  const [shareContact, setShareContact] = useState<Contact | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (propUserId) {
      fetchContacts();
    } else {
      const init = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          setUserId(user.id);
          fetchContacts();
        }
      };
      init();
    }
  }, []);

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase.from('contacts_email').select('*').order('name');
      if (error) throw error;
      setContacts(data || []);
    } catch {
      toast.error('خطا در دریافت مخاطبین');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !newContact.name.trim()) {
      toast.error('نام الزامی است');
      return;
    }
    try {
      const { error } = await supabase.from('contacts_email').insert([{
        name: newContact.name.trim(),
        phone: newContact.phone.trim() || null,
        company: newContact.company.trim() || null,
        position: newContact.position.trim() || null,
        user_id: userId,
      }]);
      if (error) throw error;
      toast.success('مخاطب اضافه شد');
      setNewContact({ name: '', phone: '', company: '', position: '' });
      setShowAddPanel(false);
      fetchContacts();
    } catch {
      toast.error('خطا در افزودن مخاطب');
    }
  };

  const handleBulkAdd = async () => {
    if (!userId || !bulkText.trim()) return;
    const lines = bulkText.split('\n').filter(l => l.trim());
    const items: { name: string; phone: string | null; company: string | null; position: string | null; user_id: string }[] = [];
    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts[0]) {
        items.push({
          name: parts[0],
          phone: parts[1] || null,
          company: parts[2] || null,
          position: parts[3] || null,
          user_id: userId,
        });
      }
    }
    if (items.length === 0) {
      toast.error('فرمت نادرست');
      return;
    }
    try {
      const { error } = await supabase.from('contacts_email').insert(items);
      if (error) throw error;
      toast.success(`${items.length} مخاطب اضافه شد`);
      setBulkText('');
      setShowAddPanel(false);
      fetchContacts();
    } catch {
      toast.error('خطا در افزودن مخاطبین');
    }
  };

  const handleUpdate = async () => {
    if (!editingContact) return;
    try {
      const { error } = await supabase.from('contacts_email').update({
        name: editingContact.name,
        phone: editingContact.phone,
        company: editingContact.company,
        position: editingContact.position,
      }).eq('id', editingContact.id);
      if (error) throw error;
      toast.success('ذخیره شد');
      setEditingId(null);
      setEditingContact(null);
      fetchContacts();
    } catch {
      toast.error('خطا در ذخیره');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('آیا از حذف این مخاطب اطمینان دارید؟')) return;
    try {
      const { error } = await supabase.from('contacts_email').delete().eq('id', id);
      if (error) throw error;
      toast.success('حذف شد');
      fetchContacts();
    } catch {
      toast.error('خطا در حذف');
    }
  };

  const handleExport = () => {
    const header = 'نام,موبایل,سازمان,سمت\n';
    const rows = contacts.map(c => `${c.name},${c.phone || ''},${c.company || ''},${c.position || ''}`).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'contacts.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').slice(1).filter(l => l.trim());
      const items: { name: string; phone: string | null; company: string | null; position: string | null; user_id: string }[] = [];
      for (const line of lines) {
        const parts = line.split(',').map(p => p.trim().replace(/^\"|\"$/g, ''));
        if (parts[0]) {
          items.push({
            name: parts[0],
            phone: parts[1] || null,
            company: parts[2] || null,
            position: parts[3] || null,
            user_id: userId,
          });
        }
      }
      if (items.length === 0) {
        toast.error('فایل خالی است');
        return;
      }
      try {
        const { error } = await supabase.from('contacts_email').insert(items);
        if (error) throw error;
        toast.success(`${items.length} مخاطب وارد شد`);
        fetchContacts();
      } catch {
        toast.error('خطا در وارد کردن');
      }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phone || '').includes(searchTerm) ||
    (c.company || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.position || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const contactsWithPhone = contacts.filter(c => Boolean(c.phone?.trim())).length;
  const companiesCount = new Set(
    contacts.map(c => c.company?.trim()).filter((company): company is string => Boolean(company))
  ).size;

  if (!userId) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <>
      <div
        className="relative overflow-hidden rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50/75 to-indigo-50/45 p-3 antialiased shadow-[0_18px_50px_rgba(15,23,42,0.06)] dark:border-slate-800 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/15 sm:p-4"
        dir="rtl"
      >
        <div className="pointer-events-none absolute -left-24 -top-28 h-64 w-64 rounded-full bg-violet-300/10 blur-3xl dark:bg-violet-600/10" />
        <div className="pointer-events-none absolute -right-20 top-32 h-56 w-56 rounded-full bg-cyan-200/15 blur-3xl dark:bg-cyan-500/10" />

        <div className="relative z-10">
          <header className="mb-3 flex flex-col justify-between gap-2.5 lg:flex-row lg:items-center">
            <div>
              <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-white/85 px-2.5 py-1 text-[10px] font-bold text-indigo-700 shadow-sm dark:border-indigo-500/25 dark:bg-indigo-500/10 dark:text-indigo-300">
                  <Sparkles className="h-3.5 w-3.5" /> دفترچه مخاطبین
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/75 px-2.5 py-1 text-[9px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
                  <ContactRound className="h-3 w-3" /> {contacts.length.toLocaleString('fa-IR')} مخاطب
                </span>
              </div>
              <h1 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">مخاطبین</h1>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400 sm:text-xs">مدیریت، اشتراک و نگهداری اطلاعات تماس همکاران و مخاطبین</p>
            </div>

            <div className="flex flex-wrap items-center gap-2 self-start lg:self-auto">
              <input ref={importRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImport} />
              <button
                onClick={() => importRef.current?.click()}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-cyan-200 bg-cyan-50 px-3 text-[10px] font-bold text-cyan-700 transition hover:bg-cyan-100 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300 dark:hover:bg-cyan-500/15 sm:text-xs"
              >
                <Upload className="h-4 w-4" /> وارد کردن
              </button>
              <button
                onClick={handleExport}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3 text-[10px] font-bold text-emerald-700 transition hover:bg-emerald-100 dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300 dark:hover:bg-emerald-500/15 sm:text-xs"
              >
                <Download className="h-4 w-4" /> خروجی CSV
              </button>
              {canCreate && (
                <button
                  onClick={() => setShowAddPanel(v => !v)}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-gradient-to-l from-violet-600 to-indigo-600 px-3.5 text-[10px] font-bold text-white shadow-[0_7px_20px_rgba(79,70,229,0.18)] transition hover:from-violet-500 hover:to-indigo-500 sm:text-xs"
                >
                  <Plus className="h-4 w-4" /> {showAddPanel ? 'بستن فرم' : 'مخاطب جدید'}
                </button>
              )}
            </div>
          </header>

          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <div className="rounded-xl border border-violet-100 bg-white/85 px-3 py-2.5 shadow-[0_7px_20px_rgba(15,23,42,0.035)] dark:border-violet-500/20 dark:bg-violet-500/5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">کل مخاطبین</span>
                <Users className="h-3.5 w-3.5 text-violet-500 dark:text-violet-300" />
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{contacts.length.toLocaleString('fa-IR')}</p>
            </div>
            <div className="rounded-xl border border-cyan-100 bg-white/85 px-3 py-2.5 shadow-[0_7px_20px_rgba(15,23,42,0.035)] dark:border-cyan-500/20 dark:bg-cyan-500/5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">دارای شماره</span>
                <Smartphone className="h-3.5 w-3.5 text-cyan-500 dark:text-cyan-300" />
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{contactsWithPhone.toLocaleString('fa-IR')}</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-white/85 px-3 py-2.5 shadow-[0_7px_20px_rgba(15,23,42,0.035)] dark:border-amber-500/20 dark:bg-amber-500/5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">سازمان‌ها</span>
                <Building2 className="h-3.5 w-3.5 text-amber-500 dark:text-amber-300" />
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{companiesCount.toLocaleString('fa-IR')}</p>
            </div>
            <div className="rounded-xl border border-blue-100 bg-white/85 px-3 py-2.5 shadow-[0_7px_20px_rgba(15,23,42,0.035)] dark:border-blue-500/20 dark:bg-blue-500/5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10px] text-slate-500 dark:text-slate-400">نتیجه فعلی</span>
                <Search className="h-3.5 w-3.5 text-blue-500 dark:text-blue-300" />
              </div>
              <p className="mt-1 text-lg font-bold text-slate-900 dark:text-white">{filtered.length.toLocaleString('fa-IR')}</p>
            </div>
          </div>

          {showAddPanel && (
            <section className="mb-3 rounded-xl border border-violet-100 bg-white/90 p-3 shadow-[0_10px_28px_rgba(15,23,42,0.045)] dark:border-violet-500/20 dark:bg-slate-900/80 sm:p-3.5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
                    <Plus className="h-4 w-4" />
                  </span>
                  <div>
                    <h2 className="text-xs font-bold text-slate-800 dark:text-white sm:text-sm">افزودن مخاطب</h2>
                    <p className="mt-0.5 text-[9px] text-slate-400">ثبت تکی یا ورود سریع چند مخاطب</p>
                  </div>
                </div>
                <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                  {(['single', 'bulk'] as AddMode[]).map(mode => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setAddMode(mode)}
                      className={`rounded-md px-3 py-1.5 text-[10px] font-bold transition ${addMode === mode ? 'bg-white text-violet-700 shadow-sm dark:bg-slate-700 dark:text-violet-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                    >
                      {mode === 'single' ? 'تک مخاطب' : 'گروهی'}
                    </button>
                  ))}
                </div>
              </div>

              {addMode === 'single' ? (
                <form onSubmit={handleAdd} className="space-y-3">
                  <ContactFormFields
                    name={newContact.name}
                    phone={newContact.phone}
                    company={newContact.company}
                    position={newContact.position}
                    onNameChange={value => setNewContact(p => ({ ...p, name: value }))}
                    onPhoneChange={value => setNewContact(p => ({ ...p, phone: value }))}
                    onCompanyChange={value => setNewContact(p => ({ ...p, company: value }))}
                    onPositionChange={value => setNewContact(p => ({ ...p, position: value }))}
                  />
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-l from-violet-600 to-indigo-600 px-4 text-xs font-bold text-white transition hover:from-violet-500 hover:to-indigo-500">
                      <Plus className="h-4 w-4" /> افزودن
                    </button>
                    <button type="button" onClick={() => setShowAddPanel(false)} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      انصراف
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-3">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">هر خط: نام، موبایل، سازمان، سمت — جداشده با کاما</p>
                  <textarea
                    value={bulkText}
                    onChange={e => setBulkText(e.target.value)}
                    rows={4}
                    placeholder={'علی رضایی, 09121234567, شرکت نمونه, مدیر\nزهرا احمدی, 09130000000, سازمان X, کارشناس'}
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button onClick={handleBulkAdd} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-gradient-to-l from-violet-600 to-indigo-600 px-4 text-xs font-bold text-white transition hover:from-violet-500 hover:to-indigo-500">
                      <Users className="h-4 w-4" /> افزودن گروهی
                    </button>
                    <button onClick={() => setShowAddPanel(false)} className="inline-flex h-9 items-center rounded-lg border border-slate-200 bg-white px-4 text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      انصراف
                    </button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section className="mb-3 rounded-xl border border-slate-200/80 bg-white/85 p-2.5 shadow-[0_8px_24px_rgba(15,23,42,0.035)] backdrop-blur-sm dark:border-slate-800 dark:bg-slate-900/70">
            <div className="relative">
              <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                placeholder="جستجو بر اساس نام، موبایل، سازمان یا سمت..."
                className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-4 pr-10 text-xs text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
              />
            </div>
          </section>

          <div className="mb-2.5 flex items-end justify-between gap-3">
            <div>
              <h2 className="text-xs font-bold text-slate-800 dark:text-slate-100 sm:text-sm">فهرست مخاطبین</h2>
              <p className="mt-0.5 text-[9px] text-slate-400 dark:text-slate-500 sm:text-[10px]">اطلاعات تماس و اقدامات هر مخاطب در یک نگاه</p>
            </div>
            <span className="rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[9px] text-slate-500 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400">
              {filtered.length.toLocaleString('fa-IR')} مورد
            </span>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-white/60 py-12 text-slate-400 dark:border-slate-800 dark:bg-slate-900/40">
              <Users className="mb-2 h-9 w-9 opacity-35" />
              <p className="text-xs font-bold">مخاطبی یافت نشد</p>
              <p className="mt-1 text-[10px]">عبارت جستجو را تغییر دهید یا مخاطب جدید ثبت کنید.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map(contact => (
                <article
                  key={contact.id}
                  className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white/90 p-3 shadow-[0_6px_20px_rgba(15,23,42,0.04)] transition hover:border-slate-300 hover:shadow-[0_10px_28px_rgba(15,23,42,0.065)] dark:border-slate-800 dark:bg-slate-900/80 dark:hover:border-slate-700 sm:p-3.5"
                >
                  {editingId === contact.id ? (
                    <div className="space-y-2">
                      <input
                        value={editingContact?.name || ''}
                        onChange={e => setEditingContact(p => p ? { ...p, name: e.target.value } : null)}
                        placeholder="نام"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 md:grid-cols-1 lg:grid-cols-2">
                        <input
                          value={editingContact?.phone || ''}
                          onChange={e => setEditingContact(p => p ? { ...p, phone: e.target.value } : null)}
                          placeholder="موبایل"
                          dir="ltr"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs text-slate-800 outline-none focus:border-cyan-300 focus:ring-2 focus:ring-cyan-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                        <input
                          value={editingContact?.position || ''}
                          onChange={e => setEditingContact(p => p ? { ...p, position: e.target.value } : null)}
                          placeholder="سمت سازمانی"
                          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                        />
                      </div>
                      <input
                        value={editingContact?.company || ''}
                        onChange={e => setEditingContact(p => p ? { ...p, company: e.target.value } : null)}
                        placeholder="سازمان / شرکت"
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white"
                      />
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <button onClick={handleUpdate} className="flex h-9 items-center justify-center gap-1.5 rounded-lg bg-gradient-to-l from-violet-600 to-indigo-600 text-xs font-bold text-white transition hover:from-violet-500 hover:to-indigo-500">
                          <Save className="h-3.5 w-3.5" /> ذخیره
                        </button>
                        <button onClick={() => { setEditingId(null); setEditingContact(null); }} className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          <X className="h-3.5 w-3.5" /> انصراف
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="mb-2.5 flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 text-sm font-bold text-white shadow-[0_6px_18px_rgba(79,70,229,0.16)]">
                            {(contact.name || '?').trim().charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-bold text-slate-800 dark:text-white">{contact.name}</h3>
                            {contact.position && (
                              <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                                <Briefcase className="h-3 w-3 flex-shrink-0 text-amber-500" />
                                <span className="truncate">{contact.position}</span>
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-shrink-0 items-center gap-1">
                          <button
                            onClick={() => setShareContact(contact)}
                            title="ارسال به همکار"
                            aria-label="ارسال به همکار"
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-200 bg-cyan-50 text-cyan-600 transition hover:bg-cyan-100 dark:border-cyan-500/25 dark:bg-cyan-500/10 dark:text-cyan-300"
                          >
                            <Share2 className="h-3.5 w-3.5" />
                          </button>
                          {canEdit && (
                            <button
                              onClick={() => { setEditingId(contact.id); setEditingContact(contact); }}
                              title="ویرایش"
                              aria-label="ویرایش"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-blue-200 bg-blue-50 text-blue-600 transition hover:bg-blue-100 dark:border-blue-500/25 dark:bg-blue-500/10 dark:text-blue-300"
                            >
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              onClick={() => handleDelete(contact.id)}
                              title="حذف"
                              aria-label="حذف"
                              className="flex h-8 w-8 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-600 transition hover:bg-rose-100 dark:border-rose-500/25 dark:bg-rose-500/10 dark:text-rose-300"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="rounded-xl border border-slate-100 bg-slate-50/75 px-2.5 py-2 dark:border-slate-800 dark:bg-slate-800/45">
                        {contact.company && (
                          <div className="mb-1.5 flex min-w-0 items-center gap-1.5 text-[10px] text-slate-500 dark:text-slate-400">
                            <Building2 className="h-3.5 w-3.5 flex-shrink-0 text-violet-500" />
                            <span className="truncate">{contact.company}</span>
                          </div>
                        )}
                        {contact.phone ? (
                          <a
                            href={`tel:${contact.phone}`}
                            className="flex min-w-0 items-center gap-1.5 text-xs font-bold text-slate-700 transition hover:text-cyan-600 dark:text-slate-300 dark:hover:text-cyan-300"
                          >
                            <Phone className="h-3.5 w-3.5 flex-shrink-0 text-cyan-500" />
                            <span className="truncate" dir="ltr">{contact.phone}</span>
                          </a>
                        ) : (
                          <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                            <Phone className="h-3.5 w-3.5" /> اطلاعات تماس ثبت نشده
                          </div>
                        )}
                      </div>

                      <div className="mt-2 flex items-center justify-between border-t border-slate-100 pt-2 text-[9px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
                        <span>ثبت مخاطب</span>
                        <span>{new Date(contact.created_at || '').toLocaleDateString('fa-IR')}</span>
                      </div>
                    </>
                  )}
                </article>
              ))}
            </div>
          )}
        </div>
      </div>

      {shareContact && userId && (
        <ShareContactModal
          contact={shareContact}
          currentUserId={userId}
          onClose={() => setShareContact(null)}
        />
      )}
    </>
  );
}
