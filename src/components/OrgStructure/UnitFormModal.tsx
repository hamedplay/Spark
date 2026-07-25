import { useState } from 'react';
import { Building2, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import type { OrgUnit } from './types';
import { Spinner } from './Spinner';

function UnitFormModal({ initial, allUnits, onSave, onClose }: {
  initial: Partial<OrgUnit> | null;
  allUnits: OrgUnit[];
  onSave: (data: Partial<OrgUnit>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<OrgUnit>>(initial || { name: '', code: '', sort_order: 0 });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.name?.trim()) { toast.error('نام واحد را وارد کنید'); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-amber-500" />
            {initial?.id ? 'ویرایش واحد' : 'افزودن واحد سازمانی'}
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">نام واحد *</label>
            <input className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="مثال: معاونت فناوری اطلاعات" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">کد واحد</label>
            <input className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              value={form.code || ''} onChange={e => setForm(f => ({ ...f, code: e.target.value }))}
              placeholder="مثال: IT, HR, FIN" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">واحد بالادستی</label>
            <select className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              value={form.parent_id || ''} onChange={e => setForm(f => ({ ...f, parent_id: e.target.value || null }))}>
              <option value="">— ندارد —</option>
              {allUnits.filter(u => u.id !== form.id).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white py-3 rounded-2xl font-semibold transition-colors"
          >
            {saving ? <Spinner className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {initial?.id ? 'ذخیره' : 'افزودن'}
          </button>
          <button onClick={onClose} className="px-5 py-3 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-2xl font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">انصراف</button>
        </div>
      </div>
    </div>
  );
}

export { UnitFormModal };
