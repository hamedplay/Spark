import React, { useState, useEffect } from 'react';
import { Mail, CreditCard as Edit2, Save, X, Plus, Loader2, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { ContactEmail } from '../types';
import toast from 'react-hot-toast';

export function ContactsEmailPage({ currentUserId: propUserId }: { currentUserId?: string | null }) {
  const [contacts, setContacts] = useState<ContactEmail[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [newContact, setNewContact] = useState({
    name: '',
    email: ''
  });
  const [editingContact, setEditingContact] = useState<ContactEmail | null>(null);
  const [userId, setUserId] = useState<string | null>(propUserId ?? null);

  useEffect(() => {
    if (!propUserId) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) setUserId(user.id);
      });
    }
  }, []);

  const fetchContacts = async () => {
    try {
      const { data, error } = await supabase
        .from('contacts_email')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setContacts(data || []);
    } catch (error: any) {
      toast.error('خطا در دریافت لیست مخاطبین');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchContacts();
  }, []);

  const handleCreateContact = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!userId) {
      toast.error('لطفا ابتدا وارد حساب کاربری خود شوید');
      return;
    }

    if (!newContact.email.includes('@')) {
      toast.error('لطفاً یک ایمیل معتبر وارد کنید');
      return;
    }

    setLoading(true);

    try {
      const { error } = await supabase
        .from('contacts_email')
        .insert([{
          ...newContact,
          user_id: userId
        }]);

      if (error) throw error;

      toast.success('مخاطب جدید با موفقیت اضافه شد');
      setShowCreateForm(false);
      setNewContact({ name: '', email: '' });
      fetchContacts();
    } catch (error: any) {
      console.error('Error creating contact:', error);
      toast.error('خطا در ایجاد مخاطب جدید');
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateContact = async (contactId: string, updatedData: Partial<ContactEmail>) => {
    try {
      const { error } = await supabase
        .from('contacts_email')
         .update(updatedData)
        .eq('id', contactId);

      if (error) throw error;

      toast.success('مخاطب با موفقیت به‌روزرسانی شد');
      setEditingContactId(null);
      setEditingContact(null);
      fetchContacts();
    } catch (error: any) {
      toast.error('خطا در به‌روزرسانی مخاطب');
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!confirm('آیا از حذف این مخاطب اطمینان دارید؟')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('contacts_email')
        .delete()
        .eq('id', contactId);

      if (error) throw error;

      toast.success('مخاطب با موفقیت حذف شد');
      fetchContacts();
    } catch (error: any) {
      toast.error('خطا در حذف مخاطب');
    }
  };

  const filteredContacts = contacts.filter(contact =>
    contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contact.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!userId) {
    return <div className="flex items-center justify-center h-96"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" /></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold dark:text-white">مدیریت مخاطبین ایمیل</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="flex items-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
        >
          <Plus className="w-5 h-5" />
          مخاطب جدید
        </button>
      </div>

      {showCreateForm && (
        <form onSubmit={handleCreateContact} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                نام و نام خانوادگی
              </label>
              <input
                required
                type="text"
                value={newContact.name}
                onChange={(e) => setNewContact({ ...newContact, name: e.target.value })}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                ایمیل
              </label>
              <input
                required
                type="email"
                value={newContact.email}
                onChange={(e) => setNewContact({ ...newContact, email: e.target.value })}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
              />
            </div>
          </div>

          <div className="mt-6">
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white py-2 px-4 rounded-lg hover:bg-blue-600 disabled:opacity-50"
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Plus className="w-5 h-5" />
              )}
              افزودن مخاطب
            </button>
          </div>
        </form>
      )}

      <div className="relative">
        <Search className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 dark:text-gray-500" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="جستجو در مخاطبین..."
          className="w-full pl-4 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredContacts.map(contact => (
          <div key={contact.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow">
            {editingContactId === contact.id ? (
              <div className="space-y-4">
                <input
                  type="text"
                  value={editingContact?.name || ''}
                  onChange={(e) => setEditingContact(prev => prev ? {...prev, name: e.target.value} : null)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <input
                  type="email"
                  value={editingContact?.email || ''}
                  onChange={(e) => setEditingContact(prev => prev ? {...prev, email: e.target.value} : null)}
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => editingContact && handleUpdateContact(contact.id, editingContact)}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-500 text-white py-2 rounded-lg hover:bg-green-600"
                  >
                    <Save className="w-4 h-4" />
                    ذخیره
                  </button>
                  <button
                    onClick={() => {
                      setEditingContactId(null);
                      setEditingContact(null);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 bg-gray-500 text-white py-2 rounded-lg hover:bg-gray-600"
                  >
                    <X className="w-4 h-4" />
                    انصراف
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex justify-between items-start mb-4">
                  <h3 className="text-xl font-semibold dark:text-white">{contact.name}</h3>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingContactId(contact.id);
                        setEditingContact(contact);
                      }}
                      className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-blue-500 dark:hover:text-blue-400"
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDeleteContact(contact.id)}
                      className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-gray-600 dark:text-gray-300">
                  <Mail className="w-5 h-5" />
                  <a href={`mailto:${contact.email}`} className="hover:text-blue-500 dark:hover:text-blue-400">
                    {contact.email}
                  </a>
                </div>

                <p className="text-sm text-gray-400 dark:text-gray-500 mt-4">
                  تاریخ ایجاد: {new Date(contact.created_at || '').toLocaleDateString('fa-IR')}
                </p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}