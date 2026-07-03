import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Clock, MessageSquare, Bell, Users, Save, Loader as Loader2, Plus, X, Check, Send, ChevronDown, ChevronUp, Info, Radio } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

interface Profile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
}

interface UserGroup {
  id: string;
  name: string;
  display_name: string | null;
}

interface Config {
  id?: string;
  is_enabled: boolean;
  send_time: string;
  send_days: number[];
  send_via_sms: boolean;
  send_via_notification: boolean;
  send_via_bale: boolean;
  recipient_user_ids: string[];
  recipient_group_ids: string[];
  notification_title_tpl: string;
  notification_body_tpl: string;
  sms_tpl: string;
  last_sent_date?: string | null;
}

const DEFAULT_NOTIF_TITLE = 'جلسات {{weekday}} {{date}} ({{count}} جلسه)';
const DEFAULT_NOTIF_BODY = `📋 برنامه جلسات روز {{weekday}} {{date}}:
{{meetings_list}}`;
const DEFAULT_SMS_LINE = '⏰ {{time}} | {{subject}}{{location_part}}';

// Jalaali weekdays: index matches (getUTCDay() + 1) % 7
const WEEKDAYS = [
  { index: 0, label: 'شنبه' },
  { index: 1, label: 'یکشنبه' },
  { index: 2, label: 'دوشنبه' },
  { index: 3, label: 'سه‌شنبه' },
  { index: 4, label: 'چهارشنبه' },
  { index: 5, label: 'پنجشنبه' },
  { index: 6, label: 'جمعه' },
];

