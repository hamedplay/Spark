import { useCallback, useEffect, useState } from 'react';
import { Clock3, Loader2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';

const WEEKDAYS = [
  { key: 'sat', label: 'شنبه' },
  { key: 'sun', label: 'یکشنبه' },
  { key: 'mon', label: 'دوشنبه' },
  { key: 'tue', label: 'سه‌شنبه' },
  { key: 'wed', label: 'چهارشنبه' },
  { key: 'thu', label: 'پنجشنبه' },
  { key: 'fri', label: 'جمعه' },
] as const;

const ALL_DAYS = WEEKDAYS.map(day => day.key);
const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

type ScheduleKey = 'decision_due' | 'periodic_followup';
interface ScheduleValue {
  enabled: boolean;
  time: string;
  weekdays: string[];
}

const DEFAULT_VALUE: ScheduleValue = { enabled: true, time: '09:00', weekdays: ALL_DAYS };

const META: Record<ScheduleKey, { title: string; description: string }> = {
  decision_due: {
    title: 'سررسید و تأخیر مصوبات',
    description: 'برای اعلان‌های «نزدیک‌شدن سررسید» و «عبور از مهلت».',
  },
  periodic_followup: {
    title: 'پیگیری دوره‌ای مصوبات',
    description: 'برای پیگیری‌های هفتگی و ماهانه مصوباتی که باید دوباره در دستور جلسه مطرح شوند.',
  },
};

export function DecisionScheduleTab() {
  const [values, setValues] = useState<Record<ScheduleKey, ScheduleValue>>({
    decision_due: { ...DEFAULT_VALUE, weekdays: [...ALL_DAYS] },
    periodic_followup: { ...DEFAULT_VALUE, weekdays: [...ALL_DAYS] },
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<ScheduleKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('system_config')
        .select('key,value')
        .eq('section', 'minutes')
        .in('key', [
          'decision_due_schedule_enabled', 'decision_due_schedule_time', 'decision_due_schedule_weekdays',
          'periodic_followup_schedule_enabled', 'periodic_followup_schedule_time', 'periodic_followup_schedule_weekdays',
        ]);
      if (error) throw error;
      const map = new Map((data || []).map(row => [row.key, row.value || '']));
      const read = (key: ScheduleKey): ScheduleValue => {
        const rawTime = map.get(`${key}_schedule_time`) || '09:00';
        const rawDays = (map.get(`${key}_schedule_weekdays`) || ALL_DAYS.join(','))
          .split(',').filter(day => ALL_DAYS.includes(day as typeof ALL_DAYS[number]));
        return {
          enabled: (map.get(`${key}_schedule_enabled`) || 'true') !== 'false',
          time: TIME_RE.test(rawTime) ? rawTime : '09:00',
          weekdays: rawDays.length ? ALL_DAYS.filter(day => rawDays.includes(day)) : [...ALL_DAYS],
        };
      };
      setValues({ decision_due: read('decision_due'), periodic_followup: read('periodic_followup') });
    } catch {
      toast.error('بارگذاری زمان‌بندی اعلان‌های مصوبات ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = (key: ScheduleKey, patch: Partial<ScheduleValue>) =>
    setValues(current => ({ ...current, [key]: { ...current[key], ...patch } }));

  const toggleDay = (key: ScheduleKey, day: string) => {
    const current = values[key].weekdays;
    const next = current.includes(day) ? current.filter(item => item !== day) : ALL_DAYS.filter(item => current.includes(item) || item === day);
    update(key, { weekdays: next });
  };

  const save = async (key: ScheduleKey) => {
    const value = values[key];
    if (!TIME_RE.test(value.time)) {
      toast.error('ساعت باید در قالب HH:mm باشد');
      return;
    }
    if (value.weekdays.length === 0) {
      toast.error('حداقل یک روز هفته را انتخاب کنید');
      return;
    }
    if (saving) return;
    setSaving(key);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id || null;
      const now = new Date().toISOString();
      const rows = [
        { section: 'minutes', key: `${key}_schedule_enabled`, value: String(value.enabled), value_type: 'boolean', label: `فعال بودن ${META[key].title}`, updated_by: userId, updated_at: now },
        { section: 'minutes', key: `${key}_schedule_time`, value: value.time, value_type: 'time', label: `ساعت ${META[key].title}`, updated_by: userId, updated_at: now },
        { section: 'minutes', key: `${key}_schedule_weekdays`, value: ALL_DAYS.filter(day => value.weekdays.includes(day)).join(','), value_type: 'weekdays', label: `روزهای ${META[key].title}`, updated_by: userId, updated_at: now },
      ];
      const { error } = await supabase.from('system_config').upsert(rows, { onConflict: 'section,key' });
      if (error) throw error;
      logAudit({
        module: 'system_config', action: 'config_updated', entity_name: `minutes.${key}_schedule`,
        details: `enabled=${value.enabled}; time=${value.time}; weekdays=${value.weekdays.join(',')}`, severity: 'info',
      });
      toast.success('زمان‌بندی ذخیره شد');
    } catch {
      toast.error('ذخیره زمان‌بندی ناموفق بود');
    } finally {
      setSaving(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="ml-2 h-5 w-5 animate-spin" />در حال بارگذاری...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300">
        <div className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4" />منطقه زمانی: تهران (Asia/Tehran)</div>
        <p className="mt-1 text-xs leading-6">این بخش زمان ایجاد و اجرای رویدادهای خودکار مصوبات را کنترل می‌کند؛ زمان تحویل SMS آن رویدادها از تب «زمان‌بندی پیامک» مدیریت می‌شود. یادآور دستی کاربر مستقل است.</p>
      </div>

      {(Object.keys(META) as ScheduleKey[]).map(key => {
        const value = values[key];
        return (
          <section key={key} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h4 className="font-bold text-gray-900 dark:text-white">{META[key].title}</h4>
                <p className="mt-1 text-xs leading-6 text-gray-500 dark:text-gray-400">{META[key].description}</p>
              </div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input type="checkbox" checked={value.enabled} onChange={event => update(key, { enabled: event.target.checked })} className="h-4 w-4 accent-amber-500" />
                فعال
              </label>
            </div>

            <div className="mt-5 grid gap-5 lg:grid-cols-[180px_1fr]">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">ساعت اجرای رویداد</label>
                <input type="time" value={value.time} onChange={event => update(key, { time: event.target.value })}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">روزهای مجاز ارسال</label>
                <div className="flex flex-wrap gap-2">
                  {WEEKDAYS.map(day => {
                    const selected = value.weekdays.includes(day.key);
                    return <button key={day.key} type="button" onClick={() => toggleDay(key, day.key)}
                      className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${selected ? 'border-amber-400 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'border-gray-200 text-gray-500 dark:border-gray-700 dark:text-gray-400'}`}>
                      {day.label}
                    </button>;
                  })}
                </div>
              </div>
            </div>

            <div className="mt-5 flex justify-end">
              <button type="button" disabled={saving !== null} onClick={() => void save(key)}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-50">
                {saving === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                ذخیره تنظیمات
              </button>
            </div>
          </section>
        );
      })}
    </div>
  );
}
