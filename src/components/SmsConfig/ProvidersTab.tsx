import { useState, useEffect, useCallback, useRef } from 'react';
import { MessageSquare, Plus, Trash2, RefreshCw, Loader as Loader2, EllipsisVertical as MoreVertical, CreditCard as Edit2, Globe, Phone, Lock, User, ChevronDown } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { SmsProvider } from './types';
import { ProviderForm } from './ProviderForm';

function PhoneLoginProviderCard({ providers }: { providers: SmsProvider[] }) {
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [phoneLoginEnabled, setPhoneLoginEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc('get_public_auth_config');
    const row = Array.isArray(data) ? data[0] : data;
    setPhoneLoginEnabled(row?.phone_login_enabled ?? false);
    const { data: providerRow } = await supabase
      .from('system_config')
      .select('value')
      .eq('section', 'sms')
      .eq('key', 'phone_login_sms_provider_id')
      .maybeSingle();
    const value = providerRow?.value?.trim();
    setSelectedProviderId(value ? value : null);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const activeProviders = providers.filter(p => p.is_active);
  const selectedProvider = providers.find(p => p.id === selectedProviderId);
  const selectedIsActive = selectedProvider?.is_active === true;

  let statusLabel = '';
  let statusColor = '';
  if (!phoneLoginEnabled) {
    statusLabel = 'قابلیت ورود موبایلی غیرفعال است (در بخش امنیت فعال کنید)';
    statusColor = 'text-gray-500 dark:text-gray-400';
  } else if (!selectedProviderId) {
    statusLabel = 'فعال ولی سرویس‌دهنده انتخاب نشده';
    statusColor = 'text-amber-600 dark:text-amber-400';
  } else if (!selectedIsActive) {
    statusLabel = 'سرویس‌دهنده انتخابی غیرفعال است';
    statusColor = 'text-red-500 dark:text-red-400';
  } else {
    statusLabel = 'فعال و آماده';
    statusColor = 'text-green-600 dark:text-green-400';
  }

  const handleSelect = async (id: string | null) => {
    setSaving(true);
    const { data, error } = await supabase.rpc('set_phone_login_sms_provider', {
      p_provider_id: id ?? null,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row || row.success !== true || row.provider_id !== (id ?? null)) {
      toast.error(row?.error || error?.message || 'ذخیره سرویس‌دهنده تأیید نشد');
      setSaving(false);
      await load();
      return;
    }
    await load();
    setSaving(false);
    toast.success(id ? 'سرویس‌دهنده ورود موبایلی انتخاب شد' : 'انتخاب سرویس‌دهنده پاک شد');
  };

  if (loading) return <div className="py-4 text-center"><Loader2 className="w-4 h-4 animate-spin mx-auto text-gray-300" /></div>;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
          <Phone className="w-4.5 h-4.5" />
        </div>
        <div>
          <h4 className="font-semibold text-gray-800 dark:text-white">پیامک احراز هویت و ورود</h4>
          <p className={`text-xs font-medium ${statusColor}`}>{statusLabel}</p>
        </div>
      </div>

      <div className="space-y-2 pt-2 border-t border-gray-100 dark:border-gray-700">
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400">سرویس‌دهنده ارسال کد ورود</label>
        {activeProviders.length === 0 ? (
          <p className="text-xs text-gray-400">هیچ سرویس‌دهنده فعالی موجود نیست. ابتدا یک سرویس‌دهنده فعال کنید.</p>
        ) : (
          <div className="relative">
            <select
              value={selectedProviderId || ''}
              onChange={e => handleSelect(e.target.value || null)}
              disabled={saving}
              className="appearance-none w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 [&>option]:bg-white [&>option]:text-gray-900 dark:[&>option]:bg-gray-700 dark:[&>option]:text-white"
            >
              <option value="">— انتخاب کنید —</option>
              {activeProviders.map(p => (
                <option key={p.id} value={p.id}>
                  {p.title} ({p.provider_type === 'rahyab' ? 'SOAP' : p.provider_type === 'rahyab_rest' ? 'REST' : 'REST API'})
                </option>
              ))}
            </select>
            <ChevronDown className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        )}
        {saving && <p className="text-xs text-gray-400">در حال ذخیره...</p>}
      </div>
    </div>
  );
}

export function ProvidersTab() {
  const [providers, setProviders] = useState<SmsProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<SmsProvider> | null | 'new'>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.from('sms_providers').select('*').order('created_at');
    setProviders((data || []) as SmsProvider[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const deleteProvider = async (id: string) => {
    await supabase.from('sms_providers').delete().eq('id', id);
    toast.success('سرویس‌دهنده حذف شد');
    load();
  };

  if (editing !== null) {
    return <ProviderForm
      provider={editing === 'new' ? null : editing}
      onSave={() => { setEditing(null); load(); }}
      onCancel={() => setEditing(null)}
    />;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500 dark:text-gray-400">{providers.length} سرویس‌دهنده</span>
        <div className="flex gap-2">
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button onClick={() => setEditing('new')}
            className="flex items-center gap-2 px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium transition">
            <Plus className="w-4 h-4" />افزودن سرویس‌دهنده
          </button>
        </div>
      </div>

      {loading && <div className="py-10 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}
      {!loading && providers.length === 0 && (
        <div className="py-14 text-center bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <Globe className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">هیچ سرویس‌دهنده‌ای تعریف نشده</p>
          <button onClick={() => setEditing('new')} className="mt-3 text-sm text-green-500 hover:text-green-600 font-medium">افزودن اولین سرویس‌دهنده</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {providers.map(p => (
          <div key={p.id} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <div className="flex items-start justify-between gap-3 mb-3">
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${p.is_active ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                  <MessageSquare className={`w-5 h-5 ${p.is_active ? 'text-green-500' : 'text-gray-400'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 dark:text-white truncate">{p.title}</p>
                  <p className="text-xs text-gray-400 font-mono">{p.provider_type === 'rahyab' ? 'رهیاب رایان — SOAP' : p.provider_type === 'rahyab_rest' ? 'رهیاب رایان — REST' : (p.provider_name || 'REST API')}</p>
                </div>
              </div>
              <div className="relative flex-shrink-0" ref={menuOpen === p.id ? menuRef : undefined}>
                <button onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === p.id ? null : p.id); }}
                  className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
                  <MoreVertical className="w-4 h-4" />
                </button>
                {menuOpen === p.id && (
                  <div className="absolute left-0 top-full mt-1 w-40 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1">
                    <button onClick={() => { setEditing(p); setMenuOpen(null); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right text-sm text-gray-700 dark:text-gray-200 transition-colors">
                      <Edit2 className="w-3.5 h-3.5 text-blue-500" />ویرایش
                    </button>
                    <button onClick={() => { deleteProvider(p.id); setMenuOpen(null); }}
                      className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700 text-right text-sm text-red-500 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />حذف
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-2 text-xs text-gray-500 dark:text-gray-400">
              {p.line_number && <div className="flex items-center gap-2"><Phone className="w-3.5 h-3.5 flex-shrink-0" /><span className="font-mono">خط: {p.line_number}</span></div>}
              {p.api_url && <div className="flex items-center gap-2 truncate"><Globe className="w-3.5 h-3.5 flex-shrink-0" /><span className="truncate font-mono">{p.api_url}</span></div>}
              {p.api_key && <div className="flex items-center gap-2"><Lock className="w-3.5 h-3.5 flex-shrink-0" /><span className="font-mono">{'*'.repeat(12)}{p.api_key.slice(-4)}</span></div>}
              {p.username && <div className="flex items-center gap-2"><User className="w-3.5 h-3.5 flex-shrink-0" />{p.username}</div>}
            </div>

            <div className="flex flex-wrap gap-2 mt-3">
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${p.provider_type === 'rahyab' ? 'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300' : p.provider_type === 'rahyab_rest' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
                {p.provider_type === 'rahyab' ? 'رهیاب رایان SOAP' : p.provider_type === 'rahyab_rest' ? 'رهیاب رایان REST' : 'REST API'}
              </span>
              <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${p.is_active ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'}`}>
                {p.is_active ? 'فعال' : 'غیرفعال'}
              </span>
              {p.is_public_gateway && <span className="text-xs px-2.5 py-1 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400">درگاه عمومی</span>}
              {p.is_default && <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400">پیش‌فرض</span>}
            </div>
          </div>
        ))}
      </div>

      {!loading && providers.length > 0 && <PhoneLoginProviderCard providers={providers} />}
    </div>
  );
}
