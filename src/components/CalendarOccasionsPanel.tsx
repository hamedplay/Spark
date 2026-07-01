import { useState, useEffect, useCallback, useRef } from 'react';
import { CalendarDays, Plus, Trash2, CreditCard as Edit2, Download, Upload, ChevronDown, Check, Loader as Loader2, Save, RefreshCw, Sun, Moon, Star, CircleAlert as AlertCircle, MoveVertical as MoreVertical, Copy, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';

interface Occasion {
  id: string;
  title: string;
  calendar_type: 'shamsi' | 'ghamari';
  month: number;
  day: number;
  is_holiday: boolean;
  is_celebration: boolean;
  is_active: boolean;
  created_at: string;
}

const SHAMSI_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
const GHAMARI_MONTHS = ['محرم','صفر','ربیع‌الاول','ربیع‌الثانی','جمادی‌الاول','جمادی‌الثانی','رجب','شعبان','رمضان','شوال','ذیقعده','ذیحجه'];

const inp = 'w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm';
const sel = 'appearance-none ' + inp;

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`w-9 h-[18px] rounded-full relative transition-colors shrink-0 ${value ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
      <span className={`absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`} />
    </button>
  );
}

function OccasionForm({ initial, onSave, onCancel }: {
  initial?: Partial<Occasion>; onSave: () => void; onCancel: () => void;
}) {
  const blank: Partial<Occasion> = { title: '', calendar_type: 'shamsi', month: 1, day: 1, is_holiday: false, is_celebration: false, is_active: true };
  const [form, setForm] = useState<Partial<Occasion>>(initial ? { ...initial } : blank);
  const [saving, setSaving] = useState(false);
  const s = (k: keyof Occasion, v: any) => setForm(f => ({ ...f, [k]: v }));

  const months = form.calendar_type === 'shamsi' ? SHAMSI_MONTHS : GHAMARI_MONTHS;
  const maxDay = form.calendar_type === 'shamsi' ? (form.month! <= 6 ? 31 : form.month! <= 11 ? 30 : 29) : 30;

  const handleSave = async () => {
    if (!form.title?.trim()) { toast.error('عنوان الزامی است'); return; }
    setSaving(true);
    if (form.id) {
      const { error } = await supabase.from('calendar_occasions')
        .update({ title: form.title, calendar_type: form.calendar_type, month: form.month, day: form.day, is_holiday: form.is_holiday, is_celebration: form.is_celebration, is_active: form.is_active, updated_at: new Date().toISOString() })
        .eq('id', form.id);
      if (error) { toast.error('خطا در ذخیره'); setSaving(false); return; }
      toast.success('مناسبت ویرایش شد');
    } else {
      const { error } = await supabase.from('calendar_occasions')
        .insert([{ title: form.title, calendar_type: form.calendar_type, month: form.month, day: form.day, is_holiday: form.is_holiday, is_celebration: form.is_celebration, is_active: form.is_active }]);
      if (error) { toast.error('خطا در افزودن'); setSaving(false); return; }
      toast.success('مناسبت افزوده شد');
    }
    setSaving(false);
    onSave();
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-blue-200 dark:border-blue-700 p-5 space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
          {form.id ? <Edit2 className="w-4 h-4 text-blue-600" /> : <Plus className="w-4 h-4 text-blue-600" />}
        </div>
        <div>
          <h4 className="font-bold text-gray-800 dark:text-white text-sm">{form.id ? 'ویرایش مناسبت' : 'افزودن مناسبت'}</h4>
          <p className="text-xs text-gray-400">فیلدهای ستاره‌دار الزامی هستند</p>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">عنوان *</label>
        <input className={inp} value={form.title || ''} onChange={e => s('title', e.target.value)} placeholder="مثال: عید نوروز" />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">نوع تقویم *</label>
          <div className="relative">
            <select className={sel} value={form.calendar_type} onChange={e => { s('calendar_type', e.target.value); s('day', 1); }}>
              <option value="shamsi">شمسی</option>
              <option value="ghamari">قمری</option>
            </select>
            <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">ماه *</label>
          <div className="relative">
            <select className={sel} value={form.month} onChange={e => { s('month', Number(e.target.value)); s('day', 1); }}>
              {months.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
            </select>
            <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">روز *</label>
          <div className="relative">
            <select className={sel} value={form.day} onChange={e => s('day', Number(e.target.value))}>
              {Array.from({ length: maxDay }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <label className="flex items-center justify-between gap-2 bg-red-50 dark:bg-red-900/20 rounded-xl px-3 py-2.5 cursor-pointer">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            <span className="text-xs text-gray-700 dark:text-gray-300">تعطیل است؟</span>
          </div>
          <Toggle value={!!form.is_holiday} onChange={v => s('is_holiday', v)} />
        </label>
        <label className="flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-900/20 rounded-xl px-3 py-2.5 cursor-pointer">
          <div className="flex items-center gap-2">
            <Star className="w-3.5 h-3.5 text-amber-500 shrink-0" />
            <span className="text-xs text-gray-700 dark:text-gray-300">جشن است؟</span>
          </div>
          <Toggle value={!!form.is_celebration} onChange={v => s('is_celebration', v)} />
        </label>
        <label className="flex items-center justify-between gap-2 bg-green-50 dark:bg-green-900/20 rounded-xl px-3 py-2.5 cursor-pointer">
          <div className="flex items-center gap-2">
            <Check className="w-3.5 h-3.5 text-green-500 shrink-0" />
            <span className="text-xs text-gray-700 dark:text-gray-300">فعال</span>
          </div>
          <Toggle value={!!form.is_active} onChange={v => s('is_active', v)} />
        </label>
      </div>

      <div className="flex gap-3 pt-1">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition shadow-xs">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'ذخیره...' : 'ذخیره'}
        </button>
        <button onClick={onCancel} className="px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">
          انصراف
        </button>
      </div>
    </div>
  );
}

function RowMenu({ onEdit, onDelete, onDuplicate }: { onEdit: () => void; onDelete: () => void; onDuplicate: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(v => !v)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 transition-colors">
        <MoreVertical className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-32 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1">
          <button onClick={() => { onEdit(); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-right">
            <Edit2 className="w-3.5 h-3.5 text-blue-500" />ویرایش
          </button>
          <button onClick={() => { onDuplicate(); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 text-right">
            <Copy className="w-3.5 h-3.5 text-green-500" />تکثیر
          </button>
          <div className="border-t border-gray-100 dark:border-gray-700 my-1" />
          <button onClick={() => { onDelete(); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 text-right">
            <Trash2 className="w-3.5 h-3.5" />حذف
          </button>
        </div>
      )}
    </div>
  );
}

export function CalendarOccasionsPanel() {
  const [occasions, setOccasions] = useState<Occasion[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'shamsi' | 'ghamari'>('all');
  const [filterHoliday, setFilterHoliday] = useState<'all' | 'yes' | 'no'>('all');
  const [editing, setEditing] = useState<Occasion | null>(null);
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState<Partial<Occasion> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('calendar_occasions').select('*').order('calendar_type').order('month').order('day');
    setOccasions((data || []) as Occasion[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const deleteOccasion = async (id: string) => {
    await supabase.from('calendar_occasions').delete().eq('id', id);
    setOccasions(os => os.filter(o => o.id !== id));
    toast.success('مناسبت حذف شد');
  };

  const toggleActive = async (o: Occasion) => {
    await supabase.from('calendar_occasions').update({ is_active: !o.is_active }).eq('id', o.id);
    setOccasions(os => os.map(x => x.id === o.id ? { ...x, is_active: !o.is_active } : x));
  };

  const filtered = occasions.filter(o => {
    if (filterType !== 'all' && o.calendar_type !== filterType) return false;
    if (filterHoliday === 'yes' && !o.is_holiday) return false;
    if (filterHoliday === 'no' && o.is_holiday) return false;
    if (search.trim()) {
      const q = search.trim();
      const months = o.calendar_type === 'shamsi' ? SHAMSI_MONTHS : GHAMARI_MONTHS;
      if (!o.title.includes(q) && !months[o.month - 1]?.includes(q)) return false;
    }
    return true;
  });

  const exportXlsx = () => {
    const rows = occasions.map(o => ({
      عنوان: o.title,
      'نوع تقویم': o.calendar_type === 'shamsi' ? 'شمسی' : 'قمری',
      ماه: o.month,
      روز: o.day,
      تعطیل: o.is_holiday ? 'بله' : 'خیر',
      جشن: o.is_celebration ? 'بله' : 'خیر',
      وضعیت: o.is_active ? 'فعال' : 'غیرفعال',
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'مناسبت‌ها');
    XLSX.writeFile(wb, 'calendar_occasions.xlsx');
    toast.success('فایل دانلود شد');
  };

  const importXlsx = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: 'array' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows: any[] = XLSX.utils.sheet_to_json(ws);
        const inserts = rows.map(r => ({
          title: String(r['عنوان'] || r.title || '').trim(),
          calendar_type: String(r['نوع تقویم'] || '').includes('قمری') ? 'ghamari' : 'shamsi',
          month: Number(r['ماه'] || r.month || 1),
          day: Number(r['روز'] || r.day || 1),
          is_holiday: String(r['تعطیل'] || '').includes('بله') || r.is_holiday === true,
          is_celebration: String(r['جشن'] || '').includes('بله') || r.is_celebration === true,
          is_active: String(r['وضعیت'] || 'فعال') !== 'غیرفعال',
        })).filter(r => r.title && r.month >= 1 && r.month <= 12 && r.day >= 1 && r.day <= 31);
        if (!inserts.length) { toast.error('ردیف معتبری یافت نشد'); return; }
        const { error } = await supabase.from('calendar_occasions').insert(inserts);
        if (error) { toast.error('خطا در وارد کردن'); return; }
        toast.success(`${inserts.length} مناسبت وارد شد`);
        load();
      } catch { toast.error('فایل نامعتبر است'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const monthLabel = (o: Occasion) => (o.calendar_type === 'shamsi' ? SHAMSI_MONTHS : GHAMARI_MONTHS)[o.month - 1] || String(o.month);

  if (editing) return <OccasionForm initial={editing} onSave={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />;
  if (creating) return <OccasionForm onSave={() => { setCreating(false); load(); }} onCancel={() => setCreating(false)} />;
  if (duplicating) return <OccasionForm initial={duplicating} onSave={() => { setDuplicating(null); load(); }} onCancel={() => setDuplicating(null)} />;

  return (
    <div className="space-y-4" dir="rtl">
      {/* Toolbar */}
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex flex-wrap gap-2 flex-1 min-w-0">
          <div className="relative flex-1 min-w-40 max-w-xs">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input className="w-full pr-9 pl-3 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-blue-500 text-sm"
              placeholder="جستجو..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="relative">
            <select value={filterType} onChange={e => setFilterType(e.target.value as any)}
              className="appearance-none text-sm pr-3 pl-7 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500">
              <option value="all">همه</option>
              <option value="shamsi">شمسی</option>
              <option value="ghamari">قمری</option>
            </select>
            <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select value={filterHoliday} onChange={e => setFilterHoliday(e.target.value as any)}
              className="appearance-none text-sm pr-3 pl-7 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-hidden focus:ring-2 focus:ring-blue-500">
              <option value="all">همه روزها</option>
              <option value="yes">تعطیل</option>
              <option value="no">غیرتعطیل</option>
            </select>
            <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={importXlsx} />
          <button onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-sm transition">
            <Upload className="w-4 h-4" />ورود
          </button>
          <button onClick={exportXlsx} className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 rounded-xl text-sm transition">
            <Download className="w-4 h-4" />خروج
          </button>
          <button onClick={() => setCreating(true)} className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition">
            <Plus className="w-4 h-4" />افزودن مناسبت
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1 rounded-full">{occasions.length} مناسبت</span>
        <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-3 py-1 rounded-full">{occasions.filter(o => o.calendar_type === 'shamsi').length} شمسی</span>
        <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-3 py-1 rounded-full">{occasions.filter(o => o.calendar_type === 'ghamari').length} قمری</span>
        <span className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-3 py-1 rounded-full">{occasions.filter(o => o.is_holiday).length} تعطیل</span>
        <span className="bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-3 py-1 rounded-full">{occasions.filter(o => o.is_celebration).length} جشن</span>
        {filtered.length !== occasions.length && (
          <span className="bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 px-3 py-1 rounded-full">{filtered.length} نتیجه</span>
        )}
      </div>

      {loading && <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}

      {!loading && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="grid grid-cols-[28px_1fr_80px_100px_64px_64px_64px_40px] gap-x-2 px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400">
            <span>#</span>
            <span>عنوان</span>
            <span className="text-center">نوع</span>
            <span className="text-center">ماه / روز</span>
            <span className="text-center">تعطیل</span>
            <span className="text-center">جشن</span>
            <span className="text-center">وضعیت</span>
            <span></span>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {filtered.map((o, idx) => (
              <div key={o.id} className={`grid grid-cols-[28px_1fr_80px_100px_64px_64px_64px_40px] gap-x-2 px-4 py-2.5 items-center hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors ${!o.is_active ? 'opacity-50' : ''}`}>
                <span className="text-xs text-gray-300 dark:text-gray-600">{idx + 1}</span>
                <div className="flex items-center gap-2 min-w-0">
                  {o.calendar_type === 'shamsi' ? <Sun className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <Moon className="w-3.5 h-3.5 text-blue-400 shrink-0" />}
                  <span className="text-sm text-gray-800 dark:text-gray-200 truncate">{o.title}</span>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium text-center ${o.calendar_type === 'shamsi' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400'}`}>
                  {o.calendar_type === 'shamsi' ? 'شمسی' : 'قمری'}
                </span>
                <span className="text-xs text-gray-600 dark:text-gray-400 text-center">{monthLabel(o)} / {o.day}</span>
                <span className={`text-xs text-center ${o.is_holiday ? 'text-red-500 font-medium' : 'text-gray-300 dark:text-gray-600'}`}>{o.is_holiday ? 'تعطیل' : '—'}</span>
                <span className={`text-xs text-center ${o.is_celebration ? 'text-amber-500 font-medium' : 'text-gray-300 dark:text-gray-600'}`}>{o.is_celebration ? 'جشن' : '—'}</span>
                <div className="flex justify-center"><Toggle value={o.is_active} onChange={() => toggleActive(o)} /></div>
                <RowMenu
                  onEdit={() => setEditing(o)}
                  onDelete={() => deleteOccasion(o.id)}
                  onDuplicate={() => { const { id, created_at, ...rest } = o; setDuplicating({ ...rest, title: rest.title + ' (کپی)' }); }}
                />
              </div>
            ))}
          </div>
          {filtered.length === 0 && (
            <div className="py-12 text-center">
              <CalendarDays className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-gray-400 text-sm mb-2">مناسبتی یافت نشد</p>
              <button onClick={() => setCreating(true)} className="text-sm text-blue-500 hover:text-blue-600 font-medium">افزودن مناسبت</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
