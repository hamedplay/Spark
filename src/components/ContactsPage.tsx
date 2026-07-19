import React, { useState, useEffect, useRef } from 'react';
import { Mail, CreditCard as Edit2, Save, X, Plus, Loader as Loader2, Search, Phone, Upload, Download, Trash2, Users, Building2, Share2, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import { usePermissions } from '../context/PermissionsContext';

interface Contact {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  user_id: string;
  created_at: string;
}

interface UserProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
}

type AddMode = 'single' | 'bulk';

// ── Share contact modal ───────────────────────────────────────────────────────
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
    supabase.from('profiles_public').select('user_id, full_name, email')
      .neq('user_id', currentUserId)
      .then(({ data }) => setUsers(data || []));
  }, [currentUserId]);

  const filtered = users.filter(u => {
    const q = search.toLowerCase();
    return (u.full_name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q));
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
      toast.success(`مخاطب به ${u.full_name || u.email} ارسال شد`);
    } catch (err: any) {
      toast.error(err?.message || 'خطا در ارسال مخاطب');
    } finally {
      setSending(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="font-bold dark:text-white flex items-center gap-2">
              <Share2 className="w-5 h-5 text-blue-500" /> ارسال مخاطب
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">«{contact.name}»</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">
          <div className="relative mb-4">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="جستجوی همکار..."
              autoFocus
              className="w-full pr-9 pl-3 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {filtered.length === 0 ? (
              <p className="text-center text-gray-400 text-sm py-6">کاربری یافت نشد</p>
            ) : filtered.map(u => (
              <div key={u.user_id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-xl">
                <div className="w-9 h-9 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold flex-shrink-0">
                  {(u.full_name || u.email || '?')[0].toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-white truncate">{u.full_name || '—'}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{u.email}</p>
                </div>
                {sent.has(u.user_id) ? (
                  <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium whitespace-nowrap">
                    <Check className="w-3.5 h-3.5" /> ارسال شد
                  </span>
                ) : (
                  <button
                    onClick={() => shareToUser(u)}
                    disabled={sending === u.user_id}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
                  >
                    {sending === u.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Share2 className="w-3.5 h-3.5" />}
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

// ── Main page ─────────────────────────────────────────────────────────────────
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
  const [newContact, setNewContact] = useState({ name: '', email: '', phone: '', company: '' });
  const [bulkText, setBulkText] = useState('');
  const [shareContact, setShareContact] = useState<Contact | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (propUserId) {
      fetchContacts();
    } else {
      const init = async () => {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) { setUserId(user.id); fetchContacts(); }
      };
      init();
    }
  }, []);

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase.from('contacts_email').select('*').order('name');
      if (error) throw error;
      setContacts(data || []);
    } catch { toast.error('خطا در دریافت مخاطبین'); }
    finally { setLoading(false); }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !newContact.name.trim()) { toast.error('نام الزامی است'); return; }
    try {
      const { error } = await supabase.from('contacts_email').insert([{ ...newContact, user_id: userId }]);
      if (error) throw error;
      toast.success('مخاطب اضافه شد');
      setNewContact({ name: '', email: '', phone: '', company: '' });
      setShowAddPanel(false);
      fetchContacts();
    } catch { toast.error('خطا در افزودن مخاطب'); }
  };

  const handleBulkAdd = async () => {
    if (!userId || !bulkText.trim()) return;
    const lines = bulkText.split('\n').filter(l => l.trim());
    const items: { name: string; email: string; phone: string; user_id: string }[] = [];
    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts[0]) items.push({ name: parts[0], email: parts[1] || '', phone: parts[2] || '', user_id: userId });
    }
    if (items.length === 0) { toast.error('فرمت نادرست'); return; }
    try {
      const { error } = await supabase.from('contacts_email').insert(items);
      if (error) throw error;
      toast.success(`${items.length} مخاطب اضافه شد`);
      setBulkText('');
      setShowAddPanel(false);
      fetchContacts();
    } catch { toast.error('خطا در افزودن مخاطبین'); }
  };

  const handleUpdate = async () => {
    if (!editingContact) return;
    try {
      const { error } = await supabase.from('contacts_email').update({
        name: editingContact.name,
        email: editingContact.email,
        phone: editingContact.phone,
        company: editingContact.company,
      }).eq('id', editingContact.id);
      if (error) throw error;
      toast.success('ذخیره شد');
      setEditingId(null); setEditingContact(null);
      fetchContacts();
    } catch { toast.error('خطا در ذخیره'); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('آیا از حذف این مخاطب اطمینان دارید؟')) return;
    try {
      const { error } = await supabase.from('contacts_email').delete().eq('id', id);
      if (error) throw error;
      toast.success('حذف شد');
      fetchContacts();
    } catch { toast.error('خطا در حذف'); }
  };

  const handleExport = () => {
    const header = 'نام,ایمیل,موبایل,سازمان\n';
    const rows = contacts.map(c => `${c.name},${c.email || ''},${c.phone || ''},${c.company || ''}`).join('\n');
    const blob = new Blob(['\uFEFF' + header + rows], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'contacts.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !userId) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split('\n').slice(1).filter(l => l.trim());
      const items: { name: string; email: string; phone: string; user_id: string }[] = [];
      for (const line of lines) {
        const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
        if (parts[0]) items.push({ name: parts[0], email: parts[1] || '', phone: parts[2] || '', user_id: userId });
      }
      if (items.length === 0) { toast.error('فایل خالی است'); return; }
      try {
        const { error } = await supabase.from('contacts_email').insert(items);
        if (error) throw error;
        toast.success(`${items.length} مخاطب وارد شد`);
        fetchContacts();
      } catch { toast.error('خطا در وارد کردن'); }
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const filtered = contacts.filter(c =>
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (c.phone || '').includes(searchTerm) ||
    (c.company || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!userId) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>;
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold dark:text-white">مخاطبین</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{contacts.length} مخاطب</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input ref={importRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleImport} />
          <button onClick={() => importRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors dark:text-white">
            <Upload className="w-4 h-4" /> وارد کردن
          </button>
          <button onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors dark:text-white">
            <Download className="w-4 h-4" /> خروجی CSV
          </button>
          {canCreate && (
            <button onClick={() => setShowAddPanel(!showAddPanel)}
              className="flex items-center gap-1.5 px-4 py-2 text-sm bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
              <Plus className="w-4 h-4" /> مخاطب جدید
            </button>
          )}
        </div>
      </div>

      {/* Add Panel */}
      {showAddPanel && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-4">
            {(['single', 'bulk'] as AddMode[]).map(m => (
              <button key={m} onClick={() => setAddMode(m)}
                className={`px-4 py-1.5 text-sm rounded-lg transition-colors ${addMode === m ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {m === 'single' ? 'تک مخاطب' : 'گروهی'}
              </button>
            ))}
          </div>

          {addMode === 'single' ? (
            <form onSubmit={handleAdd} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input required value={newContact.name} onChange={e => setNewContact(p => ({ ...p, name: e.target.value }))} placeholder="نام و نام خانوادگی *"
                  className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                <input type="tel" value={newContact.phone} onChange={e => setNewContact(p => ({ ...p, phone: e.target.value }))} placeholder="شماره موبایل"
                  className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                <input type="email" value={newContact.email} onChange={e => setNewContact(p => ({ ...p, email: e.target.value }))} placeholder="ایمیل (اختیاری)"
                  className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                <input value={newContact.company} onChange={e => setNewContact(p => ({ ...p, company: e.target.value }))} placeholder="سازمان / شرکت (اختیاری)"
                  className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
              </div>
              <div className="flex gap-2">
                <button type="submit" className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600 transition-colors">
                  <Plus className="w-4 h-4" /> افزودن
                </button>
                <button type="button" onClick={() => setShowAddPanel(false)} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                  انصراف
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">هر خط: نام، ایمیل، موبایل (جدا با کاما)</p>
              <textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={5}
                placeholder={'علی رضایی, ali@example.com, 09121234567\nزهرا احمدی, zahra@example.com, 09130000000'}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm resize-none font-mono" />
              <div className="flex gap-2">
                <button onClick={handleBulkAdd} className="flex items-center gap-1.5 px-4 py-2 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600 transition-colors">
                  <Users className="w-4 h-4" /> افزودن گروهی
                </button>
                <button onClick={() => setShowAddPanel(false)} className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                  انصراف
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Search */}
      <div className="relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="جستجو بر اساس نام، ایمیل یا موبایل..."
          className="w-full pr-9 pl-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
          <p>مخاطبی یافت نشد</p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filtered.map(contact => (
          <div key={contact.id} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 p-4 hover:shadow-md transition-shadow">
            {editingId === contact.id ? (
              <div className="space-y-2">
                <input value={editingContact?.name || ''} onChange={e => setEditingContact(p => p ? { ...p, name: e.target.value } : null)} placeholder="نام"
                  className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                <input value={editingContact?.phone || ''} onChange={e => setEditingContact(p => p ? { ...p, phone: e.target.value } : null)} placeholder="موبایل"
                  className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                <input type="email" value={editingContact?.email || ''} onChange={e => setEditingContact(p => p ? { ...p, email: e.target.value } : null)} placeholder="ایمیل"
                  className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                <input value={editingContact?.company || ''} onChange={e => setEditingContact(p => p ? { ...p, company: e.target.value } : null)} placeholder="سازمان / شرکت"
                  className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                <div className="flex gap-2 pt-1">
                  <button onClick={handleUpdate} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-green-500 text-white rounded-lg text-sm hover:bg-green-600">
                    <Save className="w-3.5 h-3.5" /> ذخیره
                  </button>
                  <button onClick={() => { setEditingId(null); setEditingContact(null); }} className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-sm">
                    <X className="w-3.5 h-3.5" /> انصراف
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold dark:text-white">{contact.name}</h3>
                    {contact.company && (
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex items-center gap-1 mt-0.5">
                        <Building2 className="w-3 h-3" />{contact.company}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => setShareContact(contact)}
                      title="ارسال به همکار"
                      className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                      <Share2 className="w-4 h-4" />
                    </button>
                    {canEdit && (
                      <button onClick={() => { setEditingId(contact.id); setEditingContact(contact); }}
                        className="p-1.5 text-gray-400 hover:text-blue-500 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    )}
                    {canDelete && (
                      <button onClick={() => handleDelete(contact.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  {contact.phone && (
                    <a href={`tel:${contact.phone}`} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">
                      <Phone className="w-4 h-4 flex-shrink-0 text-gray-400" />
                      <span>{contact.phone}</span>
                    </a>
                  )}
                  {contact.email && (
                    <a href={`mailto:${contact.email}`} className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 hover:text-blue-500 dark:hover:text-blue-400 transition-colors">
                      <Mail className="w-4 h-4 flex-shrink-0 text-gray-400" />
                      <span className="truncate">{contact.email}</span>
                    </a>
                  )}
                  {!contact.phone && !contact.email && (
                    <p className="text-xs text-gray-400">اطلاعات تماس ثبت نشده</p>
                  )}
                </div>
                <p className="text-[10px] text-gray-300 dark:text-gray-600 mt-3">
                  {new Date(contact.created_at || '').toLocaleDateString('fa-IR')}
                </p>
              </>
            )}
          </div>
        ))}
      </div>

      {shareContact && userId && (
        <ShareContactModal
          contact={shareContact}
          currentUserId={userId}
          onClose={() => setShareContact(null)}
        />
      )}
    </div>
  );
}
