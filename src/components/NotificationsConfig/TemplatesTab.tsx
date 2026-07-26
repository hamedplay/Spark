import { useState, useEffect, useCallback } from 'react';
import { Bell, ChevronDown, Eye, Loader as Loader2, Plus, RefreshCw, Trash2, CreditCard as Edit2, Users } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { invalidateTemplateCache } from '../../lib/notifications';
import toast from 'react-hot-toast';
import {
  TEMPLATE_CATEGORIES as NOTIF_CATEGORIES,
  TEMPLATE_AUDIENCES as AUDIENCES,
} from '../../config/templateCatalog';
import {
  COLORS, COLOR_BADGE, AUDIENCE_COLORS, audienceLabel, eventLabel,
  inp, type NotificationTemplate,
} from './types';
import { TemplateEditor, NewTemplateForm } from './TemplateForms';
import { TemplateGuide } from './TemplateGuide';
import { NotifPreviewModal } from './NotifPreviewModal';

export function TemplatesTab() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [filterCat, setFilterCat] = useState('all');
  const [filterAudience, setFilterAudience] = useState('all');
  const [previewTemplate, setPreviewTemplate] = useState<NotificationTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await supabase.from('notification_templates').select('*').order('category').order('event_type').order('audience');
      setTemplates((data || []) as NotificationTemplate[]);
    } catch {
      toast.error('خطا در بارگذاری قالب‌های اعلان');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteTemplate = async (id: string) => {
    await supabase.from('notification_templates').delete().eq('id', id);
    setTemplates(ts => ts.filter(t => t.id !== id));
    invalidateTemplateCache();
    toast.success('قالب حذف شد');
  };

  const filtered = templates.filter(t => {
    if (filterCat !== 'all' && t.category !== filterCat) return false;
    if (filterAudience !== 'all' && t.audience !== filterAudience) return false;
    return true;
  });

  const grouped: Record<string, Record<string, NotificationTemplate[]>> = {};
  for (const t of filtered) {
    if (!grouped[t.category]) grouped[t.category] = {};
    if (!grouped[t.category][t.audience]) grouped[t.category][t.audience] = [];
    grouped[t.category][t.audience].push(t);
  }

  const audienceOrder = ['all', 'participants', 'observers', 'external'];

  if (editing) {
    return <TemplateEditor template={editing} onSave={t => { setTemplates(ts => ts.map(x => x.id === t.id ? t : x)); setEditing(null); }} onCancel={() => setEditing(null)} />;
  }
  if (creating) {
    return <NewTemplateForm onSave={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />;
  }

  const selBase = 'appearance-none text-sm pr-3 pl-8 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className={selBase}>
              <option value="all">همه دسته‌ها</option>
              {NOTIF_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select value={filterAudience} onChange={e => setFilterAudience(e.target.value)} className={selBase}>
              <option value="all">همه دریافت‌کنندگان</option>
              {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setCreating(true)}
            className="flex items-center gap-2 px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-sm font-medium transition">
            <Plus className="w-4 h-4" />افزودن قالب جدید
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {AUDIENCES.map(a => (
          <button key={a.key} onClick={() => setFilterAudience(filterAudience === a.key ? 'all' : a.key)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${filterAudience === a.key || filterAudience === 'all' ? AUDIENCE_COLORS[a.key] + ' border-transparent' : 'border-gray-200 dark:border-gray-600 text-gray-400'}`}>
            <Users className="w-3 h-3" />{a.label}
          </button>
        ))}
      </div>

      <TemplateGuide />

      {loading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}

      {!loading && Object.keys(grouped).length === 0 && (
        <div className="py-14 text-center bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <Bell className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm mb-3">قالبی یافت نشد</p>
          <button onClick={() => setCreating(true)} className="text-sm text-amber-500 hover:text-amber-600 font-medium">افزودن قالب جدید</button>
        </div>
      )}

      <div className="space-y-5">
        {Object.entries(grouped).map(([cat, audienceMap]) => (
          <div key={cat} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${COLOR_BADGE[NOTIF_CATEGORIES.find(c=>c.key===cat)?.key || 'system'] || 'bg-gray-100 text-gray-500'}`}>
                {NOTIF_CATEGORIES.find(c => c.key === cat)?.label || cat}
              </span>
              <span className="text-xs text-gray-400">{Object.values(audienceMap).flat().length} قالب</span>
            </div>

            {audienceOrder.filter(aud => audienceMap[aud]?.length).map(aud => (
              <div key={aud}>
                <div className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border-b border-gray-50 dark:border-gray-700/50 ${AUDIENCE_COLORS[aud]}`}>
                  <Users className="w-3 h-3" />
                  {audienceLabel[aud]}
                  <span className="mr-auto text-xs opacity-70">{audienceMap[aud].length} قالب</span>
                </div>
                <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {audienceMap[aud].map(t => (
                    <div key={t.id} className="p-4 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${COLORS.find(c => c.key === t.color)?.cls || 'bg-gray-400'}`} />
                          <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full">
                            {eventLabel[t.event_type] || t.event_type}
                          </span>
                          {!t.is_active && <span className="text-xs bg-red-100 dark:bg-red-900/30 text-red-500 px-2.5 py-1 rounded-full">غیرفعال</span>}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          <button onClick={() => setPreviewTemplate(t)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-600 hover:text-blue-600 dark:hover:text-blue-400 rounded-xl transition">
                            <Eye className="w-3 h-3" />پیش‌نمایش
                          </button>
                          <button onClick={() => setEditing(t)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-amber-50 dark:hover:bg-amber-900/20 text-gray-600 hover:text-amber-600 dark:hover:text-amber-400 rounded-xl transition">
                            <Edit2 className="w-3 h-3" />ویرایش
                          </button>
                          <button onClick={() => deleteTemplate(t.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 hover:text-red-500 rounded-xl transition">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>
                      <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mt-2">{t.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">{t.body}</p>
                      {t.placeholders?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {t.placeholders.map(ph => (
                            <code key={ph} className="text-xs px-1.5 py-0.5 bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 rounded font-mono">{`{{${ph}}}`}</code>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {previewTemplate && <NotifPreviewModal template={previewTemplate} onClose={() => setPreviewTemplate(null)} />}
    </div>
  );
}
