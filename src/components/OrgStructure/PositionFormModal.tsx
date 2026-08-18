import { useState } from 'react';
import { Briefcase, X, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import type { OrgPosition, OrgUnit, LevelDef } from './types';
import { getLevelInfo } from './utils';
import { Spinner } from '../Spinner';

function PositionFormModal({
  initial, units, allPositions, levelDefs, onSave, onClose,
}: {
  initial: Partial<OrgPosition> | null;
  units: OrgUnit[];
  allPositions: OrgPosition[];
  levelDefs: LevelDef[];
  onSave: (data: Partial<OrgPosition>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Partial<OrgPosition>>(
    initial || { title: '', level: 3, color: '#3b82f6', icon: '', sort_order: 0 }
  );
  const [saving, setSaving] = useState(false);

  const handleLevelChange = (level: number) => {
    const l = getLevelInfo(level, levelDefs);
    setForm(f => ({ ...f, level, color: l.color, icon: l.icon }));
  };

  const handleSubmit = async () => {
    if (!form.title?.trim()) { toast.error('عنوان سمت را وارد کنید'); return; }
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const sorted = [...levelDefs].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 dark:border-gray-700 sticky top-0 bg-white dark:bg-gray-900 z-10">
          <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Briefcase className="w-5 h-5 text-blue-500" />
            {initial?.id ? 'ویرایش سمت' : 'افزودن سمت جدید'}
          </h3>
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-xl">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">عنوان سمت *</label>
            <input
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={form.title || ''}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="مثال: مدیرعامل، معاون مالی، رئیس اداره منابع انسانی"
            />
          </div>

          {/* Level selection */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">سطح سازمانی</label>
            <div className="grid grid-cols-4 gap-2">
              {sorted.map(l => (
                <button
                  key={l.level}
                  onClick={() => handleLevelChange(l.level)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-all text-center ${form.level === l.level ? 'border-current shadow-md' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'}`}
                  style={form.level === l.level ? { borderColor: l.color, backgroundColor: l.color + '15' } : {}}
                >
                  <span className="text-base">{l.icon}</span>
                  <span className="text-[9px] font-medium leading-tight" style={form.level === l.level ? { color: l.color } : { color: '#6b7280' }}>{l.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">بالادستی (مستقیم)</label>
            <select
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={form.parent_position_id || ''}
              onChange={e => setForm(f => ({ ...f, parent_position_id: e.target.value || null }))}
            >
              <option value="">— ندارد (رده اول) —</option>
              {allPositions
                .filter(p => p.id !== form.id)
                .sort((a, b) => a.level - b.level)
                .map(p => {
                  const li = getLevelInfo(p.level, levelDefs);
                  return <option key={p.id} value={p.id}>{li.icon} {p.title} ({li.label})</option>;
                })}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">واحد / دپارتمان</label>
            <select
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={form.unit_id || ''}
              onChange={e => setForm(f => ({ ...f, unit_id: e.target.value || null }))}
            >
              <option value="">— بدون واحد —</option>
              {units.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">رنگ</label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.color || '#3b82f6'}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-10 h-10 rounded-xl cursor-pointer border border-gray-200 dark:border-gray-600 p-0.5"
                />
                <input
                  className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
                  value={form.color || ''}
                  onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">آیکن (ایموجی)</label>
              <input
                className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.icon || ''}
                onChange={e => setForm(f => ({ ...f, icon: e.target.value }))}
                placeholder="👑 ⭐ 💼"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">ترتیب نمایش</label>
            <input type="number"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              value={form.sort_order ?? 0}
              onChange={e => setForm(f => ({ ...f, sort_order: parseInt(e.target.value) || 0 }))}
            />
          </div>
        </div>

        <div className="px-6 pb-6 flex gap-3">
          <button onClick={handleSubmit} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white py-3 rounded-2xl font-semibold transition-colors"
          >
            {saving ? <Spinner className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {initial?.id ? 'ذخیره تغییرات' : 'افزودن سمت'}
          </button>
          <button onClick={onClose}
            className="px-5 py-3 bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-2xl font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

export { PositionFormModal };
