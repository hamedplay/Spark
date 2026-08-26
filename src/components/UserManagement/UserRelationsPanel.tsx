import { useState, useEffect } from 'react';
import { X, Plus, Link2, Trash2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { AdminProfile, Relation } from './types';

const RELATION_TYPES = [
  { value: 'view', label: 'مشاهده', desc: 'فقط می‌تواند داده‌های طرف مقابل را ببیند' },
  { value: 'collaborate', label: 'همکاری', desc: 'می‌توانند با هم همکاری کنند' },
  { value: 'manage', label: 'مدیریت', desc: 'می‌تواند داده‌های طرف مقابل را مدیریت کند' },
];

function UserRelationsPanel({ user, onBack, allProfiles }: { user: AdminProfile; onBack: () => void; allProfiles: AdminProfile[] }) {
  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ related_user_id: '', relation_type: 'view', note: '' });
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('user_access_relations')
      .select('*')
      .or(`user_id.eq.${user.user_id},related_user_id.eq.${user.user_id}`)
      .order('created_at', { ascending: false });
    setRelations((data || []) as Relation[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user.user_id]);

  const getProfile = (uid: string) => allProfiles.find(p => p.user_id === uid);

  const handleAdd = async () => {
    if (!form.related_user_id) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('user_access_relations').insert({
        user_id: user.user_id,
        related_user_id: form.related_user_id,
        relation_type: form.relation_type,
        note: form.note || null,
      });
      if (error) { toast.error('خطا: ' + error.message); return; }
      toast.success('ارتباط اضافه شد');
      setAdding(false);
      setForm({ related_user_id: '', relation_type: 'view', note: '' });
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('user_access_relations').delete().eq('id', id);
    if (error) { toast.error('خطا در حذف'); return; }
    toast.success('ارتباط حذف شد');
    load();
  };

  const relTypeLabel = (type: string) => RELATION_TYPES.find(r => r.value === type)?.label || type;

  const otherUsers = allProfiles.filter(p =>
    p.user_id !== user.user_id &&
    !relations.some(r => r.user_id === user.user_id && r.related_user_id === p.user_id)
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
          <X className="w-4 h-4 text-gray-500" />
        </button>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Link2 className="w-4 h-4 text-blue-500" />
            ارتباطات دستی — {user.full_name || user.email}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">ارتباطات خارج از ساختار سازمانی</p>
        </div>
      </div>

      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> افزودن ارتباط جدید
        </button>
      )}

      {adding && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
          <h4 className="text-sm font-bold text-gray-700 dark:text-gray-200">ارتباط جدید</h4>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">کاربر مرتبط</label>
            <select
              value={form.related_user_id}
              onChange={e => setForm(f => ({ ...f, related_user_id: e.target.value }))}
              className="w-full p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-white"
            >
              <option value="">— انتخاب کنید —</option>
              {otherUsers.map(p => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name || p.email}
                  {p.position ? ` (${p.position})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع ارتباط</label>
            <div className="flex gap-2">
              {RELATION_TYPES.map(r => (
                <button
                  key={r.value}
                  onClick={() => setForm(f => ({ ...f, relation_type: r.value }))}
                  title={r.desc}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${form.relation_type === r.value ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-300'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">{RELATION_TYPES.find(r => r.value === form.relation_type)?.desc}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">توضیح (اختیاری)</label>
            <input
              type="text"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="دلیل این ارتباط..."
              className="w-full p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={!form.related_user_id || saving}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
              {saving ? 'در حال ذخیره...' : 'ثبت ارتباط'}
            </button>
            <button onClick={() => { setAdding(false); setForm({ related_user_id: '', relation_type: 'view', note: '' }); }}
              className="px-4 py-2 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              انصراف
            </button>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">در حال بارگذاری...</div>
        ) : relations.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Link2 className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-400">هیچ ارتباط دستی تعریف نشده است</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {relations.map(r => {
              const isOwner = r.user_id === user.user_id;
              const otherUserId = isOwner ? r.related_user_id : r.user_id;
              const other = getProfile(otherUserId);
              return (
                <div key={r.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${isOwner ? 'bg-blue-500' : 'bg-green-500'}`}>
                      {(other?.full_name || other?.email || '?')[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                        {other?.full_name || other?.email || otherUserId}
                        {other?.position ? <span className="text-xs text-gray-400 mr-1">({other.position})</span> : null}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${r.relation_type === 'manage' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : r.relation_type === 'collaborate' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                          {relTypeLabel(r.relation_type)}
                        </span>
                        {!isOwner && <span className="text-xs text-green-600 dark:text-green-400">(تعریف شده توسط طرف مقابل)</span>}
                        {r.note && <span className="text-xs text-gray-400 truncate">{r.note}</span>}
                      </div>
                    </div>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors flex-shrink-0"
                      title="حذف ارتباط"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export { UserRelationsPanel };
