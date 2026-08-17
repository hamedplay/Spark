import { useState } from 'react';
import { Plus, Trash2, CreditCard as Edit2, Crown, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { LevelDef } from './types';
import { Spinner } from './Spinner';

function LevelManagerPanel({ levelDefs, onRefresh }: { levelDefs: LevelDef[]; onRefresh: () => void }) {
  const [editing, setEditing] = useState<LevelDef | null>(null);
  const [form, setForm] = useState<LevelDef>({ level: 9, label: '', color: '#6b7280', icon: '👤', sort_order: 9 });
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const saveLevel = async () => {
    if (!form.label.trim()) { toast.error('نام سطح الزامی است'); return; }
    setSaving(true);
    try {
      if (editing?.id) {
        await supabase.from('org_level_definitions').update({ label: form.label, color: form.color, icon: form.icon, sort_order: form.sort_order }).eq('id', editing.id);
      } else {
        const { error } = await supabase.from('org_level_definitions').insert([{ level: form.level, label: form.label, color: form.color, icon: form.icon, sort_order: form.sort_order }]);
        if (error) { toast.error('خطا: ' + error.message); return; }
      }
      toast.success('سطح ذخیره شد');
      setEditing(null);
      setShowAdd(false);
      onRefresh();
    } finally { setSaving(false); }
  };

  const deleteLevel = async (id: string) => {
    if (!confirm('آیا از حذف این سطح مطمئنید؟')) return;
    await supabase.from('org_level_definitions').delete().eq('id', id);
    toast.success('سطح حذف شد');
    onRefresh();
  };

  const sorted = [...levelDefs].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
        <div>
          <h4 className="font-semibold text-gray-800 dark:text-white text-sm flex items-center gap-2">
            <Crown className="w-4 h-4 text-amber-500" />
            سطح‌بندی سازمانی
          </h4>
          <p className="text-xs text-gray-400 mt-0.5">تعریف و ویرایش سطوح سلسله‌مراتبی سازمان</p>
        </div>
        <button
          onClick={() => { setShowAdd(true); setEditing(null); setForm({ level: sorted.length + 1, label: '', color: '#6b7280', icon: '👤', sort_order: sorted.length + 1 }); }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs font-medium transition-colors"
        >
          <Plus className="w-3.5 h-3.5" /> افزودن سطح
        </button>
      </div>

      {(showAdd || editing) && (
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 bg-amber-50 dark:bg-amber-900/10">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">نام سطح *</label>
              <input className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                value={form.label} onChange={e => setForm(f => ({ ...f, label: e.target.value }))} placeholder="مثال: رئیس اداره" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">شماره سطح</label>
              <input type="number" className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                value={form.level} onChange={e => setForm(f => ({ ...f, level: parseInt(e.target.value) || 1 }))} min={1} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">آیکن</label>
              <input className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
                value={form.icon} onChange={e => setForm(f => ({ ...f, icon: e.target.value }))} placeholder="👑" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">رنگ</label>
              <div className="flex gap-2">
                <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                  className="w-10 h-[38px] rounded-xl cursor-pointer border border-gray-200 dark:border-gray-600 p-0.5" />
                <input className="flex-1 px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500 text-xs font-mono"
                  value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))} />
              </div>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={saveLevel} disabled={saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors"
            >
              {saving ? <Spinner className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {editing ? 'ذخیره' : 'افزودن'}
            </button>
            <button onClick={() => { setEditing(null); setShowAdd(false); }}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl text-sm">
              انصراف
            </button>
          </div>
        </div>
      )}

      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {sorted.map(l => (
          <div key={l.level} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center text-sm" style={{ backgroundColor: l.color + '20' }}>
              <span>{l.icon}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-gray-800 dark:text-white">{l.label}</span>
                <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium" style={{ backgroundColor: l.color }}>
                  سطح {l.level}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => { setEditing(l); setShowAdd(false); setForm({ ...l }); }}
                className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors"
              >
                <Edit2 className="w-3.5 h-3.5" />
              </button>
              {l.id && (
                <button onClick={() => deleteLevel(l.id!)}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export { LevelManagerPanel };
