import { useState } from 'react';
import { Plus, CreditCard as Edit2, Save, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { BackHeader } from './Shared';
import type { UserGroup } from './types';
import { inp } from './types';

export function GroupForm({ group, onBack, onDone }: {
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
