import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock3, Loader2, Save, ShieldCheck, Zap } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { logAudit } from '../../lib/audit';
import { TEMPLATE_EVENTS } from '../../config/templateCatalog';

type DeliveryMode = 'immediate' | 'window' | 'fixed_time';

interface PolicyRow {
  category: string;
  event_type: string;
  delivery_mode: DeliveryMode;
  window_start: string;
  window_end: string;
  fixed_time: string;
  timezone: string;
  locked_immediate: boolean;
}

type EventDescriptor = {
  category: string;
  eventType: string;
  label: string;
};

const CATEGORY_LABELS: Record<string, string> = {
  meeting: 'جلسات',
  task: 'اقدامات',
  chat: 'چت',
  channel: 'کانال‌ها',
  note: 'یادداشت‌ها',
  report: 'گزارش‌ها',
  system: 'سیستم',
  auth: 'احراز هویت',
  minutes: 'صورت‌جلسات',
  decision: 'مصوبات',
  calendar: 'تقویم',
  daily_report: 'گزارش روزانه',
};

const EXTRA_EVENTS: EventDescriptor[] = [
  { category: 'auth', eventType: 'registration_phone_otp', label: 'کد تأیید ثبت‌نام' },
  { category: 'daily_report', eventType: 'daily_meetings', label: 'گزارش روزانه جلسات' },
];

const normalizeTime = (value?: string | null, fallback = '09:00') => {
  const raw = String(value || '');
  const match = raw.match(/^(\d{2}):(\d{2})/);
  return match ? match[1] + ':' + match[2] : fallback;
};

