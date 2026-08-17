import React, { useState, useEffect } from 'react';
import { Mail, CreditCard as Edit2, Save, X, Plus, Loader2, Search, Trash2, Users, AtSign } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ContactEmail } from '../types';
import toast from 'react-hot-toast';

export function ContactsEmailPage({ currentUserId: propUserId }: { currentUserId?: string | null }) {
  const [contacts, setContacts] = useState<ContactEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [newContact, setNewContact] = useState({ name: '', email: '' });
  const [editingContact, setEditingContact] = useState<ContactEmail | null>(null);
  const [userId, setUserId] = useState<string | null>(propUserId ?? null);

  useEffect(() => {
    if (!propUserId) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
    }
  }, [propUserId]);

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase
        .from('contacts_email')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setContacts(data || []);
    } catch {
      toast.error('خطا در دریافت لیست مخاطبین');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchContacts(); }, []);

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) { toast.error('لطفا ابتدا وارد حساب کاربری خود شوید'); return; }
    if (!newContact.email.includes('@')) { toast.error('لطفاً یک ایمیل معتبر وارد کنید'); return; }

    setLoading(true);
    try {
      const { error } = await supabase.from('contacts_email').insert([{ ...newContact, user_id: userId }]);
      if (error) throw error;
      toast.success('مخاطب جدید با موفقیت اضافه شد');
      setShowCreateForm(false);
      setNewContact({ name: '', email: '' });
      void fetchContacts();
    } catch (error) {
      console.error('Error creating contact:', error);
      toast.error('خطا در ایجاد مخاطب جدید');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateContact = async (contactId: string, updatedData: Partial<ContactEmail>) => {
    try {
      const { error } = await supabase.from('contacts_email').update(updatedData).eq('id', contactId);
      if (error) throw error;
      toast.success('مخاطب با موفقیت به‌روزرسانی شد');
      setEditingContactId(null);
      setEditingContact(null);
      void fetchContacts();
    } catch {
      toast.error('خطا در به‌روزرسانی مخاطب');
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!confirm('آیا از حذف این مخاطب اطمینان دارید؟')) return;
    try {
      const { error } = await supabase.from('contacts_email').delete().eq('id', contactId);
      if (error) throw error;
      toast.success('مخاطب با موفقیت حذف شد');
      void fetchContacts();
    } catch {
      toast.error('خطا در حذف مخاطب');
    }
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!userId) {
    return (
      <div className="flex h-72 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-violet-500" />
      </div>
    );
  }

  const uniqueDomains = new Set(contacts.map(contact => contact.email.split('@')[1]).filter(Boolean)).size;
  const inputClass = 'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-500/10 dark:border-slate-700 dark:bg-slate-900 dark:text-white';

  return (
    <div className="mx-auto max-w-6xl space-y-3 p-1 sm:p-2" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="mb-1 flex items-center gap-1.5 text-[10px] font-bold text-violet-600 dark:text-violet-300">
            <Mail className="h-3.5 w-3.5" />
            دفترچه ایمیل
          </div>
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">مخاطبین ایمیل</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">مدیریت سریع آدرس‌های ایمیل پرکاربرد سازمانی</p>
        </div>
        <button
          onClick={() => setShowCreateForm(value => !value)}
          className="flex h-9 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white shadow-sm transition hover:bg-violet-700 dark:bg-violet-500 dark:hover:bg-violet-400"
        >
          {showCreateForm ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {showCreateForm ? 'بستن فرم' : 'مخاطب جدید'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {[
          { label: 'کل مخاطبین', value: contacts.length, icon: Users, tone: 'violet' },
          { label: 'دامنه‌های ایمیل', value: uniqueDomains, icon: AtSign, tone: 'cyan' },
          { label: 'نتایج فعلی', value: filteredContacts.length, icon: Search, tone: 'emerald' },
        ].map(item => {
          const Icon = item.icon;
          const tones: Record<string, string> = {
            violet: 'border-violet-100 bg-violet-50/55 text-violet-600 dark:border-violet-500/20 dark:bg-violet-500/5 dark:text-violet-300',
            cyan: 'border-cyan-100 bg-cyan-50/55 text-cyan-600 dark:border-cyan-500/20 dark:bg-cyan-500/5 dark:text-cyan-300',
            emerald: 'border-emerald-100 bg-emerald-50/55 text-emerald-600 dark:border-emerald-500/20 dark:bg-emerald-500/5 dark:text-emerald-300',
          };
          return (
            <div key={item.label} className={`flex min-h-[58px] items-center justify-between rounded-xl border px-3 py-2 ${tones[item.tone]}`}>
              <div>
                <p className="text-[10px] text-slate-500 dark:text-slate-400">{item.label}</p>
                <p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">{item.value.toLocaleString('fa-IR')}</p>
              </div>
              <Icon className="h-4 w-4" />
            </div>
          );
        })}
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreateContact} className="rounded-xl border border-violet-100 bg-white p-3 shadow-[0_8px_24px_rgba(15,23,42,0.04)] dark:border-violet-500/20 dark:bg-slate-900">
          <div className="mb-2 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
              <Plus className="h-3.5 w-3.5" />
            </span>
            <div>
              <p className="text-xs font-bold text-slate-800 dark:text-white">افزودن مخاطب ایمیل</p>
              <p className="text-[10px] text-slate-400">نام و ایمیل را وارد کنید.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            <input required type="text" value={newContact.name} onChange={e => setNewContact({ ...newContact, name: e.target.value })} className={inputClass} placeholder="نام و نام خانوادگی" />
            <input required type="email" value={newContact.email} onChange={e => setNewContact({ ...newContact, email: e.target.value })} className={inputClass} placeholder="name@example.com" />
          </div>
          <div className="mt-2 flex justify-end">
            <button type="submit" disabled={loading} className="flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[11px] font-bold text-white hover:bg-violet-700 disabled:opacity-50">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              افزودن مخاطب
            </button>
          </div>
        </form>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-2 dark:border-slate-800 dark:bg-slate-900">
        <div className="relative">
          <Search className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input type="text" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="جستجو با نام یا ایمیل..." className={`${inputClass} pr-8`} />
        </div>
      </div>

      {loading && contacts.length === 0 ? (
        <div className="flex h-40 items-center justify-center rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
        </div>
      ) : filteredContacts.length === 0 ? (
        <div className="flex h-40 flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white/70 text-center dark:border-slate-800 dark:bg-slate-900/60">
          <Mail className="mb-2 h-7 w-7 text-slate-300 dark:text-slate-600" />
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">مخاطبی پیدا نشد</p>
          <p className="mt-1 text-[10px] text-slate-400">عبارت جستجو را تغییر دهید یا مخاطب جدید اضافه کنید.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {filteredContacts.map(contact => (
            <div key={contact.id} className="group rounded-xl border border-slate-200 bg-white p-3 shadow-[0_7px_22px_rgba(15,23,42,0.035)] transition hover:border-violet-200 hover:shadow-[0_10px_28px_rgba(15,23,42,0.07)] dark:border-slate-800 dark:bg-slate-900 dark:hover:border-violet-500/30">
              {editingContactId === contact.id ? (
                <div className="space-y-2">
                  <input type="text" value={editingContact?.name || ''} onChange={e => setEditingContact(prev => prev ? { ...prev, name: e.target.value } : null)} className={inputClass} />
                  <input type="email" value={editingContact?.email || ''} onChange={e => setEditingContact(prev => prev ? { ...prev, email: e.target.value } : null)} className={inputClass} />
                  <div className="flex gap-1.5">
                    <button onClick={() => editingContact && handleUpdateContact(contact.id, editingContact)} className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-emerald-600 text-[11px] font-bold text-white hover:bg-emerald-700">
                      <Save className="h-3.5 w-3.5" /> ذخیره
                    </button>
                    <button onClick={() => { setEditingContactId(null); setEditingContact(null); }} className="flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white text-[11px] text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">
                      <X className="h-3.5 w-3.5" /> انصراف
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-violet-50 text-sm font-bold text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
                        {contact.name.trim().charAt(0) || '@'}
                      </div>
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-bold text-slate-800 dark:text-white">{contact.name}</h3>
                        <a href={`mailto:${contact.email}`} className="mt-0.5 block truncate text-[11px] text-cyan-600 hover:text-cyan-700 dark:text-cyan-300">{contact.email}</a>
                      </div>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <button onClick={() => { setEditingContactId(contact.id); setEditingContact(contact); }} className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-300" title="ویرایش">
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button onClick={() => handleDeleteContact(contact.id)} className="flex h-7 w-7 items-center justify-center rounded-lg bg-rose-50 text-rose-600 transition hover:bg-rose-100 dark:bg-rose-500/10 dark:text-rose-300" title="حذف">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 border-t border-slate-100 pt-2 text-[10px] text-slate-400 dark:border-slate-800">
                    ایجاد: {new Date(contact.created_at || '').toLocaleDateString('fa-IR')}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
