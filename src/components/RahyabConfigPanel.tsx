import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Save, Loader as Loader2, RefreshCw, Wifi, WifiOff, Send, Inbox, CreditCard, Settings, Terminal } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import type { RahyabSettings, InboxMessage, DebugLog } from './RahyabConfig/types';
import { BLANK_SETTINGS, inp, TABS } from './RahyabConfig/types';
import { SettingsForm } from './RahyabConfig/SettingsForm';
import { AccountInfo } from './RahyabConfig/AccountInfo';
import { SendForm } from './RahyabConfig/SendForm';
import { InboxList } from './RahyabConfig/InboxList';
import { RequestLogPanel } from './RahyabConfig/RequestLogPanel';

// Re-export for backward compatibility (SmsConfig/TestTab imports from here)
export { RequestLogPanel };

// ── Edge function caller ──────────────────────────────────────────────────────
async function callRahyab(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('rahyab-sms', {
    body: { action, ...extra },
  });
  if (error) throw new Error(error.message);
  return data as any;
}

// ════════════════════════════════════════════════════════════════════
//  TAB 1 — Settings
// ════════════════════════════════════════════════════════════════════
function SettingsTab() {
  const [form, setForm]     = useState<RahyabSettings>(BLANK_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]  = useState(false);
  const [testing, setTesting] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showLog, setShowLog] = useState(false);

  useEffect(() => {
    callRahyab('load_settings')
      .then(d => { if (d.settings) setForm({ ...BLANK_SETTINGS, ...d.settings }); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const set = (k: keyof RahyabSettings, v: unknown) =>
    setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.username && !form.token) { toast.error('نام کاربری یا توکن الزامی است'); return; }
    if (!form.short_code) { toast.error('شماره اختصاصی الزامی است'); return; }
    setSaving(true);
    try {
      await callRahyab('save_settings', { settings: form });
      toast.success('تنظیمات رهیاب رایان ذخیره شد');
    } catch (e: any) {
      toast.error('خطا در ذخیره: ' + e.message);
    }
    setSaving(false);
  };

  const testConnection = async () => {
    setTesting(true);
    setTestResult(null);
    setDebugLogs([]);
    setShowLog(false);
    try {
      const d = await callRahyab('test', { debug: true });
      if (d.debug) { setDebugLogs(d.debug); setShowLog(true); }
      if (d.ok) {
        setTestResult({ ok: true, msg: `اتصال موفق — اعتبار: ${d.credit} | انقضا: ${d.expireDate}` });
      } else {
        setTestResult({ ok: false, msg: d.error || 'خطای ناشناخته' });
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  };

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>;

  return (
    <div className="space-y-5">
      <SettingsForm form={form} set={set} showPass={showPass} setShowPass={setShowPass} />

      {testResult && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm ${testResult.ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}>
          {testResult.ok ? <Wifi className="w-4 h-4 flex-shrink-0" /> : <WifiOff className="w-4 h-4 flex-shrink-0" />}
          {testResult.msg}
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'در حال ذخیره...' : 'ذخیره تنظیمات'}
        </button>
        <button onClick={testConnection} disabled={testing}
          className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {testing ? 'در حال تست...' : 'تست اتصال'}
        </button>
        {debugLogs.length > 0 && (
          <button
            onClick={() => setShowLog(v => !v)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl text-sm transition"
            dir="ltr"
          >
            <Terminal className="w-4 h-4" />
            {showLog ? 'Hide Log' : 'Show Log'}
          </button>
        )}
      </div>

      {showLog && debugLogs.length > 0 && <RequestLogPanel logs={debugLogs} onClear={() => { setDebugLogs([]); setShowLog(false); }} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 2 — Account Info
// ════════════════════════════════════════════════════════════════════
function AccountTab() {
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<{ credit: string; expireDate: string } | null>(null);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const d = await callRahyab('get_info');
      if (d.ok) setInfo({ credit: d.credit, expireDate: d.expireDate });
      else setError(d.error || 'خطا در دریافت اطلاعات');
    } catch (e: any) {
      setError(e.message);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">اطلاعات حساب کاربری رهیاب رایان</p>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition">
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          بروزرسانی
        </button>
      </div>

      <AccountInfo info={info} error={error} loading={loading} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 3 — Test Send
// ════════════════════════════════════════════════════════════════════
function SendTab() {
  const [mobile, setMobile]   = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult]   = useState<{ ok: boolean; msg: string } | null>(null);
  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);
  const [showLog, setShowLog] = useState(false);

  const send = async () => {
    if (!mobile.trim()) { toast.error('شماره موبایل وارد کنید'); return; }
    if (!message.trim()) { toast.error('متن پیام وارد کنید'); return; }
    setSending(true);
    setResult(null);
    setDebugLogs([]);
    try {
      const d = await callRahyab('send', { mobiles: [mobile.trim()], message: message.trim(), debug: true });
      if (d.debug) {
        setDebugLogs(d.debug);
        setShowLog(true);
      }
      if (d.ok) {
        setResult({ ok: true, msg: `ارسال موفق — شناسه‌ها: ${d.returnIds?.join(', ') || '—'}` });
        toast.success('پیامک ارسال شد');
      } else {
        setResult({ ok: false, msg: d.errors?.[0] || d.error || 'ارسال ناموفق' });
        toast.error('ارسال ناموفق');
      }
    } catch (e: any) {
      setResult({ ok: false, msg: e.message });
    }
    setSending(false);
  };

  return (
    <div className="space-y-4">
      <SendForm mobile={mobile} setMobile={setMobile} message={message} setMessage={setMessage} result={result} />

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={send} disabled={sending}
          className="flex items-center gap-2 px-6 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          {sending ? 'در حال ارسال...' : 'ارسال پیامک آزمایشی'}
        </button>
        {debugLogs.length > 0 && (
          <button
            onClick={() => setShowLog(v => !v)}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-200 rounded-xl text-sm transition"
            dir="ltr"
          >
            <Terminal className="w-4 h-4" />
            {showLog ? 'Hide Log' : 'Show Log'}
          </button>
        )}
      </div>

      {showLog && debugLogs.length > 0 && <RequestLogPanel logs={debugLogs} onClear={() => { setDebugLogs([]); setShowLog(false); }} />}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 4 — Inbox
// ════════════════════════════════════════════════════════════════════
function InboxTab() {
  const [messages, setMessages]   = useState<InboxMessage[]>([]);
  const [loading, setLoading]     = useState(false);
  const [fetching, setFetching]   = useState(false);
  const [lastRowId, setLastRowId] = useState(0);

  const loadFromDb = useCallback(async () => {
    setLoading(true);
    try {
      const d = await callRahyab('inbox');
      setMessages(d.messages ?? []);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { loadFromDb(); }, [loadFromDb]);

  const fetchNew = async () => {
    setFetching(true);
    try {
      const d = await callRahyab('receive', { lastRowId });
      if (d.ok) {
        if (d.count > 0) {
          setLastRowId(d.nextRowId);
          toast.success(`${d.count} پیام جدید دریافت شد`);
          await loadFromDb();
        } else {
          toast('پیام جدیدی وجود ندارد', { icon: '📭' });
        }
      } else {
        toast.error(d.error || 'خطا در دریافت پیام');
      }
    } catch (e: any) {
      toast.error(e.message);
    }
    setFetching(false);
  };

  const markRead = async (id: string) => {
    await supabase.from('rahyab_inbox').update({ is_read: true }).eq('id', id);
    setMessages(m => m.map(msg => msg.id === id ? { ...msg, is_read: true } : msg));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-2">
          <button onClick={loadFromDb} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            بروزرسانی
          </button>
          <button onClick={fetchNew} disabled={fetching}
            className="flex items-center gap-2 px-4 py-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
            {fetching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Inbox className="w-4 h-4" />}
            {fetching ? 'در حال دریافت...' : 'دریافت پیام جدید'}
          </button>
        </div>
      </div>

      <InboxList messages={messages} loading={loading} onMarkRead={markRead} onFetchNew={fetchNew} fetching={fetching} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  Active Engine Selector
// ════════════════════════════════════════════════════════════════════
function EngineSelector() {
  const [engine, setEngine]   = useState<'standard' | 'rahyab'>('standard');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);

  useEffect(() => {
    supabase.from('system_config').select('value')
      .eq('section', 'sms').eq('key', 'active_engine')
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value === 'rahyab') setEngine('rahyab');
        setLoading(false);
      });
  }, []);

  const save = async (val: 'standard' | 'rahyab') => {
    setSaving(true);
    setEngine(val);
    await supabase.from('system_config')
      .update({ value: val, updated_at: new Date().toISOString() })
      .eq('section', 'sms').eq('key', 'active_engine');
    toast.success(val === 'rahyab' ? 'وب‌سرویس رهیاب رایان فعال شد' : 'سرویس‌دهنده استاندارد فعال شد');
    setSaving(false);
  };

  if (loading) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 mb-5">
      <div className="flex items-center gap-2 mb-3">
        <MessageSquare className="w-4 h-4 text-teal-500" />
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">موتور ارسال پیامک فعال</p>
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-400" />}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => save('standard')}
          className={`p-3 rounded-xl border transition-all text-right ${engine === 'standard' ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-300 dark:border-blue-600' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}
        >
          <p className={`text-sm font-semibold ${engine === 'standard' ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-300'}`}>سرویس‌دهنده استاندارد</p>
          <p className="text-xs text-gray-400 mt-0.5">sms.ir و سایر ارائه‌دهندگان REST</p>
          {engine === 'standard' && <span className="inline-block mt-1.5 text-xs text-blue-600 dark:text-blue-400 font-medium">● فعال</span>}
        </button>
        <button
          onClick={() => save('rahyab')}
          className={`p-3 rounded-xl border transition-all text-right ${engine === 'rahyab' ? 'bg-teal-50 dark:bg-teal-900/20 border-teal-300 dark:border-teal-600' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}
        >
          <p className={`text-sm font-semibold ${engine === 'rahyab' ? 'text-teal-700 dark:text-teal-300' : 'text-gray-600 dark:text-gray-300'}`}>وب‌سرویس رهیاب رایان</p>
          <p className="text-xs text-gray-400 mt-0.5">SOAP — RahvabBulk.ir</p>
          {engine === 'rahyab' && <span className="inline-block mt-1.5 text-xs text-teal-600 dark:text-teal-400 font-medium">● فعال</span>}
        </button>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  Main export
// ════════════════════════════════════════════════════════════════════
export function RahyabConfigPanel() {
  const [tab, setTab] = useState<'settings' | 'account' | 'send' | 'inbox'>('settings');

  const TAB_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    settings: Settings,
    account: CreditCard,
    send: Send,
    inbox: Inbox,
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center flex-shrink-0">
          <MessageSquare className="w-5 h-5 text-teal-600 dark:text-teal-400" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white">وب‌سرویس رهیاب رایان</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            پیکربندی و مدیریت ارسال پیامک از طریق SOAP API رهیاب رایان
          </p>
        </div>
      </div>

      <EngineSelector />

      {/* Tab bar */}
      <div className="flex bg-gray-100 dark:bg-gray-700 rounded-xl p-1 gap-1">
        {TABS.map(({ key, label, icon }) => {
          const Icon = TAB_ICONS[icon];
          return (
            <button key={key} onClick={() => setTab(key as any)}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${tab === key ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          );
        })}
      </div>

      {tab === 'settings' && <SettingsTab />}
      {tab === 'account'  && <AccountTab />}
      {tab === 'send'     && <SendTab />}
      {tab === 'inbox'    && <InboxTab />}
    </div>
  );
}