export function SmsDeliveryPolicyTab() {
  const [policies, setPolicies] = useState<Record<string, PolicyRow>>({});
  const [dbEvents, setDbEvents] = useState<Array<{ category: string; event_type: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  const catalogEvents = useMemo<EventDescriptor[]>(() => {
    const fromCatalog = TEMPLATE_EVENTS
      .filter(event => event.supportedChannels.includes('sms'))
      .map(event => ({
        category: event.category,
        eventType: event.key,
        label: event.label,
      }));
    return [...fromCatalog, ...EXTRA_EVENTS];
  }, []);

  const eventLabelMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const event of catalogEvents) {
      map.set(event.category + ':' + event.eventType, event.label);
    }
    return map;
  }, [catalogEvents]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: policyRows, error: policyError }, { data: templateRows, error: templateError }] = await Promise.all([
        supabase
          .from('sms_delivery_policies')
          .select('category,event_type,delivery_mode,window_start,window_end,fixed_time,timezone,locked_immediate')
          .order('category')
          .order('event_type'),
        supabase
          .from('sms_templates')
          .select('category,event_type'),
      ]);
      if (policyError) throw policyError;
      if (templateError) throw templateError;

      const nextPolicies: Record<string, PolicyRow> = {};
      for (const row of policyRows || []) {
        const key = row.category + ':' + row.event_type;
        nextPolicies[key] = {
          category: row.category,
          event_type: row.event_type,
          delivery_mode: (row.delivery_mode || 'immediate') as DeliveryMode,
          window_start: normalizeTime(row.window_start, '06:00'),
          window_end: normalizeTime(row.window_end, '20:00'),
          fixed_time: normalizeTime(row.fixed_time, '09:00'),
          timezone: row.timezone || 'Asia/Tehran',
          locked_immediate: row.locked_immediate === true,
        };
      }
      setPolicies(nextPolicies);
      setDbEvents((templateRows || []).map(row => ({ category: row.category, event_type: row.event_type })));
    } catch (error) {
      console.error('[SmsDeliveryPolicyTab] load failed', error);
      toast.error('بارگذاری سیاست زمان‌بندی پیامک ناموفق بود');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const events = useMemo(() => {
    const map = new Map<string, EventDescriptor>();

    for (const event of catalogEvents) {
      map.set(event.category + ':' + event.eventType, event);
    }
    for (const event of dbEvents) {
      const key = event.category + ':' + event.event_type;
      if (!map.has(key)) {
        map.set(key, {
          category: event.category,
          eventType: event.event_type,
          label: eventLabelMap.get(key) || event.event_type,
        });
      }
    }
    for (const policy of Object.values(policies)) {
      const key = policy.category + ':' + policy.event_type;
      if (!map.has(key)) {
        map.set(key, {
          category: policy.category,
          eventType: policy.event_type,
          label: eventLabelMap.get(key) || policy.event_type,
        });
      }
    }

    const query = filter.trim().toLocaleLowerCase('fa-IR');
    return [...map.values()]
      .filter(event => {
        if (!query) return true;
        return [
          event.label,
          event.eventType,
          CATEGORY_LABELS[event.category] || event.category,
          event.category,
        ].join(' ').toLocaleLowerCase('fa-IR').includes(query);
      })
      .sort((a, b) => {
        const cat = (CATEGORY_LABELS[a.category] || a.category).localeCompare(CATEGORY_LABELS[b.category] || b.category, 'fa');
        return cat || a.label.localeCompare(b.label, 'fa');
      });
  }, [catalogEvents, dbEvents, eventLabelMap, filter, policies]);

  const getPolicy = (event: EventDescriptor): PolicyRow => {
    const key = event.category + ':' + event.eventType;
    return policies[key] || {
      category: event.category,
      event_type: event.eventType,
      delivery_mode: 'immediate',
      window_start: '06:00',
      window_end: '20:00',
      fixed_time: '09:00',
      timezone: 'Asia/Tehran',
      locked_immediate: event.category === 'auth' && ['login_otp', 'registration_phone_otp'].includes(event.eventType),
    };
  };

  const updateLocal = (event: EventDescriptor, patch: Partial<PolicyRow>) => {
    const key = event.category + ':' + event.eventType;
    setPolicies(current => ({ ...current, [key]: { ...getPolicy(event), ...patch } }));
  };

  const save = async (event: EventDescriptor) => {
    const key = event.category + ':' + event.eventType;
    const policy = getPolicy(event);
    if (policy.locked_immediate && policy.delivery_mode !== 'immediate') {
      toast.error('پیامک‌های OTP باید فوری باقی بمانند');
      return;
    }
    if (policy.delivery_mode === 'window' && policy.window_start === policy.window_end) {
      toast.error('شروع و پایان بازه نباید یکسان باشد');
      return;
    }

    setSavingKey(key);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const { error } = await supabase.from('sms_delivery_policies').upsert({
        category: event.category,
        event_type: event.eventType,
        delivery_mode: policy.locked_immediate ? 'immediate' : policy.delivery_mode,
        window_start: policy.window_start,
        window_end: policy.window_end,
        fixed_time: policy.fixed_time,
        timezone: 'Asia/Tehran',
        locked_immediate: policy.locked_immediate,
        updated_by: authData.user?.id || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'category,event_type' });
      if (error) throw error;

      logAudit({
        module: 'system_config',
        action: 'config_updated',
        entity_name: 'sms_delivery_policy.' + key,
        details: 'mode=' + policy.delivery_mode +
          '; window=' + policy.window_start + '-' + policy.window_end +
          '; fixed=' + policy.fixed_time +
          '; timezone=Asia/Tehran',
        severity: 'info',
      });
      toast.success('سیاست ارسال پیامک ذخیره شد');
      await load();
    } catch (error) {
      console.error('[SmsDeliveryPolicyTab] save failed', error);
      toast.error('ذخیره سیاست ارسال پیامک ناموفق بود');
    } finally {
      setSavingKey(null);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-16 text-gray-500"><Loader2 className="ml-2 h-5 w-5 animate-spin" />در حال بارگذاری...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-blue-100 bg-blue-50/70 p-4 text-sm text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300">
        <div className="flex items-center gap-2 font-semibold"><Clock3 className="h-4 w-4" />سیاست مرکزی زمان‌بندی SMS — Asia/Tehran</div>
        <p className="mt-1 text-xs leading-6">
          هر رویداد پیامکی مستقل مدیریت می‌شود. اعلان داخل سامانه فوری است؛ فقط SMS می‌تواند فوری، داخل بازه، یا در ساعت ثابت ارسال شود. پیام‌های خارج زمان مجاز در صف می‌مانند.
        </p>
      </div>

      <input
        value={filter}
        onChange={event => setFilter(event.target.value)}
        placeholder="جستجو در بخش، رویداد یا کلید..."
        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
      />

      <div className="space-y-3">
        {events.map(event => {
          const key = event.category + ':' + event.eventType;
          const policy = getPolicy(event);
          const categoryLabel = CATEGORY_LABELS[event.category] || event.category;

          return (
            <section key={key} className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-bold text-gray-900 dark:text-white">{event.label}</h4>
                    <span className="rounded-lg bg-gray-100 px-2 py-1 text-[11px] text-gray-500 dark:bg-gray-700 dark:text-gray-300">{categoryLabel}</span>
                    {policy.locked_immediate && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-[11px] text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
                        <ShieldCheck className="h-3 w-3" />امنیتی — فقط فوری
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[11px] text-gray-400" dir="ltr">{key}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={policy.locked_immediate}
                    onClick={() => updateLocal(event, { delivery_mode: 'immediate' })}
                    className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-medium transition ${policy.delivery_mode === 'immediate' ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'border-gray-200 text-gray-500 dark:border-gray-700'} disabled:opacity-60`}
                  >
                    <Zap className="h-3.5 w-3.5" />فوری
                  </button>
                  <button
                    type="button"
                    disabled={policy.locked_immediate}
                    onClick={() => updateLocal(event, { delivery_mode: 'window' })}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${policy.delivery_mode === 'window' ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'border-gray-200 text-gray-500 dark:border-gray-700'} disabled:opacity-60`}
                  >
                    بازه زمانی
                  </button>
                  <button
                    type="button"
                    disabled={policy.locked_immediate}
                    onClick={() => updateLocal(event, { delivery_mode: 'fixed_time' })}
                    className={`rounded-xl border px-3 py-2 text-xs font-medium transition ${policy.delivery_mode === 'fixed_time' ? 'border-amber-400 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300' : 'border-gray-200 text-gray-500 dark:border-gray-700'} disabled:opacity-60`}
                  >
                    ساعت ثابت
                  </button>
                </div>
              </div>

              {policy.delivery_mode === 'window' && (
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <label className="text-xs text-gray-600 dark:text-gray-300">
                    شروع بازه
                    <input type="time" value={policy.window_start} onChange={e => updateLocal(event, { window_start: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                  </label>
                  <label className="text-xs text-gray-600 dark:text-gray-300">
                    پایان بازه
                    <input type="time" value={policy.window_end} onChange={e => updateLocal(event, { window_end: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                  </label>
                </div>
              )}

              {policy.delivery_mode === 'fixed_time' && (
                <div className="mt-4 max-w-xs">
                  <label className="text-xs text-gray-600 dark:text-gray-300">
                    ساعت ارسال
                    <input type="time" value={policy.fixed_time} onChange={e => updateLocal(event, { fixed_time: e.target.value })}
                      className="mt-1.5 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white" />
                  </label>
                </div>
              )}

              <div className="mt-4 flex justify-end">
                <button type="button" disabled={savingKey !== null || policy.locked_immediate} onClick={() => void save(event)}
                  className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-50">
                  {savingKey === key ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  ذخیره
                </button>
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
