import { useState, useEffect, useCallback, useRef } from 'react';
import moment from 'moment-jalaali';
import { Bell, Users, Check, X, Loader as Loader2, RefreshCw, Save, Info, ChevronDown, Plus, Trash2, CreditCard as Edit2, Eye, CircleCheck as CheckCircle, Clock, ChevronLeft, ChevronRight, Group as GroupIcon, FileText, ChartBar as BarChart2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { invalidateTemplateCache } from '../lib/notifications';
import toast from 'react-hot-toast';

// ─── Types ────────────────────────────────────────────────────────────────────
interface UserGroup { id: string; name: string; display_name: string | null; }

interface NotificationTemplate {
  id: string;
  category: string;
  event_type: string;
  audience: string;
  title: string;
  body: string;
  icon: string;
  color: string;
  placeholders: string[];
  is_active: boolean;
}

// ─── Catalogs ─────────────────────────────────────────────────────────────────
const NOTIFICATION_TYPES = [
  { key: 'meeting_invite',    label: 'دعوت به جلسه',           category: 'جلسات' },
  { key: 'meeting_change',    label: 'تغییر جلسه',             category: 'جلسات' },
  { key: 'meeting_cancel',    label: 'لغو جلسه',               category: 'جلسات' },
  { key: 'meeting_reminder',  label: 'یادآور جلسه',            category: 'جلسات' },
  { key: 'task_assign',       label: 'تخصیص اقدام',            category: 'اقدامات' },
  { key: 'task_reminder',     label: 'یادآور اقدام',           category: 'اقدامات' },
  { key: 'task_complete',     label: 'تکمیل اقدام',            category: 'اقدامات' },
  { key: 'chat_message',      label: 'پیام چت',                category: 'چت' },
  { key: 'chat_mention',      label: 'منشن در چت',             category: 'چت' },
  { key: 'channel_message',   label: 'پیام کانال',             category: 'کانال‌ها' },
  { key: 'channel_mention',   label: 'منشن در کانال',          category: 'کانال‌ها' },
  { key: 'channel_invite',    label: 'دعوت به کانال',          category: 'کانال‌ها' },
  { key: 'calendar_event',    label: 'رویداد تقویم',           category: 'تقویم' },
  { key: 'calendar_reminder', label: 'یادآور تقویم',           category: 'تقویم' },
  { key: 'note_share',        label: 'اشتراک یادداشت',         category: 'یادداشت‌ها' },
  { key: 'report_ready',      label: 'گزارش آماده شد',         category: 'گزارشات' },
  { key: 'system_alert',      label: 'هشدار سیستم',            category: 'سیستم' },
];

const N_CATEGORIES = Array.from(new Set(NOTIFICATION_TYPES.map(n => n.category)));

const NOTIF_CATEGORIES = [
  { key: 'meeting',  label: 'جلسات' },
  { key: 'task',     label: 'اقدامات' },
  { key: 'chat',     label: 'چت' },
  { key: 'channel',  label: 'کانال‌ها' },
  { key: 'calendar', label: 'تقویم' },
  { key: 'note',     label: 'یادداشت‌ها' },
  { key: 'system',   label: 'سیستم' },
];

const EVENT_TYPES = [
  { key: 'invite', label: 'دعوت' }, { key: 'change', label: 'تغییر' },
  { key: 'cancel', label: 'لغو' }, { key: 'reminder', label: 'یادآور' },
  { key: 'assign', label: 'تخصیص' }, { key: 'complete', label: 'تکمیل' },
  { key: 'event_invite', label: 'دعوت رویداد' }, { key: 'mention', label: 'منشن' },
  { key: 'message', label: 'پیام' }, { key: 'share', label: 'اشتراک' },
  { key: 'alert', label: 'هشدار' }, { key: 'custom', label: 'سفارشی' },
];

const AUDIENCES = [
  { key: 'all', label: 'همه' }, { key: 'participants', label: 'شرکت‌کنندگان' },
  { key: 'observers', label: 'مطلعین' }, { key: 'external', label: 'خارج سازمان' },
];

const COLORS = [
  { key: 'blue', label: 'آبی', cls: 'bg-blue-500' },
  { key: 'green', label: 'سبز', cls: 'bg-green-500' },
  { key: 'amber', label: 'نارنجی', cls: 'bg-amber-500' },
  { key: 'red', label: 'قرمز', cls: 'bg-red-500' },
  { key: 'teal', label: 'فیروزه‌ای', cls: 'bg-teal-500' },
  { key: 'gray', label: 'خاکستری', cls: 'bg-gray-500' },
];

const COLOR_BADGE: Record<string, string> = {
  blue:  'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  green: 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
  amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
  red:   'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  teal:  'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',
  gray:  'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
};

const ALL_PLACEHOLDERS = [
  { key: 'full_name',       label: 'نام کامل' },
  { key: 'meeting_subject', label: 'موضوع جلسه' },
  { key: 'meeting_date',    label: 'تاریخ جلسه' },
  { key: 'meeting_time',    label: 'ساعت جلسه' },
  { key: 'location',        label: 'محل برگزاری' },
  { key: 'representative',  label: 'نماینده' },
  { key: 'minutes',         label: 'دقایق مانده' },
  { key: 'task_title',      label: 'عنوان اقدام' },
  { key: 'priority',        label: 'اولویت' },
  { key: 'due_date',        label: 'مهلت' },
  { key: 'event_title',     label: 'عنوان رویداد' },
  { key: 'event_date',      label: 'تاریخ رویداد' },
  { key: 'sender_name',     label: 'نام فرستنده' },
  { key: 'note_title',      label: 'عنوان یادداشت' },
  { key: 'message_preview', label: 'پیش‌نمایش پیام' },
  { key: 'alert_message',   label: 'متن هشدار' },
  { key: 'agenda',          label: 'دستور جلسه' },
];

const TABS = [
  { key: 'groups',    label: 'گروه‌بندی اعلان',   icon: GroupIcon },
  { key: 'templates', label: 'قالب اعلان‌ها',     icon: FileText },
  { key: 'logs',      label: 'گزارش اعلان‌ها',    icon: BarChart2 },
];

const inp = 'w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition text-sm';

// ─── Toggle ───────────────────────────────────────────────────────────────────
function Toggle({ value, onChange, color = 'bg-amber-500' }: { value: boolean; onChange: (v: boolean) => void; color?: string }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${value ? color : 'bg-gray-200 dark:bg-gray-600'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

// ─── Group selector dropdown ──────────────────────────────────────────────────
function GroupSelector({ groups, selected, onSelect }: { groups: UserGroup[]; selected: string | null; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const current = groups.find(g => g.id === selected);
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="flex items-center gap-3 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl text-sm text-gray-700 dark:text-gray-200 hover:border-amber-400 transition-colors min-w-52">
        <GroupIcon className="w-4 h-4 text-amber-500 flex-shrink-0" />
        <span className="flex-1 text-right truncate">{current ? (current.display_name || current.name) : 'انتخاب گروه کاربری'}</span>
        <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-full bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1">
          {groups.map(g => (
            <button key={g.id} onClick={() => { onSelect(g.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right transition-colors ${selected === g.id ? 'bg-amber-50 dark:bg-amber-900/20' : ''}`}>
              <GroupIcon className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
              <span className="text-sm text-gray-700 dark:text-gray-200">{g.display_name || g.name}</span>
              {selected === g.id && <Check className="w-3.5 h-3.5 text-amber-500 mr-auto flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 1 — Group notification rules (user groups only)
// ════════════════════════════════════════════════════════════════════
function GroupsTab() {
  const [groups, setGroups] = useState<UserGroup[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [rules, setRules] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.from('user_groups').select('id, name, display_name').order('name').then(({ data }) => {
      const g = (data || []) as UserGroup[];
      setGroups(g);
      if (g.length > 0) setSelectedGroup(g[0].id);
    });
  }, []);

  const loadRules = useCallback(async (groupId: string) => {
    setLoading(true);
    const { data } = await supabase.from('notification_group_rules').select('*').eq('group_id', groupId);
    const map: Record<string, boolean> = {};
    for (const r of (data || [])) map[r.notification_type] = r.enabled;
    setRules(map);
    setLoading(false);
  }, []);

  useEffect(() => { if (selectedGroup) loadRules(selectedGroup); }, [selectedGroup, loadRules]);

  const toggleAll = (cat: string, value: boolean) => {
    const keys = NOTIFICATION_TYPES.filter(n => n.category === cat).map(n => n.key);
    setRules(r => { const next = { ...r }; keys.forEach(k => { next[k] = value; }); return next; });
  };

  const save = async () => {
    if (!selectedGroup) return;
    setSaving(true);
    for (const [type, enabled] of Object.entries(rules)) {
      await supabase.from('notification_group_rules')
        .upsert({ group_id: selectedGroup, notification_type: type, enabled }, { onConflict: 'group_id,notification_type' });
    }
    toast.success('تنظیمات اعلان ذخیره شد');
    setSaving(false);
  };

  const allEnabledForCat = (cat: string) =>
    NOTIFICATION_TYPES.filter(n => n.category === cat).every(n => rules[n.key] !== false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-start gap-2 flex-1 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-sm text-amber-700 dark:text-amber-400">
          <Info className="w-4 h-4 flex-shrink-0 mt-0.5" />
          اعلان‌های فعال برای گروه کاربری انتخاب‌شده اعمال می‌شود.
        </div>
        <div className="flex gap-2 items-center">
          <GroupSelector groups={groups} selected={selectedGroup} onSelect={setSelectedGroup} />
          <button onClick={() => selectedGroup && loadRules(selectedGroup)}
            className="p-2.5 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!selectedGroup && <div className="py-16 text-center text-gray-400">ابتدا یک گروه کاربری انتخاب کنید</div>}
      {selectedGroup && loading && <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-300" /></div>}

      {selectedGroup && !loading && (
        <>
          <div className="space-y-3">
            {N_CATEGORIES.map(cat => {
              const items = NOTIFICATION_TYPES.filter(n => n.category === cat);
              const allOn = allEnabledForCat(cat);
              return (
                <div key={cat} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <span className="font-semibold text-gray-700 dark:text-gray-200 text-sm">{cat}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-gray-400">{allOn ? 'همه فعال' : 'برخی غیرفعال'}</span>
                      <Toggle value={allOn} onChange={v => toggleAll(cat, v)} />
                    </div>
                  </div>
                  <div className="divide-y divide-gray-100 dark:divide-gray-700">
                    {items.map(n => (
                      <div key={n.key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <Bell className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                          <span className="text-sm text-gray-700 dark:text-gray-300">{n.label}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${rules[n.key] !== false ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
                            {rules[n.key] !== false ? 'فعال' : 'غیرفعال'}
                          </span>
                          <Toggle value={rules[n.key] !== false} onChange={v => setRules(r => ({ ...r, [n.key]: v }))} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex justify-start pt-2">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  Template Guide
// ════════════════════════════════════════════════════════════════════
function TemplateGuide() {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl overflow-hidden">
      <button onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-amber-100/50 dark:hover:bg-amber-900/30 transition-colors">
        <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
          <Info className="w-4 h-4 flex-shrink-0" />
          <span className="text-sm font-medium">راهنمای استفاده از قالب‌های اعلان</span>
        </div>
        <ChevronDown className={`w-4 h-4 text-amber-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-amber-200 dark:border-amber-700 pt-4">
          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
            در عنوان و متن اعلان می‌توانید از متغیرهای زیر استفاده کنید. هنگام ارسال، سیستم این متغیرها را با مقدار واقعی جایگزین می‌کند. برای درج متغیر بنویسید:
            <code className="font-mono bg-amber-100 dark:bg-amber-900/50 px-1 py-0.5 mx-1 rounded text-amber-800 dark:text-amber-200">{'{{نام_متغیر}}'}</code>
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {ALL_PLACEHOLDERS.map(p => (
              <div key={p.key} className="flex items-center gap-2 bg-white dark:bg-gray-800 rounded-xl px-3 py-2">
                <code className="text-xs font-mono text-amber-600 dark:text-amber-400 flex-shrink-0">{`{{${p.key}}}`}</code>
                <span className="text-xs text-gray-400">←</span>
                <span className="text-xs text-gray-700 dark:text-gray-300">{p.label}</span>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-amber-100 dark:border-amber-800">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">نمونه اعلان:</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5 font-semibold">{'عنوان: دعوت به جلسه «{{meeting_subject}}»'}</p>
            <p className="text-xs font-mono text-gray-600 dark:text-gray-400 leading-relaxed">
              {'شما به جلسه «{{meeting_subject}}» در تاریخ {{meeting_date}} ساعت {{meeting_time}} دعوت شده‌اید.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  Template Editor (edit existing)
// ════════════════════════════════════════════════════════════════════
function TemplateEditor({ template, onSave, onCancel }: {
  template: NotificationTemplate; onSave: (t: NotificationTemplate) => void; onCancel: () => void;
}) {
  const [form, setForm] = useState({ ...template });
  const [saving, setSaving] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [activeField, setActiveField] = useState<'title' | 'body'>('body');

  const insertPlaceholder = (ph: string) => {
    if (activeField === 'title') {
      const el = titleRef.current;
      if (el) {
        const s = el.selectionStart ?? form.title.length;
        const e = el.selectionEnd ?? form.title.length;
        const val = form.title.slice(0, s) + `{{${ph}}}` + form.title.slice(e);
        setForm(f => ({ ...f, title: val }));
        setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + ph.length + 4; }, 0);
      }
    } else {
      const el = bodyRef.current;
      if (el) {
        const s = el.selectionStart ?? form.body.length;
        const e = el.selectionEnd ?? form.body.length;
        const val = form.body.slice(0, s) + `{{${ph}}}` + form.body.slice(e);
        setForm(f => ({ ...f, body: val }));
        setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + ph.length + 4; }, 0);
      }
    }
    if (!form.placeholders.includes(ph)) setForm(f => ({ ...f, placeholders: [...f.placeholders, ph] }));
  };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('عنوان اعلان الزامی است'); return; }
    if (!form.body.trim()) { toast.error('متن اعلان نمی‌تواند خالی باشد'); return; }
    setSaving(true);
    const { error } = await supabase.from('notification_templates')
      .update({ title: form.title, body: form.body, icon: form.icon, color: form.color, placeholders: form.placeholders, is_active: form.is_active, updated_at: new Date().toISOString() })
      .eq('id', form.id);
    if (error) { toast.error('خطا در ذخیره قالب'); setSaving(false); return; }
    toast.success('قالب اعلان ذخیره شد');
    invalidateTemplateCache();
    setSaving(false);
    onSave({ ...form });
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-200 dark:border-amber-700 p-6 space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Edit2 className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white text-sm">ویرایش قالب اعلان</h4>
          <p className="text-xs text-gray-400">{NOTIF_CATEGORIES.find(c => c.key === template.category)?.label} — {template.event_type} — {AUDIENCES.find(a => a.key === template.audience)?.label}</p>
        </div>
      </div>

      {/* Placeholder quick-insert */}
      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          درج متغیر در <span className="text-amber-600 dark:text-amber-400 font-semibold">{activeField === 'title' ? 'عنوان' : 'متن'}</span>:
        </p>
        <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
          {ALL_PLACEHOLDERS.map(p => (
            <button key={p.key} type="button" onClick={() => insertPlaceholder(p.key)}
              title={p.label}
              className="text-xs px-2.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 hover:border-amber-300 transition-colors font-mono">
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">عنوان اعلان *</label>
        <input ref={titleRef} className={inp} value={form.title}
          onFocus={() => setActiveField('title')}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="عنوان اعلان" />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">متن اعلان *</label>
          <span className="text-xs text-gray-400">{form.body.length} کاراکتر</span>
        </div>
        <textarea ref={bodyRef} rows={3} className={inp + ' resize-none'}
          onFocus={() => setActiveField('body')}
          value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          placeholder="متن اعلان را وارد کنید..." />
      </div>

      {/* Color + active */}
      <div className="flex flex-wrap gap-4 items-center">
        <div>
          <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">رنگ اعلان:</p>
          <div className="flex gap-2">
            {COLORS.map(c => (
              <button key={c.key} type="button" onClick={() => setForm(f => ({ ...f, color: c.key }))}
                className={`w-6 h-6 rounded-full ${c.cls} transition-transform ${form.color === c.key ? 'scale-125 ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-gray-400' : 'hover:scale-110'}`}
                title={c.label} />
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3 bg-gray-50 dark:bg-gray-700 rounded-xl px-4 py-2.5 mr-auto">
          <span className="text-sm text-gray-600 dark:text-gray-300">قالب فعال باشد</span>
          <Toggle value={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} />
        </div>
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'ذخیره...' : 'ذخیره قالب'}
        </button>
        <button onClick={onCancel} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">
          انصراف
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  New Template Form
// ════════════════════════════════════════════════════════════════════
function NewTemplateForm({ onSave, onCancel }: { onSave: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    category: 'meeting', event_type: '', audience: 'all',
    title: '', body: '', icon: 'bell', color: 'blue',
    placeholders: [] as string[], is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [phInput, setPhInput] = useState('');
  const [activeField, setActiveField] = useState<'title' | 'body'>('body');
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const insertPlaceholder = (ph: string) => {
    if (activeField === 'title') {
      const el = titleRef.current;
      if (el) {
        const s = el.selectionStart ?? form.title.length;
        const e = el.selectionEnd ?? form.title.length;
        setForm(f => ({ ...f, title: f.title.slice(0, s) + `{{${ph}}}` + f.title.slice(e) }));
        setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + ph.length + 4; }, 0);
      }
    } else {
      const el = bodyRef.current;
      if (el) {
        const s = el.selectionStart ?? form.body.length;
        const e = el.selectionEnd ?? form.body.length;
        setForm(f => ({ ...f, body: f.body.slice(0, s) + `{{${ph}}}` + f.body.slice(e) }));
        setTimeout(() => { el.focus(); el.selectionStart = el.selectionEnd = s + ph.length + 4; }, 0);
      }
    }
    if (!form.placeholders.includes(ph)) setForm(f => ({ ...f, placeholders: [...f.placeholders, ph] }));
  };

  const addCustomPh = () => {
    const ph = phInput.trim().replace(/\s+/g, '_');
    if (!ph || form.placeholders.includes(ph)) { setPhInput(''); return; }
    setForm(f => ({ ...f, placeholders: [...f.placeholders, ph] }));
    setPhInput('');
  };

  const removePh = (ph: string) => setForm(f => ({ ...f, placeholders: f.placeholders.filter(p => p !== ph) }));

  const handleSave = async () => {
    if (!form.event_type.trim()) { toast.error('نوع رویداد الزامی است'); return; }
    if (!form.title.trim()) { toast.error('عنوان اعلان الزامی است'); return; }
    if (!form.body.trim()) { toast.error('متن اعلان نمی‌تواند خالی باشد'); return; }
    setSaving(true);
    const { error } = await supabase.from('notification_templates').insert([{ ...form }]);
    if (error) {
      if (error.code === '23505') toast.error('قالبی با این ترکیب از قبل وجود دارد');
      else toast.error('خطا در ذخیره قالب');
      setSaving(false);
      return;
    }
    toast.success('قالب اعلان جدید اضافه شد');
    invalidateTemplateCache();
    setSaving(false);
    onSave();
  };

  const selClass = 'appearance-none ' + inp + ' pl-8';

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-300 dark:border-amber-600 p-6 space-y-5" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Plus className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        </div>
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white text-sm">ایجاد قالب اعلان جدید</h4>
          <p className="text-xs text-gray-400">فیلدهای ستاره‌دار الزامی هستند</p>
        </div>
      </div>

      {/* Category + event + audience */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">دسته *</label>
          <div className="relative">
            <select className={selClass} value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
              {NOTIF_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">نوع رویداد *</label>
          <div className="relative">
            <select className={selClass} value={form.event_type} onChange={e => setForm(f => ({ ...f, event_type: e.target.value }))}>
              <option value="">انتخاب کنید</option>
              {EVENT_TYPES.map(e => <option key={e.key} value={e.key}>{e.label}</option>)}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">مخاطب *</label>
          <div className="relative">
            <select className={selClass} value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}>
              {AUDIENCES.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Placeholder quick-insert */}
      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          درج متغیر در <span className="text-amber-600 dark:text-amber-400 font-semibold">{activeField === 'title' ? 'عنوان' : 'متن'}</span> (کلیک کنید):
        </p>
        <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
          {ALL_PLACEHOLDERS.map(p => (
            <button key={p.key} type="button" onClick={() => insertPlaceholder(p.key)}
              title={p.label}
              className="text-xs px-2.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 text-amber-700 dark:text-amber-400 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/30 hover:border-amber-300 transition-colors font-mono">
              {`{{${p.key}}}`}
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">عنوان اعلان *</label>
        <input ref={titleRef} className={inp} value={form.title}
          onFocus={() => setActiveField('title')}
          onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="مثال: دعوت به جلسه «{{meeting_subject}}»" />
      </div>

      {/* Body */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">متن اعلان *</label>
          <span className="text-xs text-gray-400">{form.body.length} کاراکتر</span>
        </div>
        <textarea ref={bodyRef} rows={3} className={inp + ' resize-none'}
          onFocus={() => setActiveField('body')}
          value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
          placeholder="متن کامل اعلان را بنویسید. برای درج متغیر روی دکمه‌های بالا کلیک کنید..." />
      </div>

      {/* Color */}
      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">رنگ اعلان:</p>
        <div className="flex gap-2.5">
          {COLORS.map(c => (
            <button key={c.key} type="button" onClick={() => setForm(f => ({ ...f, color: c.key }))}
              className={`w-7 h-7 rounded-full ${c.cls} transition-transform ${form.color === c.key ? 'scale-125 ring-2 ring-offset-2 ring-offset-white dark:ring-offset-gray-800 ring-gray-400' : 'hover:scale-110'}`}
              title={c.label} />
          ))}
        </div>
      </div>

      {/* Custom placeholder */}
      <div>
        <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">افزودن متغیر سفارشی:</p>
        <div className="flex gap-2">
          <input className={inp + ' flex-1'} value={phInput} onChange={e => setPhInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustomPh(); } }}
            placeholder="نام_متغیر" dir="ltr" />
          <button type="button" onClick={addCustomPh}
            className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition flex-shrink-0">
            افزودن
          </button>
        </div>
        {form.placeholders.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {form.placeholders.map(ph => (
              <span key={ph} className="flex items-center gap-1 text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded-lg font-mono">
                {`{{${ph}}}`}
                <button onClick={() => removePh(ph)} className="text-amber-400 hover:text-red-500 transition-colors">
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Active */}
      <div className="flex items-center justify-between py-2 px-3 rounded-xl bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600">
        <span className="text-sm text-gray-600 dark:text-gray-300">قالب فعال باشد</span>
        <Toggle value={form.is_active} onChange={v => setForm(f => ({ ...f, is_active: v }))} />
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'در حال ذخیره...' : 'ذخیره قالب'}
        </button>
        <button onClick={onCancel} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">
          انصراف
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 2 — Templates list
// ════════════════════════════════════════════════════════════════════

const audienceLabel: Record<string, string> = {
  participants: 'شرکت‌کنندگان', observers: 'مطلعین', external: 'خارج سازمان', all: 'همه',
};
const eventLabel: Record<string, string> = {
  invite: 'دعوت', change: 'تغییر', cancel: 'لغو', reminder: 'یادآور',
  assign: 'تخصیص', complete: 'تکمیل', event_invite: 'دعوت رویداد',
  mention: 'منشن', message: 'پیام', share: 'اشتراک', alert: 'هشدار', custom: 'سفارشی',
};

const AUDIENCE_COLORS: Record<string, string> = {
  all:          'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  participants: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
  observers:    'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',
  external:     'bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400',
};

function TemplatesTab() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<NotificationTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [filterCat, setFilterCat] = useState('all');
  const [filterAudience, setFilterAudience] = useState('all');
  const [previewTemplate, setPreviewTemplate] = useState<NotificationTemplate | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('notification_templates').select('*').order('category').order('event_type').order('audience');
    setTemplates((data || []) as NotificationTemplate[]);
    setLoading(false);
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

  // Group by category → audience
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
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Category filter */}
          <div className="relative">
            <select value={filterCat} onChange={e => setFilterCat(e.target.value)} className={selBase}>
              <option value="all">همه دسته‌ها</option>
              {NOTIF_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
          {/* Audience filter */}
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

      {/* Audience legend */}
      <div className="flex flex-wrap gap-2">
        {AUDIENCES.map(a => (
          <button key={a.key} onClick={() => setFilterAudience(filterAudience === a.key ? 'all' : a.key)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border font-medium transition-all ${filterAudience === a.key || filterAudience === 'all' ? AUDIENCE_COLORS[a.key] + ' border-transparent' : 'border-gray-200 dark:border-gray-600 text-gray-400'}`}>
            <Users className="w-3 h-3" />{a.label}
          </button>
        ))}
      </div>

      {/* Guide */}
      <TemplateGuide />

      {loading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}

      {/* Grouped display */}
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
            {/* Category header */}
            <div className="flex items-center gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${COLOR_BADGE[NOTIF_CATEGORIES.find(c=>c.key===cat)?.key || 'system'] || 'bg-gray-100 text-gray-500'}`}>
                {NOTIF_CATEGORIES.find(c => c.key === cat)?.label || cat}
              </span>
              <span className="text-xs text-gray-400">{Object.values(audienceMap).flat().length} قالب</span>
            </div>

            {/* Audience groups inside this category */}
            {audienceOrder.filter(aud => audienceMap[aud]?.length).map(aud => (
              <div key={aud}>
                {/* Audience sub-header */}
                <div className={`flex items-center gap-2 px-4 py-2 text-xs font-medium border-b border-gray-50 dark:border-gray-700/50 ${AUDIENCE_COLORS[aud]}`}>
                  <Users className="w-3 h-3" />
                  {audienceLabel[aud]}
                  <span className="mr-auto text-xs opacity-70">{audienceMap[aud].length} قالب</span>
                </div>
                {/* Templates in this audience */}
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

// ════════════════════════════════════════════════════════════════════
//  Notification Template Preview Modal
// ════════════════════════════════════════════════════════════════════

const NOTIF_SAMPLE_VALUES: Record<string, string> = {
  full_name: 'سارا احمدی',
  meeting_subject: 'جلسه هماهنگی پروژه',
  meeting_date: '۱۵/۳/۱۴۰۵',
  meeting_time: '۰۹:۰۰-۱۰:۰۰',
  location: 'اتاق کنفرانس A',
  location_part: ' | اتاق کنفرانس A',
  representative: 'رضا کریمی',
  minutes: '۱۵',
  task_title: 'بررسی گزارش هفتگی',
  priority: 'بالا',
  due_date: '۲۰/۳/۱۴۰۵',
  event_title: 'جشن سالگرد تأسیس',
  event_date: '۲۵/۳/۱۴۰۵',
  sender_name: 'علی محمدی',
  note_title: 'یادداشت جلسه هیئت مدیره',
  message_preview: 'سلام، آیا گزارش آماده شده؟',
  alert_message: 'خرابی موقت در سرویس ایمیل',
  join_link: 'https://example.com?conference=ABC-DEF-GHI',
  agenda: '۱. بررسی پیشرفت پروژه | ارائه‌دهنده: علی محمدی | ۲۰ دقیقه\n۲. تخصیص منابع | ۱۵ دقیقه',
};

function fillNotifPreview(text: string, customVars: Record<string, string>): string {
  const vars = { ...NOTIF_SAMPLE_VALUES, ...customVars };
  return text.replace(/\{\{(\w+)\}\}/g, (_m, k) => (vars[k] !== undefined ? vars[k] : `{{${k}}}`));
}

interface NotifPreviewModalProps {
  template: NotificationTemplate;
  onClose: () => void;
}

function NotifPreviewModal({ template, onClose }: NotifPreviewModalProps) {
  const [customVars, setCustomVars] = useState<Record<string, string>>({});

  const allKeys = Array.from(new Set([
    ...(template.placeholders || []),
    ...Array.from((template.title + ' ' + template.body).matchAll(/\{\{(\w+)\}\}/g), m => m[1]),
  ]));

  const previewTitle = fillNotifPreview(template.title, customVars);
  const previewBody  = fillNotifPreview(template.body, customVars);
  const colorDot = COLORS.find(c => c.key === template.color);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" dir="rtl">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg border border-gray-200 dark:border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-800 dark:text-white text-sm flex items-center gap-2">
            <Eye className="w-4 h-4 text-amber-500" />پیش‌نمایش قالب اعلان
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Meta badges */}
          <div className="flex flex-wrap gap-1.5">
            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${COLOR_BADGE[template.color] || COLOR_BADGE['gray']}`}>
              {NOTIF_CATEGORIES.find(c => c.key === template.category)?.label || template.category}
            </span>
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-2.5 py-1 rounded-full">
              {eventLabel[template.event_type] || template.event_type}
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full ${AUDIENCE_COLORS[template.audience] || AUDIENCE_COLORS.all}`}>
              {audienceLabel[template.audience] || template.audience}
            </span>
          </div>

          {/* Editable sample values */}
          {allKeys.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">مقادیر نمونه (قابل تغییر):</p>
              <div className="grid grid-cols-1 gap-2 max-h-44 overflow-y-auto">
                {allKeys.map(key => (
                  <div key={key} className="flex items-center gap-2">
                    <code className="text-xs text-amber-600 dark:text-amber-400 font-mono bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded w-36 shrink-0 truncate">{`{{${key}}}`}</code>
                    <input
                      type="text"
                      value={customVars[key] ?? (NOTIF_SAMPLE_VALUES[key] || '')}
                      onChange={e => setCustomVars(v => ({ ...v, [key]: e.target.value }))}
                      className="flex-1 text-xs px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-500"
                      placeholder={`مقدار {{${key}}}`}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rendered notification card preview */}
          <div>
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">خروجی اعلان:</p>
            <div className={`rounded-xl border p-4 space-y-1.5 ${COLOR_BADGE[template.color] || ''} bg-opacity-20`}>
              <div className="flex items-start gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-1 ${colorDot?.cls || 'bg-gray-400'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 dark:text-white leading-snug">{previewTitle || '—'}</p>
                  <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed whitespace-pre-wrap">{previewBody || '—'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 3 — Notification Logs
// ════════════════════════════════════════════════════════════════════

interface NotifLog {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
  sender_name: string | null;
  action_url: string | null;
  // joined from profiles
  recipient_name?: string;
  recipient_email?: string;
}

function LogsTab() {
  const [logs, setLogs] = useState<NotifLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterType, setFilterType] = useState('all');
  const [filterRead, setFilterRead] = useState('all');
  const [filterDate, setFilterDate] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('notifications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    if (filterType !== 'all') q = q.eq('type', filterType);
    if (filterRead === 'read') q = q.eq('read', true);
    if (filterRead === 'unread') q = q.eq('read', false);
    if (filterDate) {
      const start = new Date(filterDate); start.setHours(0, 0, 0, 0);
      const end = new Date(filterDate); end.setHours(23, 59, 59, 999);
      q = q.gte('created_at', start.toISOString()).lte('created_at', end.toISOString());
    }

    const { data, count } = await q;
    if (!data) { setLoading(false); return; }

    // Batch fetch recipient profiles
    const userIds = Array.from(new Set((data as any[]).map(r => r.user_id).filter(Boolean)));
    let profileMap: Record<string, { full_name: string; email: string }> = {};
    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('user_id, full_name, email').in('user_id', userIds);
      for (const p of (profiles || [])) {
        profileMap[p.user_id] = { full_name: p.full_name || '', email: p.email || '' };
      }
    }

    setLogs((data as any[]).map(r => ({
      ...r,
      recipient_name: profileMap[r.user_id]?.full_name || '',
      recipient_email: profileMap[r.user_id]?.email || '',
    })));
    setTotalCount(count || 0);
    setLoading(false);
  }, [page, filterType, filterRead, filterDate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(0); }, [filterType, filterRead, filterDate]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  const typeLabel = (t: string) => NOTIF_CATEGORIES.find(c => c.key === t)?.label || t;

  const TYPE_COLORS: Record<string, string> = {
    meeting:  'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    task:     'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    chat:     'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400',
    channel:  'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',
    calendar: 'bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400',
    note:     'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400',
    system:   'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
  };

  const formatDate = (iso: string) => {
    const m = moment(iso);
    return `${m.jYear()}/${String(m.jMonth()+1).padStart(2,'0')}/${String(m.jDate()).padStart(2,'0')} ${String(m.hours()).padStart(2,'0')}:${String(m.minutes()).padStart(2,'0')}`;
  };

  // Stats
  const readCount = logs.filter(l => l.read).length;
  const unreadCount = logs.filter(l => !l.read).length;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'کل اعلان‌ها', value: totalCount, icon: Bell, color: 'text-amber-500 bg-amber-50 dark:bg-amber-900/20' },
          { label: 'خوانده‌شده', value: readCount, icon: CheckCircle, color: 'text-green-500 bg-green-50 dark:bg-green-900/20' },
          { label: 'خوانده‌نشده', value: unreadCount, icon: Clock, color: 'text-red-500 bg-red-50 dark:bg-red-900/20' },
        ].map(s => (
          <div key={s.label} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color}`}>
              <s.icon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xl font-bold text-gray-800 dark:text-white">{s.value}</p>
              <p className="text-xs text-gray-400">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-36">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">دسته‌بندی</label>
          <div className="relative">
            <select value={filterType} onChange={e => setFilterType(e.target.value)}
              className="appearance-none w-full text-sm pr-3 pl-7 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="all">همه دسته‌ها</option>
              {NOTIF_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div className="flex-1 min-w-32">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">وضعیت خواندن</label>
          <div className="relative">
            <select value={filterRead} onChange={e => setFilterRead(e.target.value)}
              className="appearance-none w-full text-sm pr-3 pl-7 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500">
              <option value="all">همه</option>
              <option value="read">خوانده‌شده</option>
              <option value="unread">خوانده‌نشده</option>
            </select>
            <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div className="flex-1 min-w-36">
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">تاریخ</label>
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
            className="w-full text-sm px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500" />
        </div>
        <div className="flex gap-2">
          {filterDate && (
            <button onClick={() => setFilterDate('')}
              className="px-3 py-2 text-xs bg-gray-100 dark:bg-gray-700 hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-500 hover:text-red-500 rounded-xl transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={() => load()} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}
        {!loading && logs.length === 0 && (
          <div className="py-14 text-center">
            <Bell className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">اعلانی یافت نشد</p>
          </div>
        )}
        {!loading && logs.length > 0 && (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {logs.map(log => (
              <div key={log.id}>
                <div
                  className="flex items-start gap-3 px-4 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer transition-colors"
                  onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                >
                  {/* Read indicator */}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-2 ${log.read ? 'bg-gray-300 dark:bg-gray-600' : 'bg-amber-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[log.type] || TYPE_COLORS.system}`}>
                        {typeLabel(log.type)}
                      </span>
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-200 truncate">{log.title}</span>
                      {!log.read && <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full">جدید</span>}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-1">{log.message}</p>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {log.recipient_name || log.recipient_email || log.user_id.slice(0, 8) + '…'}
                      </span>
                      {log.sender_name && (
                        <span className="text-xs text-gray-400">از: {log.sender_name}</span>
                      )}
                      <span className="text-xs text-gray-300 dark:text-gray-500">{formatDate(log.created_at)}</span>
                    </div>
                  </div>
                  <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 mt-1 transition-transform ${expandedId === log.id ? 'rotate-180' : ''}`} />
                </div>

                {/* Expanded detail */}
                {expandedId === log.id && (
                  <div className="px-4 pb-4 pt-1 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-100 dark:border-gray-700 text-xs space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <span className="text-gray-400">دریافت‌کننده:</span>
                        <span className="mr-2 font-medium text-gray-700 dark:text-gray-200">{log.recipient_name || '—'}</span>
                        {log.recipient_email && <span className="text-gray-400 text-[11px]">({log.recipient_email})</span>}
                      </div>
                      <div>
                        <span className="text-gray-400">فرستنده:</span>
                        <span className="mr-2 font-medium text-gray-700 dark:text-gray-200">{log.sender_name || '—'}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">نوع:</span>
                        <span className="mr-2 font-medium text-gray-700 dark:text-gray-200">{typeLabel(log.type)}</span>
                      </div>
                      <div>
                        <span className="text-gray-400">وضعیت:</span>
                        <span className={`mr-2 font-medium ${log.read ? 'text-green-600 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                          {log.read ? 'خوانده‌شده' : 'خوانده‌نشده'}
                        </span>
                      </div>
                    </div>
                    <div>
                      <span className="text-gray-400">متن اعلان:</span>
                      <p className="mt-1 text-gray-700 dark:text-gray-200 leading-relaxed bg-white dark:bg-gray-800 rounded-lg p-2.5 border border-gray-100 dark:border-gray-600">{log.message}</p>
                    </div>
                    {log.action_url && (
                      <div>
                        <span className="text-gray-400">لینک:</span>
                        <span className="mr-2 font-mono text-gray-600 dark:text-gray-300">{log.action_url}</span>
                      </div>
                    )}
                    <div>
                      <span className="text-gray-400">زمان:</span>
                      <span className="mr-2 font-medium text-gray-700 dark:text-gray-200">{formatDate(log.created_at)}</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-gray-400 text-xs">{totalCount} اعلان — صفحه {page + 1} از {totalPages}</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 text-gray-600 dark:text-gray-300 transition-colors">
              <ChevronRight className="w-4 h-4" />
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 text-gray-600 dark:text-gray-300 transition-colors">
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  Main export
// ════════════════════════════════════════════════════════════════════
export function NotificationsConfigPanel() {
  const [tab, setTab] = useState<'groups' | 'templates' | 'logs'>('groups');

  return (
    <div className="space-y-4" dir="rtl">
      <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
        <Bell className="w-5 h-5 text-amber-500" />تنظیمات اعلان‌ها
      </h3>

      {/* Tab bar */}
      <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1 gap-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key as any)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${tab === key ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'groups'    && <GroupsTab />}
      {tab === 'templates' && <TemplatesTab />}
      {tab === 'logs'      && <LogsTab />}
    </div>
  );
}
