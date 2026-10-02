import { useCallback, useEffect, useState } from 'react';
import { Clock4, Loader2, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';

const TIME_RE = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

const EVENTS = [
  { key: 'meeting_created', label: 'ثبت جلسه' },
  { key: 'invite', label: 'دعوت به جلسه' },
  { key: 'meeting_confirmed', label: 'تأیید حضور در جلسه' },
  { key: 'meeting_declined', label: 'رد حضور در جلسه' },
  { key: 'change', label: 'تغییر جلسه' },
  { key: 'cancel', label: 'لغو جلسه' },
  { key: 'reminder', label: 'یادآور جلسه' },
  { key: 'meeting_representative_assigned', label: 'انتخاب جانشین' },
] as const;

type EventKey = typeof EVENTS[number]['key'];

interface WindowValue { enabled: boolean; start: string; end: string; }

const defaultValue = (key: EventKey): WindowValue => ({
  enabled: key === 'meeting_confirmed',
  start: '06:00',
  end: '20:00',
});

export function MeetingSmsWindowTab() {
  const [values, setValues] = useState<Record<EventKey, WindowValue>>(
    Object.fromEntries(EVENTS.map(item => [item.key, defaultValue(item.key)])) as Record<EventKey, WindowValue>,
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<EventKey | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const keys = EVENTS.flatMap(item => [
        'meeting_sms_window_' + item.key + '_enabled',
        'meeting_sms_window_' + item.key + '_start',
        'meeting_sms_window_' + item.key + '_end',
      ]);
      const { data, error } = await supabase.from('system_config').select('key,value').eq('section', 'notifications').in('key', keys);
      if (error) throw error;
      const map = new Map((data || []).map(row => [row.key, row.value || '']));
      const next = {} as Record<EventKey, WindowValue>;
      for (const item of EVENTS) {
        const fallback = defaultValue(item.key);
        const enabledRaw = map.get('meeting_sms_window_' + item.key + '_enabled');
        const startRaw = map.get('meeting_sms_window_' + item.key + '_start') || fallback.start;
        const endRaw = map.get('meeting_sms_window_' + item.key + '_end') || fallback.end;
        next[item.key] = {
          enabled: enabledRaw == null ? fallback.enabled : enabledRaw === 'true',
          start: TIME_RE.test(startRaw) ? startRaw : fallback.start,
          end: TIME_RE.test(endRaw) ? endRaw : fallback.end,
        };
      }
      setValues(next);
    } catch { toast.error('بارگذاری بازه زمانی پیامک جلسات ناموفق بود'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = (key: EventKey, patch: Partial<WindowValue>) =>
    setValues(current => ({ ...current, [key]: { ...current[key], ...patch } }));

  const save = async (key: EventKey) => {
    const value = values[key];
    if (!TIME_RE.test(value.start) || !TIME_RE.test(value.end)) { toast.error('ساعت شروع و پایان باید در قالب HH:mm باشد'); return; }
    if (value.start === value.end) { toast.error('ساعت شروع و پایان نمی‌تواند یکسان باشد'); return; }
    if (saving) return;
    setSaving(key);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const userId = authData.user?.id || null;
      const now = new Date().toISOString();
      const label = EVENTS.find(item => item.key === key)?.label || key;
      const rows = [
        { section: 'notifications', key: 'meeting_sms_window_' + key + '_enabled', value: String(value.enabled), value_type: 'boolean', label: 'محدودیت بازه پیامک ' + label, updated_by: userId, updated_at: now },
        { section: 'notifications', key: 'meeting_sms_window_' + key + '_start', value: value.start, value_type: 'time', label: 'شروع بازه پیامک ' + label, updated_by: userId, updated_at: now },
        { section: 'notifications', key: 'meeting_sms_window_' + key + '_end', value: value.end, value_type: 'time', label: 'پایان بازه پیامک ' + label, updated_by: userId, updated_at: now },
      ];
      const { error } = await supabase.from('system_config').upsert(rows, { onConflict: 'section,key' });
      if (error) throw error;
      logAudit({ module: 'system_config', action: 'config_updated', entity_name: 'notifications.meeting_sms_window.' + key, details: 'enabled=' + value.enabled + '; start=' + value.start + '; end=' + value.end + '; timezone=Asia/Tehran', severity: 'info' });
      toast.success('بازه پیامک ذخیره شد');
    } catch { toast.error('ذخیره بازه پیامک ناموفق بود'); }
    finally { setSaving(null); }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="ml-2 h-5 w-5 animate-spin" />در حال بارگذاری...</div>;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300">
        <div className="flex items-center gap-2 font-semibold"><Clock4 className="h-4 w-4" />بازه مجاز ارسال SMS جلسات — منطقه زمانی تهران</div>
        <p className="mt-1 text-xs leading-6">برای هر رویداد مستقل است. اعلان داخل سامانه همیشه فوری می‌ماند. اگر محدودیت فعال باشد، SMS خارج بازه تا شروع اولین بازه مجاز بعدی در صف می‌ماند.</p>
      </div>
      {EVENTS.map(item => {
        const value = values[item.key];
        return (
          <section key={item.key} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800 sm:p-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div><h4 className="font-bold text-gray-900 dark:text-white">{item.label}</h4><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">event: <code dir="ltr">{item.key}</code></p></div>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"><input type="checkbox" checked={value.enabled} onChange={event => update(item.key, { enabled: event.target.checked })} className="h-4 w-4 accent-amber-500" />تابع بازه زمانی</label>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div><label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">شروع بازه</label><input type="time" value={value.start} disabled={!value.enabled} onChange={event => update(item.key, { start: event.target.value })} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white" /></div>
              <div><label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">پایان بازه</label><input type="time" value={value.end} disabled={!value.enabled} onChange={event => update(item.key, { end: event.target.value })} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white" /></div>
            </div>
            <div className="mt-5 flex justify-end"><button type="button" disabled={saving !== null} onClick={() => void save(item.key)} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-50">{saving === item.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}ذخیره</button></div>
          </section>
        );
      })}
    </div>
  );
}
