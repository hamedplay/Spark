import { useState, useEffect } from 'react';
import { Settings, Database, Shield, Wifi, WifiOff, Key, Check, RefreshCw as RefreshIcon, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import type { HrSsoConfig } from './types';
import { Spinner } from '../Spinner';

function HrSsoConfigPanel({ configs, onSave }: {
  configs: HrSsoConfig[];
  onSave: (config: Partial<HrSsoConfig>) => Promise<void>;
}) {
  const [activeTab, setActiveTab] = useState<'hr' | 'sso'>('hr');
  const hrConfig = configs.find(c => c.config_type === 'hr');
  const ssoConfig = configs.find(c => c.config_type === 'sso');
  const config = activeTab === 'hr' ? hrConfig : ssoConfig;

  const [form, setForm] = useState<Partial<HrSsoConfig>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  useEffect(() => {
    if (config) {
      setForm({ ...config });
    } else {
      setForm({ config_type: activeTab, provider_name: '', base_url: '', api_key: '', client_id: '', client_secret: '', sync_enabled: false, sync_interval_minutes: 60, is_active: false, field_mappings: {} });
    }
    setTestResult(null);
  }, [activeTab, config?.id]);

  const handleSave = async () => {
    setSaving(true);
    try { await onSave({ ...form, config_type: activeTab }); } finally { setSaving(false); }
  };

  const handleTest = async () => {
    if (!form.base_url) { toast.error('آدرس API را وارد کنید'); return; }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(form.base_url, { signal: AbortSignal.timeout(5000) }).catch(() => null);
      if (res && res.ok) {
        setTestResult({ ok: true, msg: `اتصال موفق — وضعیت: ${res.status}` });
      } else {
        setTestResult({ ok: false, msg: res ? `خطا در اتصال — وضعیت: ${res.status}` : 'اتصال برقرار نشد (timeout یا CORS)' });
      }
    } finally { setTesting(false); }
  };

  const HR_PROVIDERS = ['همکاران سیستم', 'نرم‌افزار فردا', 'راهکار', 'سپیدار', 'سایر'];
  const SSO_PROVIDERS = ['Keycloak', 'Active Directory / LDAP', 'Azure AD', 'Okta', 'Google Workspace', 'سایر'];

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
        <h4 className="font-semibold text-gray-800 dark:text-white text-sm flex items-center gap-2">
          <Settings className="w-4 h-4 text-blue-500" />
          یکپارچه‌سازی HR و SSO
        </h4>
        <p className="text-xs text-gray-400 mt-0.5">اتصال به سیستم‌های منابع انسانی و احراز هویت یکپارچه</p>
      </div>

      {/* Type tabs */}
      <div className="flex border-b border-gray-100 dark:border-gray-700">
        <button
          onClick={() => setActiveTab('hr')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${activeTab === 'hr' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          <Database className="w-4 h-4" /> سیستم HR
        </button>
        <button
          onClick={() => setActiveTab('sso')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 text-sm font-medium transition-colors ${activeTab === 'sso' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
        >
          <Shield className="w-4 h-4" /> SSO / احراز هویت
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Status badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {config?.is_active ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 px-3 py-1 rounded-full font-medium">
                <Wifi className="w-3.5 h-3.5" /> فعال
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs text-gray-500 bg-gray-100 dark:bg-gray-700 px-3 py-1 rounded-full font-medium">
                <WifiOff className="w-3.5 h-3.5" /> غیرفعال
              </span>
            )}
            {config?.last_sync_at && (
              <span className="text-xs text-gray-400">
                آخرین همگام‌سازی: {new Date(config.last_sync_at).toLocaleString('fa-IR')}
              </span>
            )}
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <span className="text-xs text-gray-600 dark:text-gray-400">فعال‌سازی</span>
            <div className="relative">
              <input type="checkbox" className="sr-only peer"
                checked={form.is_active || false}
                onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))}
              />
              <div className="w-10 h-5 bg-gray-200 dark:bg-gray-600 peer-checked:bg-blue-600 rounded-full transition-colors" />
              <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow" />
            </div>
          </label>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            {activeTab === 'hr' ? 'سیستم HR' : 'ارائه‌دهنده SSO'}
          </label>
          <select
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={form.provider_name || ''}
            onChange={e => setForm(f => ({ ...f, provider_name: e.target.value }))}
          >
            <option value="">انتخاب کنید</option>
            {(activeTab === 'hr' ? HR_PROVIDERS : SSO_PROVIDERS).map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">آدرس API (Base URL)</label>
          <input
            type="url" dir="ltr"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            value={form.base_url || ''} onChange={e => setForm(f => ({ ...f, base_url: e.target.value }))}
            placeholder="https://hr.company.com/api/v1"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            <Key className="w-3 h-3 inline ml-1" />
            {activeTab === 'hr' ? 'کلید API' : 'Client ID'}
          </label>
          <input
            type="text" dir="ltr"
            className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
            value={activeTab === 'hr' ? (form.api_key || '') : (form.client_id || '')}
            onChange={e => setForm(f => activeTab === 'hr' ? { ...f, api_key: e.target.value } : { ...f, client_id: e.target.value })}
            placeholder={activeTab === 'hr' ? 'sk-...' : 'client_id_...'}
          />
        </div>

        {activeTab === 'sso' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
              <Key className="w-3 h-3 inline ml-1" />Client Secret
            </label>
            <input
              type="password" dir="ltr"
              className="w-full px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-mono"
              value={form.client_secret || ''}
              onChange={e => setForm(f => ({ ...f, client_secret: e.target.value }))}
              placeholder="secret_..."
            />
          </div>
        )}

        {activeTab === 'hr' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">همگام‌سازی خودکار</label>
              <label className="flex items-center gap-2 cursor-pointer">
                <div className="relative">
                  <input type="checkbox" className="sr-only peer"
                    checked={form.sync_enabled || false}
                    onChange={e => setForm(f => ({ ...f, sync_enabled: e.target.checked }))}
                  />
                  <div className="w-10 h-5 bg-gray-200 dark:bg-gray-600 peer-checked:bg-emerald-500 rounded-full transition-colors" />
                  <div className="absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5 shadow" />
                </div>
                <span className="text-sm text-gray-700 dark:text-gray-300">{form.sync_enabled ? 'فعال' : 'غیرفعال'}</span>
              </label>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">بازه همگام‌سازی (دقیقه)</label>
              <input type="number"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                value={form.sync_interval_minutes || 60}
                onChange={e => setForm(f => ({ ...f, sync_interval_minutes: parseInt(e.target.value) || 60 }))}
                min={15} dir="ltr"
              />
            </div>
          </div>
        )}

        {/* Test result */}
        {testResult && (
          <div className={`flex items-center gap-2 p-3 rounded-xl text-sm ${testResult.ok ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'}`}>
            {testResult.ok ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertTriangle className="w-4 h-4 flex-shrink-0" />}
            {testResult.msg}
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button onClick={handleSave} disabled={saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors"
          >
            {saving ? <Spinner className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            ذخیره تنظیمات
          </button>
          <button onClick={handleTest} disabled={testing || !form.base_url}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-40 text-gray-700 dark:text-gray-200 rounded-xl text-sm font-medium transition-colors"
          >
            {testing ? <Spinner className="w-4 h-4 animate-spin" /> : <RefreshIcon className="w-4 h-4" />}
            تست اتصال
          </button>
        </div>
      </div>
    </div>
  );
}

export { HrSsoConfigPanel };
