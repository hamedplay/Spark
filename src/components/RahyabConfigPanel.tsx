import { useState, useEffect, useCallback } from 'react';
import { MessageSquare, Save, Loader as Loader2, RefreshCw, CircleCheck as CheckCircle, TriangleAlert as AlertTriangle, Eye, EyeOff, Send, Inbox, CreditCard, Settings, Info, Wifi, WifiOff, Phone, Terminal, ChevronDown, ChevronUp, Copy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';

// ── Types ─────────────────────────────────────────────────────────────────────
interface RahyabSettings {
  id?: string;
  username: string;
  password: string;
  short_code: string;
  token: string;
  soap_url: string;
  is_active: boolean;
}

interface InboxMessage {
  id: string;
  row_id: number;
  sender: string;
  receiver: string;
  message: string;
  received_at: string;
  is_read: boolean;
}

const BLANK_SETTINGS: RahyabSettings = {
  username: '', password: '', short_code: '', token: '',
  soap_url: 'http://RahvabBulk.ir/WebService/sms.asmx', is_active: false,
};

const inp = 'w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition text-sm';

// ── Edge function caller ──────────────────────────────────────────────────────
async function callRahyab(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke('rahyab-sms', {
    body: { action, ...extra },
  });
  if (error) throw new Error(error.message);
  return data as any;
}

// ── TABS ──────────────────────────────────────────────────────────────────────
const TABS = [
  { key: 'settings', label: 'تنظیمات',     icon: Settings },
  { key: 'account',  label: 'حساب کاربری', icon: CreditCard },
  { key: 'send',     label: 'تست ارسال',   icon: Send },
  { key: 'inbox',    label: 'صندوق دریافت', icon: Inbox },
];

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
      {/* Security note */}
      <div className="flex items-start gap-3 px-4 py-3 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800 rounded-2xl">
        <Info className="w-4 h-4 text-teal-500 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-teal-700 dark:text-teal-300 leading-relaxed space-y-1">
          <p className="font-medium">نکات امنیتی</p>
          <p>برای امنیت بیشتر از فیلد <strong>توکن</strong> به جای نام کاربری استفاده کنید. در صورت وجود توکن، نام کاربری نادیده گرفته می‌شود.</p>
          <p>آدرس وب‌سرویس: <span className="font-mono">http://RahvabBulk.ir/WebService/sms.asmx</span></p>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">توکن (اولویت اول)</label>
            <input className={inp} value={form.token} onChange={e => set('token', e.target.value)}
              placeholder="برای امنیت بیشتر از توکن استفاده کنید" dir="ltr" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">نام کاربری</label>
            <input className={inp} value={form.username} onChange={e => set('username', e.target.value)}
              placeholder="نام کاربری پنل رهیاب رایان" dir="ltr" />
          </div>
          <div className="relative">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">کلمه عبور</label>
            <input className={inp + ' pl-10'} type={showPass ? 'text' : 'password'}
              value={form.password} onChange={e => set('password', e.target.value)} dir="ltr"
              placeholder="حداقل ۵ کاراکتر" />
            <button type="button" onClick={() => setShowPass(v => !v)}
              className="absolute left-3 top-8 text-gray-400 hover:text-gray-600 transition-colors">
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره اختصاصی *</label>
            <input className={inp} value={form.short_code} onChange={e => set('short_code', e.target.value)}
              placeholder="مثال: 5000123" dir="ltr" />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">آدرس وب‌سرویس SOAP</label>
            <input className={inp} value={form.soap_url} onChange={e => set('soap_url', e.target.value)} dir="ltr" />
            <p className="text-xs text-gray-400 mt-1">
              گزینه‌های جایگزین: <span className="font-mono">https://RahvabBulk.ir:8443/WebService/sms.asmx</span>
            </p>
          </div>
        </div>

        {/* Active toggle */}
        <div className="flex items-center gap-3 pt-1">
          <button type="button" onClick={() => set('is_active', !form.is_active)}
            className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${form.is_active ? 'bg-teal-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
            <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.is_active ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
          <span className="text-sm text-gray-700 dark:text-gray-300">این سرویس فعال است</span>
        </div>
      </div>

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

      {showLog && debugLogs.length > 0 && <RequestLogPanel logs={debugLogs} />}
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

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </div>
      )}

      {loading && !info && <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>}

      {info && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">اعتبار باقی‌مانده</p>
            <p className="text-2xl font-bold text-teal-600 dark:text-teal-400" dir="ltr">{info.credit}</p>
            <p className="text-xs text-gray-400 mt-1">تومان / ریال</p>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">تاریخ انقضا</p>
            <p className="text-2xl font-bold text-gray-700 dark:text-white" dir="ltr">{info.expireDate || '—'}</p>
          </div>
        </div>
      )}

      {info && (
        <div className="bg-teal-50 dark:bg-teal-900/20 rounded-2xl border border-teal-100 dark:border-teal-800 px-4 py-3">
          <p className="text-xs text-teal-700 dark:text-teal-300">
            برای گزارشات تفصیلی‌تر به پنل رهیاب رایان مراجعه کنید:
            <a href="https://RahvabBulk.ir/" target="_blank" rel="noopener noreferrer"
              className="font-mono mr-1 underline hover:no-underline" dir="ltr">
              https://RahvabBulk.ir/
            </a>
          </p>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
//  TAB 3 — Test Send
// ════════════════════════════════════════════════════════════════════

interface DebugLog {
  soapAction: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody: string;
  responseBody?: string;
  parsedResult?: string;
  error?: string;
}

function RequestLogPanel({ logs }: { logs: DebugLog[] }) {
  const [openIdx, setOpenIdx] = useState<number>(0);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1500);
    });
  };

  if (!logs.length) return null;

  return (
    <div className="bg-gray-900 dark:bg-gray-950 rounded-2xl border border-gray-700 dark:border-gray-800 overflow-hidden" dir="ltr">
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 dark:bg-gray-900 border-b border-gray-700 dark:border-gray-800">
        <Terminal className="w-4 h-4 text-teal-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-teal-400 tracking-wide uppercase">Request Log</span>
        <span className="mr-auto text-xs text-gray-500">{logs.length} request{logs.length !== 1 ? 's' : ''}</span>
      </div>

      <div className="divide-y divide-gray-800">
        {logs.map((log, idx) => (
          <div key={idx}>
            <button
              onClick={() => setOpenIdx(openIdx === idx ? -1 : idx)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-800/60 transition-colors text-left"
            >
              <span className={`text-xs font-mono font-bold px-2 py-0.5 rounded ${log.error ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>
                {log.error ? 'ERROR' : 'OK'}
              </span>
              <span className="text-sm text-gray-200 font-mono">{log.soapAction}</span>
              <span className="text-xs text-gray-500 truncate flex-1">{log.url}</span>
              {openIdx === idx ? <ChevronUp className="w-4 h-4 text-gray-500 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-500 flex-shrink-0" />}
            </button>

            {openIdx === idx && (
              <div className="px-4 pb-4 space-y-3">
                {/* Request Headers */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Request Headers</span>
                    <button
                      onClick={() => copy(JSON.stringify(log.requestHeaders, null, 2), `headers-${idx}`)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedKey === `headers-${idx}` ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div className="bg-gray-800 rounded-xl p-3 space-y-1">
                    {Object.entries(log.requestHeaders).map(([k, v]) => (
                      <div key={k} className="flex gap-2 text-xs font-mono">
                        <span className="text-purple-400 flex-shrink-0">{k}:</span>
                        <span className="text-gray-300 break-all">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Request Body (SOAP) */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Request Body (SOAP XML)</span>
                    <button
                      onClick={() => copy(log.requestBody, `reqbody-${idx}`)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                      {copiedKey === `reqbody-${idx}` ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <pre className="bg-gray-800 rounded-xl p-3 text-xs font-mono text-green-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-64 overflow-y-auto">
                    {log.requestBody}
                  </pre>
                </div>

                {/* Response Body */}
                {(log.responseBody || log.error) && (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                        {log.error && !log.responseBody ? 'Error' : 'Response Body'}
                      </span>
                      {(log.responseBody || log.error) && (
                        <button
                          onClick={() => copy(log.responseBody || log.error || '', `resbody-${idx}`)}
                          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                        >
                          <Copy className="w-3 h-3" />
                          {copiedKey === `resbody-${idx}` ? 'Copied!' : 'Copy'}
                        </button>
                      )}
                    </div>
                    <pre className={`bg-gray-800 rounded-xl p-3 text-xs font-mono overflow-x-auto whitespace-pre-wrap break-all leading-relaxed max-h-64 overflow-y-auto ${log.error && !log.responseBody ? 'text-red-400' : 'text-blue-300'}`}>
                      {log.responseBody || log.error}
                    </pre>
                  </div>
                )}

                {/* Parsed Result */}
                {log.parsedResult && (
                  <div>
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1.5">Parsed Result</span>
                    <pre className="bg-gray-800 rounded-xl p-3 text-xs font-mono text-yellow-300 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                      {log.parsedResult}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

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
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره موبایل گیرنده</label>
          <input className={inp} value={mobile} onChange={e => setMobile(e.target.value)}
            placeholder="09123456789" dir="ltr" type="tel" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            متن پیام
            <span className="text-gray-400 font-normal mr-2">({message.length} کاراکتر)</span>
          </label>
          <textarea className={inp + ' resize-none'} rows={4}
            value={message} onChange={e => setMessage(e.target.value)}
            placeholder="متن پیامک آزمایشی..." />
        </div>
      </div>

      {result && (
        <div className={`flex items-center gap-2 px-4 py-3 rounded-2xl border text-sm ${result.ok ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-700 dark:text-green-300' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300'}`}>
          {result.ok ? <CheckCircle className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
          {result.msg}
        </div>
      )}

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

      {showLog && debugLogs.length > 0 && <RequestLogPanel logs={debugLogs} />}

      <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 dark:text-amber-300">بین هر دو ارسال متوالی حداقل ۳ ثانیه فاصله توسط وب‌سرویس اعمال می‌شود.</p>
      </div>
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
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {messages.length} پیام — {messages.filter(m => !m.is_read).length} خوانده نشده
        </p>
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

      {loading && messages.length === 0 && (
        <div className="py-16 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
      )}

      {!loading && messages.length === 0 && (
        <div className="py-16 text-center bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <Inbox className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">صندوق دریافت خالی است</p>
          <button onClick={fetchNew} disabled={fetching}
            className="mt-3 text-sm text-teal-500 hover:text-teal-600 font-medium">
            دریافت پیام‌های جدید
          </button>
        </div>
      )}

      <div className="space-y-2">
        {messages.map(msg => (
          <div key={msg.id}
            onClick={() => !msg.is_read && markRead(msg.id)}
            className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 transition cursor-pointer hover:border-gray-200 dark:hover:border-gray-600 ${msg.is_read ? 'border-gray-100 dark:border-gray-700' : 'border-teal-200 dark:border-teal-800 bg-teal-50/30 dark:bg-teal-900/10'}`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <Phone className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 font-mono" dir="ltr">{msg.sender}</span>
                {!msg.is_read && <span className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0" />}
              </div>
              <span className="text-xs text-gray-400 flex-shrink-0" dir="ltr">
                {new Date(msg.received_at).toLocaleString('fa-IR')}
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">{msg.message}</p>
            <p className="text-xs text-gray-300 dark:text-gray-600 mt-1 font-mono" dir="ltr">به: {msg.receiver}</p>
          </div>
        ))}
      </div>
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
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setTab(key as any)}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-colors ${tab === key ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === 'settings' && <SettingsTab />}
      {tab === 'account'  && <AccountTab />}
      {tab === 'send'     && <SendTab />}
      {tab === 'inbox'    && <InboxTab />}
    </div>
  );
}