const inp = 'w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition text-sm';
const textarea = inp + ' resize-none font-mono text-xs leading-relaxed';

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!value)}
      className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${value ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function SectionCard({ title, icon: Icon, iconColor, children, collapsible = false }: {
  title: string; icon: React.ElementType; iconColor: string; children: React.ReactNode; collapsible?: boolean;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-700/50 overflow-hidden">
      <button
        type="button"
        onClick={() => collapsible && setOpen(v => !v)}
        className={`w-full flex items-center justify-between px-4 py-3 ${collapsible ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700/30' : 'cursor-default'}`}
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 dark:text-gray-300">
          <Icon className={`w-4 h-4 ${iconColor}`} />
          {title}
        </div>
        {collapsible && (open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />)}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  );
}

function PlaceholderBadge({ label }: { label: string }) {
  return (
    <code className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-[11px] font-mono select-all cursor-text">{`{{${label}}}`}</code>
  );
}

export function DailyReportConfigPanel() {
  const [config, setConfig] = useState<Config>({
    is_enabled: false,
    send_time: '07:00',
    send_days: [0, 1, 2, 3, 4],
    send_via_sms: true,
    send_via_notification: true,
    send_via_bale: false,
    recipient_user_ids: [],
    recipient_group_ids: [],
    notification_title_tpl: DEFAULT_NOTIF_TITLE,
    notification_body_tpl: DEFAULT_NOTIF_BODY,
    sms_tpl: DEFAULT_SMS_LINE,
  });
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [sending, setSending] = useState(false);
  const [allGroups, setAllGroups] = useState<UserGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [showUserPicker, setShowUserPicker] = useState(false);
  const [showGroupPicker, setShowGroupPicker] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const [cfgRes, profilesRes, groupsRes] = await Promise.all([
        supabase.from('daily_report_config').select('*').maybeSingle(),
        supabase.from('profiles').select('user_id, full_name, email, avatar_url').order('full_name'),
        supabase.from('user_groups').select('id, name, display_name').order('name'),
      ]);
      if (cfgRes.data) {
        const d = cfgRes.data;
        setConfig({
          id: d.id,
          is_enabled: d.is_enabled,
          send_time: d.send_time,
          send_days: d.send_days ?? [0, 1, 2, 3, 4],
          send_via_sms: d.send_via_sms,
          send_via_notification: d.send_via_notification,
          send_via_bale: d.send_via_bale ?? false,
          recipient_user_ids: d.recipient_user_ids || [],
          recipient_group_ids: d.recipient_group_ids || [],
          notification_title_tpl: d.notification_title_tpl || DEFAULT_NOTIF_TITLE,
          notification_body_tpl: d.notification_body_tpl || DEFAULT_NOTIF_BODY,
          sms_tpl: d.sms_tpl || DEFAULT_SMS_LINE,
          last_sent_date: d.last_sent_date,
        });
      }
      setAllProfiles(profilesRes.data || []);
      setAllGroups(groupsRes.data || []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const save = async () => {
    setSaving(true);
    const payload = {
      is_enabled: config.is_enabled,
      send_time: config.send_time,
      send_days: config.send_days,
      send_via_sms: config.send_via_sms,
      send_via_notification: config.send_via_notification,
      send_via_bale: config.send_via_bale,
      recipient_user_ids: config.recipient_user_ids,
      recipient_group_ids: config.recipient_group_ids,
      notification_title_tpl: config.notification_title_tpl || null,
      notification_body_tpl: config.notification_body_tpl || null,
      sms_tpl: config.sms_tpl || null,
      updated_at: new Date().toISOString(),
    };
    let error;
    if (config.id) {
      ({ error } = await supabase.from('daily_report_config').update(payload).eq('id', config.id));
    } else {
      const { data, error: e } = await supabase.from('daily_report_config').insert(payload).select().maybeSingle();
      error = e;
      if (data) setConfig(c => ({ ...c, id: data.id }));
    }
    setSaving(false);
    if (error) toast.error('خطا در ذخیره تنظیمات');
    else toast.success('تنظیمات ذخیره شد');
  };

  const sendNow = async () => {
    setSending(true);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const res = await fetch(`${supabaseUrl}/functions/v1/send-daily-meetings`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(
          `ارسال شد — ${json.meetings_count} جلسه | ${json.recipients} دریافت‌کننده` +
          (json.sms_sent ? ` | ${json.sms_sent} پیامک` : '') +
          ` (${json.date_long || json.date})`
        );
        await fetchData();
      } else {
        const reasons: Record<string, string> = {
          no_config: 'تنظیمات یافت نشد — ابتدا تنظیمات را ذخیره کنید',
          disabled: 'ارسال غیرفعال است',
          no_recipients: 'هیچ دریافت‌کننده‌ای انتخاب نشده',
        };
        toast.error(reasons[json.reason] || `خطا: ${json.error || json.reason || 'نامشخص'}`);
      }
    } catch {
      toast.error('خطا در اتصال به سرور');
    } finally {
      setSending(false);
    }
  };

  const toggleUserId = (uid: string) => setConfig(c => ({
    ...c,
    recipient_user_ids: c.recipient_user_ids.includes(uid)
      ? c.recipient_user_ids.filter(id => id !== uid)
      : [...c.recipient_user_ids, uid],
  }));

  const toggleGroupId = (gid: string) => setConfig(c => ({
    ...c,
    recipient_group_ids: c.recipient_group_ids.includes(gid)
      ? c.recipient_group_ids.filter(id => id !== gid)
      : [...c.recipient_group_ids, gid],
  }));

  const filteredUsers = allProfiles.filter(p =>
    !userSearch || (p.full_name || '').includes(userSearch) || (p.email || '').includes(userSearch)
  );
  const filteredGroups = allGroups.filter(g =>
    !groupSearch || (g.display_name || g.name || '').includes(groupSearch)
  );
  const recipientUsers = allProfiles.filter(p => config.recipient_user_ids.includes(p.user_id));
  const recipientGroups = allGroups.filter(g => config.recipient_group_ids.includes(g.id));

  if (loading) return (
    <div className="flex items-center justify-center py-16">
      <Loader2 className="w-7 h-7 animate-spin text-blue-500" />
    </div>
  );

  if (loadError) return (
    <div className="flex flex-col items-center justify-center py-16 gap-4" dir="rtl">
      <div className="w-14 h-14 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
        <CalendarDays className="w-7 h-7 text-red-400" />
      </div>
      <div className="text-center">
        <p className="font-semibold text-gray-700 dark:text-gray-300">خطا در بارگذاری</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">اتصال به پایگاه داده برقرار نشد</p>
      </div>
      <button
        onClick={fetchData}
        className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors"
      >
        <Loader2 className="w-4 h-4" /> تلاش مجدد
      </button>
    </div>
  );

  return (
    <div className="space-y-5" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">ارسال جلسات مدیریتی</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              ارسال خودکار جدول جلسات روزانه در ساعت مشخص
              {config.last_sent_date && (
                <span className="mr-2 text-green-600 dark:text-green-400 font-medium">
                  · آخرین ارسال: {config.last_sent_date}
                </span>
              )}
            </p>
          </div>
        </div>
        <Toggle value={config.is_enabled} onChange={v => setConfig(c => ({ ...c, is_enabled: v }))} />
      </div>

      <div className={`space-y-4 transition-opacity ${config.is_enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>

        {/* Send time & days */}
        <SectionCard title="زمان‌بندی ارسال" icon={Clock} iconColor="text-blue-500">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">ساعت ارسال</label>
              <input type="time" value={config.send_time}
                onChange={e => setConfig(c => ({ ...c, send_time: e.target.value }))}
                className={inp + ' max-w-xs'} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">روزهای ارسال</label>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map(day => {
                  const active = config.send_days.includes(day.index);
                  return (
                    <button
                      key={day.index}
                      type="button"
                      onClick={() => setConfig(c => ({
                        ...c,
                        send_days: active
                          ? c.send_days.filter(d => d !== day.index)
                          : [...c.send_days, day.index].sort((a, b) => a - b),
                      }))}
                      className={`px-3 py-1.5 rounded-xl text-sm font-medium transition-colors border ${
                        active
                          ? 'bg-blue-500 text-white border-blue-500'
                          : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:text-blue-600'
                      }`}
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                فقط در روزهای انتخاب‌شده ارسال می‌شود. اگر هیچ روزی انتخاب نشود ارسال متوقف خواهد شد.
              </p>
            </div>
          </div>
        </SectionCard>

        {/* Channels */}
        <SectionCard title="کانال ارسال" icon={Bell} iconColor="text-amber-500">
          <div className="flex flex-col gap-3">
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <Toggle value={config.send_via_notification} onChange={v => setConfig(c => ({ ...c, send_via_notification: v }))} />
              <div className="flex items-center gap-2">
                <Bell className="w-4 h-4 text-amber-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">اعلان درون‌برنامه‌ای</span>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <Toggle value={config.send_via_sms} onChange={v => setConfig(c => ({ ...c, send_via_sms: v }))} />
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-green-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">پیامک</span>
              </div>
            </label>
            <label className="flex items-center gap-3 cursor-pointer select-none">
              <Toggle value={config.send_via_bale} onChange={v => setConfig(c => ({ ...c, send_via_bale: v }))} />
              <div className="flex items-center gap-2">
                <Radio className="w-4 h-4 text-purple-500" />
                <span className="text-sm text-gray-700 dark:text-gray-300">پیام بله</span>
              </div>
            </label>
          </div>
        </SectionCard>

        {/* Recipients — users */}
        <SectionCard title="دریافت‌کنندگان (افراد)" icon={Users} iconColor="text-blue-500">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">{recipientUsers.length} نفر انتخاب شده</span>
            <button onClick={() => setShowUserPicker(v => !v)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
              <Plus className="w-3.5 h-3.5" /> افزودن
            </button>
          </div>

          {showUserPicker && (
            <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
              <div className="p-2 border-b border-gray-200 dark:border-gray-600">
                <input value={userSearch} onChange={e => setUserSearch(e.target.value)}
                  placeholder="جستجوی کاربر..." className={inp} />
              </div>
              <div className="max-h-44 overflow-y-auto">
                {filteredUsers.map(p => (
                  <button key={p.user_id} onClick={() => toggleUserId(p.user_id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right transition-colors ${config.recipient_user_ids.includes(p.user_id) ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}>
                    <div className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-800 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600 dark:text-blue-300">
                      {(p.full_name || '?')[0]}
                    </div>
                    <div className="flex-1 min-w-0 text-right">
                      <div className="text-sm text-gray-800 dark:text-gray-200 font-medium truncate">{p.full_name || '—'}</div>
                      <div className="text-xs text-gray-400 truncate">{p.email}</div>
                    </div>
                    {config.recipient_user_ids.includes(p.user_id) && <Check className="w-4 h-4 text-blue-500 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {recipientUsers.map(p => (
              <span key={p.user_id} className="flex items-center gap-1.5 px-3 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded-full text-xs font-medium">
                {p.full_name || p.email}
                <button onClick={() => toggleUserId(p.user_id)} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
              </span>
            ))}
            {recipientUsers.length === 0 && <span className="text-xs text-gray-400 italic">هیچ فردی انتخاب نشده</span>}
          </div>
        </SectionCard>

        {/* Recipients — groups */}
        <SectionCard title="دریافت‌کنندگان (گروه‌ها)" icon={Users} iconColor="text-teal-500">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500 dark:text-gray-400">{recipientGroups.length} گروه انتخاب شده — همه اعضای هر گروه دریافت می‌کنند</span>
            <button onClick={() => setShowGroupPicker(v => !v)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition-colors">
              <Plus className="w-3.5 h-3.5" /> افزودن
            </button>
          </div>

          {showGroupPicker && (
            <div className="border border-gray-200 dark:border-gray-600 rounded-xl overflow-hidden">
              <div className="p-2 border-b border-gray-200 dark:border-gray-600">
                <input value={groupSearch} onChange={e => setGroupSearch(e.target.value)}
                  placeholder="جستجوی گروه..." className={inp} />
              </div>
              <div className="max-h-44 overflow-y-auto">
                {filteredGroups.map(g => (
                  <button key={g.id} onClick={() => toggleGroupId(g.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right transition-colors ${config.recipient_group_ids.includes(g.id) ? 'bg-teal-50 dark:bg-teal-900/20' : ''}`}>
                    <div className="w-7 h-7 rounded-full bg-teal-100 dark:bg-teal-800 flex items-center justify-center flex-shrink-0">
                      <Users className="w-3.5 h-3.5 text-teal-600 dark:text-teal-300" />
                    </div>
                    <span className="flex-1 text-sm text-gray-800 dark:text-gray-200 font-medium text-right">{g.display_name || g.name}</span>
                    {config.recipient_group_ids.includes(g.id) && <Check className="w-4 h-4 text-teal-500 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {recipientGroups.map(g => (
              <span key={g.id} className="flex items-center gap-1.5 px-3 py-1 bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 rounded-full text-xs font-medium">
                {g.display_name || g.name}
                <button onClick={() => toggleGroupId(g.id)} className="hover:text-red-500 transition-colors"><X className="w-3 h-3" /></button>
              </span>
            ))}
            {recipientGroups.length === 0 && <span className="text-xs text-gray-400 italic">هیچ گروهی انتخاب نشده</span>}
          </div>
        </SectionCard>

        {/* Notification template */}
        <SectionCard title="قالب اعلان درون‌برنامه‌ای" icon={Bell} iconColor="text-amber-500" collapsible>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">متغیرها:</span>
            {['date','date_long','weekday','count','meetings_list'].map(p => <PlaceholderBadge key={p} label={p} />)}
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">عنوان اعلان</label>
              <input className={inp} value={config.notification_title_tpl}
                onChange={e => setConfig(c => ({ ...c, notification_title_tpl: e.target.value }))}
                placeholder={DEFAULT_NOTIF_TITLE} dir="auto" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">متن اعلان</label>
              <textarea rows={5} className={textarea} value={config.notification_body_tpl}
                onChange={e => setConfig(c => ({ ...c, notification_body_tpl: e.target.value }))}
                placeholder={DEFAULT_NOTIF_BODY} dir="auto" />
              <p className="text-xs text-gray-400 mt-1">
                <Info className="w-3 h-3 inline ml-1" />
                <code className="text-[11px]">{'{{meetings_list}}'}</code> به‌طور خودکار با فهرست جلسات (شامل ساعت، عنوان، مکان و شرکت‌کنندگان) جایگزین می‌شود.
              </p>
            </div>
            <button onClick={() => setConfig(c => ({ ...c, notification_title_tpl: DEFAULT_NOTIF_TITLE, notification_body_tpl: DEFAULT_NOTIF_BODY }))}
              className="text-xs text-blue-500 hover:text-blue-700 transition-colors">
              بازگشت به پیش‌فرض
            </button>
          </div>
        </SectionCard>

        {/* SMS template */}
        <SectionCard title="قالب پیامک" icon={MessageSquare} iconColor="text-green-500" collapsible>
          <div className="flex flex-wrap gap-1.5 mb-2">
            <span className="text-xs text-gray-500 dark:text-gray-400 ml-1">متغیرها:</span>
            {['date','weekday','time','subject','location','location_part','participants'].map(p => <PlaceholderBadge key={p} label={p} />)}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              قالب هر جلسه (یک خط)
            </label>
            <input className={inp} value={config.sms_tpl}
              onChange={e => setConfig(c => ({ ...c, sms_tpl: e.target.value }))}
              placeholder={DEFAULT_SMS_LINE} dir="auto" />
            <p className="text-xs text-gray-400 mt-1">
              هر جلسه روی یک خط جداگانه در پیامک ارسال می‌شود. ابتدا تاریخ، سپس فهرست جلسات.
            </p>
          </div>
          <button onClick={() => setConfig(c => ({ ...c, sms_tpl: DEFAULT_SMS_LINE }))}
            className="text-xs text-green-500 hover:text-green-700 transition-colors">
            بازگشت به پیش‌فرض
          </button>

          {/* SMS preview */}
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 text-xs font-mono text-gray-600 dark:text-gray-300 leading-loose whitespace-pre-wrap" dir="rtl">
            <span className="text-gray-400 block mb-1">پیش‌نمایش پیامک نمونه:</span>
            {`جلسات ۱۶/۳/۱۴۰۵:\n${(config.sms_tpl || DEFAULT_SMS_LINE)
              .replace('{{time}}', '۰۹:۰۰ تا ۱۰:۰۰')
              .replace('{{subject}}', 'جلسه مدیریتی')
              .replace('{{location}}', 'اتاق کنفرانس')
              .replace('{{location_part}}', ' (اتاق کنفرانس)')
              .replace('{{participants}}', 'علی محمدی، سارا احمدی')
              .replace(/\{\{[^}]+\}\}/g, '')
            }\n${(config.sms_tpl || DEFAULT_SMS_LINE)
              .replace('{{time}}', '۱۴:۰۰ تا ۱۵:۰۰')
              .replace('{{subject}}', 'بررسی پروژه')
              .replace('{{location}}', '')
              .replace('{{location_part}}', '')
              .replace('{{participants}}', 'رضا کریمی')
              .replace(/\{\{[^}]+\}\}/g, '')
            }`}
          </div>
        </SectionCard>

        {/* Info box */}
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-4">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed space-y-1">
              <p>در روزهای <strong>{config.send_days.length > 0 ? config.send_days.map(d => WEEKDAYS[d]?.label).join('، ') : 'هیچ روزی'}</strong> ساعت <strong>{config.send_time}</strong> فهرست جلسات تایید‌شده آن روز برای دریافت‌کنندگان ارسال می‌شود.</p>
              <p>اطلاعات هر جلسه شامل: <strong>ساعت برگزاری، عنوان، مکان و نام شرکت‌کنندگان</strong></p>
              {config.last_sent_date && <p className="text-green-600 dark:text-green-400">آخرین ارسال موفق: {config.last_sent_date}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex justify-end gap-3 pt-2">
        <button onClick={sendNow} disabled={sending}
          className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 font-medium text-sm transition-colors">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          ارسال همین الان
        </button>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 font-medium text-sm transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          ذخیره تنظیمات
        </button>
      </div>
    </div>
  );
}
