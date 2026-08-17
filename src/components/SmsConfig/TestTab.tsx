import { useState, useEffect, useRef } from 'react';
import { FlaskConical, Phone, Loader as Loader2, ChevronDown, Info, Wifi, WifiOff, Send, Check, CircleAlert as AlertCircle, Circle as XCircle, CircleMinus as MinusCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { DebugLog, RequestLogPanel } from '../RahyabConfigPanel';
import type { SmsProvider, TestStatus, RahyabTestCard } from './types';
import { inp, RAHYAB_TESTS, RAHYAB_REST_TESTS, DELIVERY_STATUS } from './types';

export function TestTab() {
  const [providers, setProviders] = useState<SmsProvider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('');
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('این یک پیامک آزمایشی از سامانه است.');
  const [returnIdInput, setReturnIdInput] = useState('');

  const [connStatus, setConnStatus] = useState<TestStatus>('idle');
  const [connResult, setConnResult] = useState<any>(null);
  const [sendStatus, setSendStatus] = useState<TestStatus>('idle');
  const [sendResult, setSendResult] = useState<any>(null);

  const [rahyabStatus, setRahyabStatus] = useState<Record<string, TestStatus>>({});
  const [rahyabResult, setRahyabResult] = useState<Record<string, any>>({});
  const [runningAll, setRunningAll] = useState(false);

  const [rahyabRestStatus, setRahyabRestStatus] = useState<Record<string, TestStatus>>({});
  const [rahyabRestResult, setRahyabRestResult] = useState<Record<string, any>>({});
  const [runningAllRest, setRunningAllRest] = useState(false);
  const [lastRowIdInput, setLastRowIdInput] = useState('0');

  const lastRahyabRequestAtRef = useRef<Partial<Record<'delivery' | 'receive', number>>>({});
  const rahyabRequestRunningRef = useRef<Partial<Record<'delivery' | 'receive', boolean>>>({});

  const [debugLogs, setDebugLogs] = useState<DebugLog[]>([]);

  const selectedProviderObj = providers.find(p => p.id === selectedProvider);
  const isRahyabProvider = selectedProviderObj?.provider_type === 'rahyab';
  const isRahyabRestProvider = selectedProviderObj?.provider_type === 'rahyab_rest';

  useEffect(() => {
    supabase.from('sms_providers').select('*').eq('is_active', true).order('created_at')
      .then(({ data }) => {
        const list = (data || []) as SmsProvider[];
        setProviders(list);
        const def = list.find(p => p.is_default) || list[0];
        if (def) setSelectedProvider(def.id);
      });
  }, []);

  const resetAll = () => {
    setConnResult(null); setSendResult(null);
    setConnStatus('idle'); setSendStatus('idle');
    setRahyabStatus({}); setRahyabResult({});
    setRahyabRestStatus({}); setRahyabRestResult({});
    setDebugLogs([]);
  };

  const callEdge = async (body: object) => {
    const { data: { session } } = await supabase.auth.getSession();
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const res = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session?.access_token || anonKey}`,
        'Apikey': anonKey,
      },
      body: JSON.stringify(body),
    });
    return res.json();
  };

  const testConnection = async () => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    setConnStatus('loading'); setConnResult(null);
    try {
      const result = await callEdge({ mode: 'test_connection', providerId: selectedProvider });
      setConnResult(result);
      setConnStatus(result.ok ? 'ok' : 'error');
      if (result.debug?.length) { setDebugLogs(prev => [...prev, ...result.debug]); }
      if (result.ok) toast.success('اتصال به سرویس پیامک برقرار است');
      else toast.error('خطا در اتصال: ' + (result.error || ''));
    } catch (e: any) {
      setConnResult({ error: e.message }); setConnStatus('error');
    }
  };

  const sendTest = async () => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    if (!testPhone.trim()) { toast.error('شماره موبایل الزامی است'); return; }
    if (!testMessage.trim()) { toast.error('متن پیام الزامی است'); return; }
    setSendStatus('loading'); setSendResult(null);
    try {
      const result = await callEdge({ mode: 'send', providerId: selectedProvider, mobiles: [testPhone.trim()], message: testMessage.trim() });
      setSendResult(result);
      setSendStatus(result.ok ? 'ok' : 'error');
      if (result.debug?.length) { setDebugLogs(prev => [...prev, ...result.debug]); }
      if (result.ok) toast.success(`پیامک تست ارسال شد — شناسه بسته: ${result.packId || '—'}`);
      else toast.error('خطا در ارسال: ' + (result.error || ''));
    } catch (e: any) {
      setSendResult({ error: e.message }); setSendStatus('error');
    }
  };

  const runRahyabTest = async (card: RahyabTestCard) => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    if (card.needsPhone && !testPhone.trim()) { toast.error('شماره موبایل الزامی است'); return; }
    if (card.needsMessage && !testMessage.trim()) { toast.error('متن پیام الزامی است'); return; }

    setRahyabStatus(s => ({ ...s, [card.id]: 'loading' }));
    setRahyabResult(r => ({ ...r, [card.id]: null }));

    try {
      let payload: Record<string, unknown>;
      if (card.action === 'send') {
        payload = { action: 'send', mobiles: [testPhone.trim()], message: testMessage.trim(), isFarsi: true };
      } else if (card.action === 'get_delivery') {
        const ids = returnIdInput.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean);
        if (!ids.length) { toast.error('شناسه بازگشتی الزامی است'); setRahyabStatus(s => ({ ...s, [card.id]: 'idle' })); return; }
        payload = { action: 'get_delivery', returnIds: ids };
      } else {
        payload = { action: card.action };
      }

      const result = await callEdge({ mode: 'rahyab_test', providerId: selectedProvider, rahyabPayload: payload });
      setRahyabResult(r => ({ ...r, [card.id]: result }));
      setRahyabStatus(s => ({ ...s, [card.id]: result.ok ? 'ok' : 'error' }));

      if (result.debug?.length) {
        setDebugLogs(prev => [...prev, ...result.debug]);
      }

      if (card.action === 'send' && result.ok && result.returnIds?.length) {
        setReturnIdInput(result.returnIds.join(', '));
      }
    } catch (e: any) {
      setRahyabResult(r => ({ ...r, [card.id]: { error: e.message } }));
      setRahyabStatus(s => ({ ...s, [card.id]: 'error' }));
    }
  };

  const runAllRahyabTests = async () => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    setRunningAll(true);
    for (const card of RAHYAB_TESTS) {
      if (card.needsPhone && !testPhone.trim()) continue;
      if (card.needsMessage && !testMessage.trim()) continue;
      await runRahyabTest(card);
      await new Promise(r => setTimeout(r, 400));
    }
    setRunningAll(false);
    toast.success('همه تست‌های رهیاب رایان اجرا شدند');
  };

  const isValidReturnId = (value: unknown): value is string => {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return false;
    return value.replace(/^0+/, '').length > 0;
  };

  const waitForRahyabRateLimit = async (action: 'delivery' | 'receive'): Promise<void> => {
    const minMs = action === 'delivery' ? 1100 : 3100;
    const last = lastRahyabRequestAtRef.current[action] ?? 0;
    const remaining = minMs - (Date.now() - last);
    if (remaining > 0) await new Promise<void>(r => window.setTimeout(r, remaining));
    lastRahyabRequestAtRef.current[action] = Date.now();
  };

  const runRahyabRestTest = async (card: RahyabTestCard) => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    if (card.needsPhone && !testPhone.trim()) { toast.error('شماره موبایل الزامی است'); return; }
    if (card.needsMessage && !testMessage.trim()) { toast.error('متن پیام الزامی است'); return; }

    const rateLimitedAction = (card.action === 'delivery' || card.action === 'receive') ? card.action : null;

    if (rateLimitedAction && rahyabRequestRunningRef.current[rateLimitedAction]) return;
    if (rateLimitedAction) rahyabRequestRunningRef.current[rateLimitedAction] = true;

    setRahyabRestStatus(s => ({ ...s, [card.id]: 'loading' }));
    setRahyabRestResult(r => ({ ...r, [card.id]: null }));

    try {
      let payload: Record<string, unknown>;
      if (card.action === 'send') {
        payload = { action: 'send', to: testPhone.trim(), message: testMessage.trim() };
      } else if (card.action === 'delivery') {
        const ids = returnIdInput.trim();
        if (!ids) { toast.error('شناسه بازگشتی الزامی است'); setRahyabRestStatus(s => ({ ...s, [card.id]: 'idle' })); return; }
        payload = { action: 'delivery', returnIds: ids };
      } else if (card.action === 'receive') {
        payload = { action: 'receive', lastRowId: lastRowIdInput.trim() || '0' };
      } else {
        payload = { action: card.action };
      }

      if (rateLimitedAction) await waitForRahyabRateLimit(rateLimitedAction);

      const result = await callEdge({ mode: 'rahyab_rest_test', providerId: selectedProvider, ...payload });
      setRahyabRestResult(r => ({ ...r, [card.id]: result }));

      let uiStatus: TestStatus;
      if (card.action === 'delivery') {
        const ds = result.status as string | undefined;
        uiStatus = ds === 'delivered' ? 'ok'
          : ds === 'pending' || ds === 'partial' ? 'partial'
          : 'error';
      } else {
        uiStatus = result.ok ? (result.status === 'partial_success' ? 'partial' : 'ok') : 'error';
      }
      setRahyabRestStatus(s => ({ ...s, [card.id]: uiStatus }));

      if (result.debug?.length) setDebugLogs(prev => [...prev, ...result.debug]);
      if (card.action === 'send' && result.ok) {
        const firstId: string | undefined = result.returnIds?.[0] ?? result.returnId;
        if (isValidReturnId(firstId)) {
          setReturnIdInput(firstId);
          const toastMsg = result.status === 'partial_success'
            ? `ارسال جزئی — شناسه: ${firstId} (برخی شناسه‌ها ناموفق بودند)`
            : `پیامک آزمایشی با موفقیت ارسال شد — شناسه: ${firstId}`;
          toast.success(toastMsg);
        }
      }
      if (card.action === 'receive' && result.ok && result.nextLastRowId && result.nextLastRowId !== '0') {
        setLastRowIdInput(result.nextLastRowId);
      }
    } catch (e: any) {
      setRahyabRestResult(r => ({ ...r, [card.id]: { error: e.message } }));
      setRahyabRestStatus(s => ({ ...s, [card.id]: 'error' }));
    } finally {
      if (rateLimitedAction) rahyabRequestRunningRef.current[rateLimitedAction] = false;
    }
  };

  const runAllRahyabRestTests = async () => {
    if (!selectedProvider) { toast.error('ابتدا یک سرویس‌دهنده انتخاب کنید'); return; }
    setRunningAllRest(true);
    for (const card of RAHYAB_REST_TESTS) {
      if (card.needsPhone && !testPhone.trim()) continue;
      if (card.needsMessage && !testMessage.trim()) continue;
      await runRahyabRestTest(card);
    }
    setRunningAllRest(false);
    toast.success('همه تست‌های رهیاب رایان REST اجرا شدند');
  };

  const StatusBadge = ({ status }: { status: TestStatus }) => {
    if (status === 'idle') return null;
    if (status === 'loading') return <Loader2 className="w-4 h-4 animate-spin text-blue-500" />;
    if (status === 'ok') return <Check className="w-4 h-4 text-green-500" />;
    if (status === 'partial') return <MinusCircle className="w-4 h-4 text-amber-500" />;
    return <AlertCircle className="w-4 h-4 text-red-500" />;
  };

  const RahyabResultBox = ({ cardId }: { cardId: string }) => {
    const status = rahyabStatus[cardId];
    const result = rahyabResult[cardId];
    if (!result || status === 'idle' || status === 'loading') return null;
    const isOk = status === 'ok';
    return (
      <div className={`mt-3 rounded-xl border p-3 text-xs font-mono leading-relaxed space-y-1 ${isOk ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
        <p className={`font-bold mb-1 ${isOk ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{isOk ? 'موفق' : 'خطا'}</p>
        {result.error && <p className="text-red-600 dark:text-red-400 break-all"><span className="font-semibold">خطا: </span>{result.error}</p>}
        {result.result && <p className="text-gray-700 dark:text-gray-300 break-all"><span className="font-semibold">نتیجه: </span>{result.result}</p>}
        {result.credit !== undefined && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">اعتبار: </span>{result.credit}</p>}
        {result.expireDate !== undefined && result.expireDate !== '' && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">انقضا: </span>{result.expireDate}</p>}
        {result.sent !== undefined && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">ارسال شد: </span>{result.sent} شماره</p>}
        {result.returnIds?.length > 0 && <p className="text-gray-600 dark:text-gray-300 break-all"><span className="font-semibold">ReturnIDs: </span>{result.returnIds.join(', ')}</p>}
        {result.count !== undefined && <p className="text-gray-700 dark:text-gray-300"><span className="font-semibold">تعداد پیام: </span>{result.count}</p>}
        {result.delivery && (
          <div className="mt-1 space-y-0.5">
            <p className="font-semibold text-gray-700 dark:text-gray-300">وضعیت تحویل:</p>
            {Object.entries(result.delivery as Record<string, number>).map(([id, code]) => {
              const ds = DELIVERY_STATUS[code] || { label: `کد ${code}`, color: 'text-gray-500' };
              return <p key={id} className={ds.color}><span className="text-gray-500 dark:text-gray-400">{id}: </span>{ds.label}</p>;
            })}
          </div>
        )}
        {(result.rawXml || result.messages) && (
          <details className="mt-1">
            <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">پاسخ کامل (کلیک)</summary>
            <pre className="mt-2 overflow-x-auto text-[11px] text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 p-2 rounded-lg border border-gray-200 dark:border-gray-700 whitespace-pre-wrap break-all max-h-48">
              {result.rawXml || JSON.stringify(result.messages, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  };

  const RestResultBox = ({ result, status }: { result: any; status: TestStatus }) => {
    if (!result || status === 'idle' || status === 'loading') return null;
    const isOk = status === 'ok';
    return (
      <div className={`mt-3 rounded-xl border p-4 text-xs font-mono leading-relaxed space-y-1 ${isOk ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
        <p className={`font-bold mb-2 text-sm ${isOk ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{isOk ? 'موفق' : 'خطا'}</p>
        {result.error && <p className="text-red-600 dark:text-red-400 break-all"><span className="font-semibold">پیام خطا: </span>{result.error}</p>}
        {result.credit !== undefined && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">اعتبار حساب: </span>{result.credit}</p>}
        {result.sent !== undefined && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">ارسال شده به: </span>{result.sent} شماره</p>}
        {result.packId && <p className="text-gray-600 dark:text-gray-300 break-all"><span className="font-semibold">Pack ID: </span>{result.packId}</p>}
        {result.cost !== undefined && <p className="text-gray-600 dark:text-gray-300"><span className="font-semibold">هزینه: </span>{result.cost}</p>}
        {result.response && (
          <details className="mt-2">
            <summary className="cursor-pointer text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">پاسخ کامل سرور (کلیک برای نمایش)</summary>
            <pre className="mt-2 overflow-x-auto text-[11px] text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-700 whitespace-pre-wrap break-all">
              {JSON.stringify(result.response, null, 2)}
            </pre>
          </details>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <FlaskConical className="w-4 h-4 text-green-500" />
          <h4 className="font-semibold text-gray-800 dark:text-white text-sm">انتخاب سرویس‌دهنده</h4>
        </div>
        {providers.length === 0 ? (
          <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            هیچ سرویس‌دهنده فعالی یافت نشد. ابتدا در تب «سرویس‌دهندگان» یک سرویس‌دهنده فعال تعریف کنید.
          </div>
        ) : (
          <div className="relative">
            <select
              dir="rtl"
              className={inp + ' appearance-none pl-8'}
              value={selectedProvider}
              onChange={e => { setSelectedProvider(e.target.value); resetAll(); }}
            >
              {!selectedProvider && (
                <option value="" disabled>انتخاب سرویس‌دهنده...</option>
              )}
              {providers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title}{p.is_default ? ' (پیش‌فرض)' : ''}{p.provider_type === 'rahyab' ? ' — SOAP' : p.provider_type === 'rahyab_rest' ? ' — REST' : p.line_number ? ` — ${p.line_number}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}
      </div>

      {isRahyabProvider && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Phone className="w-4 h-4 text-teal-500" />
              <h4 className="font-semibold text-gray-800 dark:text-white text-sm">اطلاعات مورد نیاز تست‌ها</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره موبایل (برای تست ۳)</label>
                <input className={inp} value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="09121234567" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شناسه بازگشتی (برای تست ۴)</label>
                <input className={inp} value={returnIdInput} onChange={e => setReturnIdInput(e.target.value)} placeholder="خودکار از تست ۳ پر می‌شود" dir="ltr" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">متن پیامک (برای تست ۳)</label>
                <input className={inp} value={testMessage} onChange={e => setTestMessage(e.target.value)} />
              </div>
            </div>
            <button
              onClick={runAllRahyabTests}
              disabled={runningAll || providers.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition"
            >
              {runningAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              {runningAll ? 'در حال اجرا...' : 'اجرای همه تست‌ها'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {RAHYAB_TESTS.map(card => {
              const st = rahyabStatus[card.id] || 'idle';
              const borderCls = st === 'ok' ? 'border-green-200 dark:border-green-800' : st === 'error' ? 'border-red-200 dark:border-red-800' : 'border-gray-100 dark:border-gray-700';
              return (
                <div key={card.id} className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 space-y-2 ${borderCls}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-white text-sm">{card.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{card.desc}</p>
                    </div>
                    <StatusBadge status={st} />
                  </div>
                  <button
                    onClick={() => runRahyabTest(card)}
                    disabled={st === 'loading' || runningAll}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-xs font-medium transition"
                  >
                    {st === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                    {st === 'loading' ? 'در حال اجرا...' : 'اجرای تست'}
                  </button>
                  <RahyabResultBox cardId={card.id} />
                </div>
              );
            })}
          </div>

          <div className="bg-teal-50 dark:bg-teal-900/10 border border-teal-200 dark:border-teal-800 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-teal-600 dark:text-teal-400 flex-shrink-0" />
              <p className="text-sm font-semibold text-teal-700 dark:text-teal-300">راهنمای رفع مشکل رهیاب رایان</p>
            </div>
            <ul className="text-xs text-teal-700 dark:text-teal-400 space-y-1.5 list-disc list-inside leading-relaxed">
              <li>خطای احراز هویت: نام کاربری یا توکن را بررسی کنید — توکن مقدم‌تر است</li>
              <li>وضعیت تحویل <strong>0</strong>: نامشخص | <strong>2</strong>: تحویل داده شد | <strong>5</strong>: تحویل نشد | <strong>9</strong>: بلاک شده</li>
              <li>timeout در اتصال: آدرس SOAP URL را بررسی کنید (پیش‌فرض: RahyabBulk.ir)</li>
              <li>پیامک ارسال شده اما ReturnID منفی: شماره اختصاصی صحیح نیست</li>
              <li>doReceiveSMSByFlag: پیام‌های خوانده‌شده را پرچم‌گذاری می‌کند — هر پیام فقط یکبار برمی‌گردد</li>
            </ul>
          </div>

          {debugLogs.length > 0 && (
            <RequestLogPanel
              logs={debugLogs}
              onClear={() => setDebugLogs([])}
            />
          )}
        </>
      )}

      {isRahyabRestProvider && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <Phone className="w-4 h-4 text-blue-500" />
              <h4 className="font-semibold text-gray-800 dark:text-white text-sm">اطلاعات مورد نیاز تست‌ها</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره موبایل (برای تست ۳)</label>
                <input className={inp} value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="09121234567" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شناسه بازگشتی (برای تست تحویل)</label>
                <input className={inp} value={returnIdInput} onChange={e => setReturnIdInput(e.target.value)} placeholder="خودکار از تست ارسال پر می‌شود" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">آخرین ردیف دریافت‌شده (برای تست دریافت)</label>
                <input className={inp} value={lastRowIdInput} onChange={e => setLastRowIdInput(e.target.value)} placeholder="0" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">متن پیامک (برای تست ارسال)</label>
                <input className={inp} value={testMessage} onChange={e => setTestMessage(e.target.value)} />
              </div>
            </div>
            <button
              onClick={runAllRahyabRestTests}
              disabled={runningAllRest || providers.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition"
            >
              {runningAllRest ? <Loader2 className="w-4 h-4 animate-spin" /> : <FlaskConical className="w-4 h-4" />}
              {runningAllRest ? 'در حال اجرا...' : 'اجرای همه تست‌ها'}
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {RAHYAB_REST_TESTS.map(card => {
              const st = rahyabRestStatus[card.id] || 'idle';
              const result = rahyabRestResult[card.id];
              const borderCls = st === 'ok' ? 'border-green-200 dark:border-green-800' : st === 'partial' ? 'border-amber-200 dark:border-amber-800' : st === 'error' ? 'border-red-200 dark:border-red-800' : 'border-gray-100 dark:border-gray-700';
              const isOk = st === 'ok' || st === 'partial';
              return (
                <div key={card.id} className={`bg-white dark:bg-gray-800 rounded-2xl border p-4 space-y-2 ${borderCls}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-800 dark:text-white text-sm">{card.title}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{card.desc}</p>
                    </div>
                    <StatusBadge status={st} />
                  </div>
                  <button
                    onClick={() => runRahyabRestTest(card)}
                    disabled={st === 'loading' || runningAllRest}
                    className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-xs font-medium transition"
                  >
                    {st === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FlaskConical className="w-3.5 h-3.5" />}
                    {st === 'loading' ? 'در حال اجرا...' : 'اجرای تست'}
                  </button>
                  {result && st !== 'idle' && st !== 'loading' && (
                    <div className={`mt-2 rounded-xl border p-3 text-xs font-mono leading-relaxed space-y-1.5 ${st === 'partial' ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800' : isOk ? 'bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'}`}>
                      <p className={`font-bold mb-1 ${st === 'partial' ? 'text-amber-700 dark:text-amber-400' : isOk ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>
                        {card.action === 'delivery'
                          ? result.status === 'delivered' ? 'تحویل شده'
                            : result.status === 'pending' ? 'در انتظار تعیین وضعیت'
                            : result.status === 'partial' ? 'وضعیت ترکیبی'
                            : result.status === 'failed' ? 'تحویل نشده / بلاک شده'
                            : result.status === 'not_found' ? 'شناسه در سامانه پیدا نشد'
                            : 'خطا'
                          : st === 'partial' ? 'موفق جزئی' : isOk ? 'موفق' : 'خطا'}
                      </p>
                      {result.error && <p className="text-red-600 dark:text-red-400 break-all"><span className="font-semibold">خطا: </span>{result.error}</p>}
                      {result.ip && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">IP: </span>{result.ip}</p>}
                      {result.returnIds?.length > 0 && <p className="text-gray-600 dark:text-gray-300 break-all"><span className="font-semibold">ReturnIDs: </span>{result.returnIds.join('، ')}</p>}
                      {result.failedReturnIds?.length > 0 && <p className="text-amber-600 dark:text-amber-400 break-all"><span className="font-semibold">شناسه‌های ناموفق: </span>{result.failedReturnIds.join('، ')}</p>}
                      {result.accountInfo && (
                        <div className="space-y-0.5">
                          {result.accountInfo.credit != null && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">اعتبار: </span>{result.accountInfo.credit}</p>}
                          {result.accountInfo.active != null && <p className="text-green-700 dark:text-green-300"><span className="font-semibold">وضعیت: </span>{result.accountInfo.active ? 'فعال' : 'غیرفعال'}</p>}
                          {result.accountInfo.expireDate && <p className="text-gray-600 dark:text-gray-300"><span className="font-semibold">انقضا: </span>{result.accountInfo.expireDate}</p>}
                          {result.accountInfo.shortCodes?.length > 0 && <p className="text-gray-600 dark:text-gray-300 break-all"><span className="font-semibold">خط ارسال: </span>{result.accountInfo.shortCodes.join('، ')}</p>}
                        </div>
                      )}
                      {Array.isArray(result.delivery) && result.delivery.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          <p className="font-semibold text-gray-700 dark:text-gray-300">وضعیت تحویل:</p>
                          {(result.delivery as Array<{ returnId: string; code: string; statusLabel: string }>).map(item => {
                            const colorCls = item.code === '2' ? 'text-green-600 dark:text-green-400'
                              : item.code === '5' ? 'text-red-500 dark:text-red-400'
                              : item.code === '9' ? 'text-red-700 dark:text-red-500'
                              : item.code === '-1' ? 'text-gray-500'
                              : 'text-amber-600 dark:text-amber-400';
                            return <p key={item.returnId} className={colorCls}><span className="text-gray-500 dark:text-gray-400">{item.returnId}: </span>{item.statusLabel}</p>;
                          })}
                        </div>
                      )}
                      {result.messageCount !== undefined && (
                        <p className="text-gray-700 dark:text-gray-300"><span className="font-semibold">تعداد پیام: </span>{result.messageCount}</p>
                      )}
                      {result.nextLastRowId && result.nextLastRowId !== '0' && (
                        <p className="text-gray-600 dark:text-gray-400"><span className="font-semibold">آخرین ردیف: </span>{result.nextLastRowId}</p>
                      )}
                      {Array.isArray(result.messages) && result.messages.length > 0 && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">پیام‌های دریافتی ({result.messages.length}) — کلیک برای نمایش</summary>
                          <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
                            {(result.messages as Array<{ rowId: string; sender: string; receiver: string; time: string; message: string }>).map((m, i) => (
                              <div key={m.rowId || i} className="bg-white dark:bg-gray-900 rounded-lg p-2 border border-gray-200 dark:border-gray-700 text-[11px] space-y-0.5">
                                <p><span className="text-gray-500">از: </span>{m.sender} <span className="text-gray-400 mx-1">|</span> <span className="text-gray-500">به: </span>{m.receiver} <span className="text-gray-400 mx-1">|</span> <span className="text-gray-500">زمان: </span>{m.time}</p>
                                <p className="text-gray-700 dark:text-gray-200 break-all">{m.message}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                      {result.rawResult && (
                        <details className="mt-1">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-700 dark:hover:text-gray-200">پاسخ خام سرور (کلیک)</summary>
                          <pre className="mt-2 overflow-x-auto text-[11px] text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-900 p-2 rounded-lg border border-gray-200 dark:border-gray-700 whitespace-pre-wrap break-all max-h-48">
                            {result.rawResult}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">راهنمای رهیاب رایان REST API</p>
            </div>
            <ul className="text-xs text-blue-700 dark:text-blue-400 space-y-1.5 list-disc list-inside leading-relaxed">
              <li>اگر توکن وارد شده باشد، Username برابر توکن و Password یک رشته تصادفی ۵+ کاراکتری ارسال می‌شود</li>
              <li>تست اتصال IP عمومی Edge Function را برمی‌گرداند — باید با IP مجاز در پنل رهیاب تطابق داشته باشد</li>
              <li>تست ارسال: شناسه بازگشتی را در فیلد «شناسه بازگشتی» ذخیره می‌کند تا برای تست تحویل آماده باشد</li>
              <li>تست تحویل: از ReturnID تست ارسال استفاده می‌کند — اگر خالی است ابتدا تست ارسال را اجرا کنید</li>
              <li>تست دریافت: مقدار lastRowId=0 اولین پیام‌های خوانده‌نشده را برمی‌گرداند</li>
              <li>خطای اتصال: پورت ۸۴۴۳ ممکن است توسط فایروال بلاک شده باشد — آدرس پایه API را بررسی کنید</li>
            </ul>
          </div>

          {debugLogs.length > 0 && (
            <RequestLogPanel
              logs={debugLogs}
              onClear={() => setDebugLogs([])}
            />
          )}
        </>
      )}

      {!isRahyabProvider && !isRahyabRestProvider && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {connStatus === 'ok' ? <Wifi className="w-4 h-4 text-green-500" /> : connStatus === 'error' ? <WifiOff className="w-4 h-4 text-red-500" /> : <Wifi className="w-4 h-4 text-gray-400" />}
                <h4 className="font-semibold text-gray-800 dark:text-white text-sm">مرحله ۱ — تست اتصال و اعتبار</h4>
              </div>
              <StatusBadge status={connStatus} />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">بررسی می‌کند که کلید API معتبر است و مقدار اعتبار حساب را نمایش می‌دهد.</p>
            <button onClick={testConnection} disabled={connStatus === 'loading' || providers.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition">
              {connStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
              {connStatus === 'loading' ? 'در حال بررسی...' : 'بررسی اتصال'}
            </button>
            <RestResultBox result={connResult} status={connStatus} />
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-green-500" />
                <h4 className="font-semibold text-gray-800 dark:text-white text-sm">مرحله ۲ — ارسال پیامک آزمایشی</h4>
              </div>
              <StatusBadge status={sendStatus} />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">یک پیامک واقعی به شماره زیر ارسال می‌کند. از اعتبار حساب کسر می‌شود.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">شماره موبایل هدف *</label>
                <input className={inp} value={testPhone} onChange={e => setTestPhone(e.target.value)} placeholder="09121234567" dir="ltr" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">متن پیامک *</label>
                <textarea className={inp + ' resize-none'} rows={3} value={testMessage} onChange={e => setTestMessage(e.target.value)} />
                <p className={`text-xs mt-1 ${testMessage.length > 160 ? 'text-amber-500' : 'text-gray-400'}`}>
                  {testMessage.length} کاراکتر {testMessage.length > 160 ? '— بیش از ۱ پیامک' : ''}
                </p>
              </div>
            </div>
            <button onClick={sendTest} disabled={sendStatus === 'loading' || providers.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition">
              {sendStatus === 'loading' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              {sendStatus === 'loading' ? 'در حال ارسال...' : 'ارسال پیامک تست'}
            </button>
            <RestResultBox result={sendResult} status={sendStatus} />
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 space-y-2">
            <div className="flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">راهنمای رفع مشکل</p>
            </div>
            <ul className="text-xs text-amber-700 dark:text-amber-400 space-y-1.5 list-disc list-inside leading-relaxed">
              <li>کد وضعیت <strong>10</strong>: کلید API نامعتبر است — از پنل sms.ir کلید جدید دریافت کنید</li>
              <li>کد وضعیت <strong>11</strong>: کلید API غیرفعال است — از پنل آن را فعال کنید</li>
              <li>کد وضعیت <strong>101</strong>: شماره خط نامعتبر است — شماره خط را از پنل sms.ir بررسی کنید</li>
              <li>کد وضعیت <strong>102</strong>: اعتبار کافی نیست — حساب را شارژ کنید</li>
              <li>کد وضعیت <strong>104</strong>: فرمت شماره موبایل اشتباه است (باید با ۰۹ یا ۹۸ شروع شود)</li>
              <li>کد وضعیت <strong>123</strong>: خط ارسال نیاز به فعال‌سازی دارد — با پشتیبانی sms.ir تماس بگیرید</li>
              <li>خطای اتصال: Edge Function نمی‌تواند به api.sms.ir متصل شود — سرویس Supabase را بررسی کنید</li>
            </ul>
          </div>

          {debugLogs.length > 0 && (
            <RequestLogPanel
              logs={debugLogs}
              onClear={() => setDebugLogs([])}
            />
          )}
        </>
      )}
    </div>
  );
}
