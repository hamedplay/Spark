import { Building2, X } from 'lucide-react';
import type { OrgOrganization } from './types';

interface OrgFormState {
  name: string;
  short_name: string;
  description: string;
  logo_url: string;
  website: string;
}

function OrgFormModal({
  org, form, setForm, saving, onSave, onClose,
}: {
  org: OrgOrganization | null;
  form: OrgFormState;
  setForm: React.Dispatch<React.SetStateAction<OrgFormState>>;
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Building2 className="w-5 h-5 text-amber-500" />
            {org ? 'ویرایش اطلاعات سازمان' : 'تعریف سازمان'}
          </h3>
          {org && <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 rounded-xl"><X className="w-5 h-5" /></button>}
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">نام سازمان *</label>
            <input
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="مثال: شرکت نمونه"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">نام اختصاری</label>
            <input
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              value={form.short_name}
              onChange={e => setForm(f => ({ ...f, short_name: e.target.value }))}
              placeholder="مثال: ن.ش"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">توضیحات</label>
            <textarea
              rows={3}
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm resize-none"
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="توضیح مختصر درباره سازمان"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">وبسایت</label>
            <input
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              value={form.website}
              onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
              placeholder="https://example.com"
              dir="ltr"
            />
          </div>
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button
            onClick={onSave}
            disabled={saving}
            className="flex-1 py-3 bg-amber-500 hover:bg-amber-600 text-white rounded-xl font-semibold text-sm transition-colors disabled:opacity-50"
          >
            {saving ? 'در حال ذخیره...' : 'ذخیره سازمان'}
          </button>
          {org && (
            <button onClick={onClose} className="px-5 py-3 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
              انصراف
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export { OrgFormModal };
export type { OrgFormState };
