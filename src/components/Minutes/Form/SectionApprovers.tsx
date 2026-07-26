import { Plus, Trash2 } from 'lucide-react';
import type { DraftApprover } from './types';
import { defaultApprover } from './defaults';
import { InputField, SelectField, ComingSoonBanner } from './fields';

interface SectionApproversProps {
  approvers: DraftApprover[];
  setApprovers: React.Dispatch<React.SetStateAction<DraftApprover[]>>;
}

export function SectionApprovers({ approvers, setApprovers }: SectionApproversProps) {
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        تأییدکنندگان
      </h2>
      <ComingSoonBanner message="مدیریت تأییدکنندگان در نسخه بعدی فعال خواهد شد. در این مرحله تأییدکنندگان ذخیره نمی‌شوند." />
      <div className="opacity-50 pointer-events-none">
        <ApproversForm approvers={approvers} setApprovers={setApprovers} />
      </div>
    </div>
  );
}

function ApproversForm({ approvers, setApprovers }: SectionApproversProps) {
  const add = () =>
    setApprovers(l => [...l, defaultApprover(l.length + 1)]);

  const remove = (id: string) =>
    setApprovers(l => l.filter(a => a.id !== id));

  const update = (id: string, field: keyof DraftApprover, value: string) =>
    setApprovers(l => l.map(a => (a.id === id ? { ...a, [field]: value } : a)));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between border-b border-gray-100 dark:border-gray-700 pb-3">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">تأییدکنندگان</h2>
        <button onClick={add} className="flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline">
          <Plus className="w-4 h-4" /> افزودن
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-2">
        <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
          <input type="radio" name="approval-method" defaultChecked className="accent-blue-600" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">تأیید سیستمی</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">ارسال درخواست دیجیتال</p>
          </div>
        </label>
        <label className="flex items-center gap-3 p-3 border border-gray-200 dark:border-gray-600 rounded-xl cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
          <input type="radio" name="approval-method" className="accent-blue-600" />
          <div>
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">تأیید حضوری</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">ثبت تأیید دستی</p>
          </div>
        </label>
      </div>

      <div className="space-y-3">
        {approvers.map((a, idx) => (
          <div key={a.id} className="grid grid-cols-1 sm:grid-cols-4 gap-2 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl items-end">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-xs font-semibold flex items-center justify-center flex-shrink-0">
                {idx + 1}
              </span>
              <InputField id={`ap-name-${a.id}`} label="نام" placeholder="" value={a.name} onChange={v => update(a.id, 'name', v)} />
            </div>
            <InputField id={`ap-pos-${a.id}`} label="سمت" placeholder="" value={a.position} onChange={v => update(a.id, 'position', v)} />
            <InputField id={`ap-unit-${a.id}`} label="واحد" placeholder="" value={a.unit} onChange={v => update(a.id, 'unit', v)} />
            <div className="flex items-end gap-2">
              <SelectField id={`ap-method-${a.id}`} label="نوع تأیید" options={[{ value: 'digital', label: 'سیستمی' }, { value: 'in_person', label: 'حضوری' }]} value={a.method} onChange={v => update(a.id, 'method', v)} />
              <button onClick={() => remove(a.id)} aria-label="حذف تأییدکننده" className="p-2 rounded-xl text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
