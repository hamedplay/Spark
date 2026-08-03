import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Smartphone, KeyRound, CircleCheck as CheckCircle2, Circle as XCircle, Loader as Loader2, RefreshCw } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';

interface AdminStatus {
  ok: boolean;
  error?: string;
  phone_login_canonical_enabled?: boolean;
  phone_login_canonical_ready?: boolean;
  phone_password_recovery_canonical_enabled?: boolean;
  phone_password_recovery_canonical_ready?: boolean;
  provider_selected?: boolean;
  provider_active?: boolean;
  login_template_ready?: boolean;
  recovery_template_ready?: boolean;
  recovery_ttl_valid?: boolean;
  recovery_ttl_seconds?: number;
  recovery_secret_configured?: boolean;
  origins_set?: boolean;
  origins_count?: number;
  sync_matched?: number;
  sync_auth_only?: number;
  sync_profile_only?: number;
  sync_mismatched?: number;
  sync_duplicates?: number;
  last_dispatch?: { status: string; created_at: string; event_type: string } | null;
}

function StatusBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${ok ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
      {ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {label}
    </span>
  );
}

function PhoneAuthCard() {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('get_phone_auth_admin_status');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      setStatus(row as AdminStatus);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleFlag = async (loginEnabled?: boolean, recoveryEnabled?: boolean) => {
    setToggling(true);
    try {
      const { error } = await supabase.rpc('set_phone_auth_canonical_flags', {
        p_login_enabled: loginEnabled ?? null,
        p_recovery_enabled: recoveryEnabled ?? null,
      });
      if (error) throw error;
      await load();
      toast.success('تنظیمات ذخیره شد');
    } catch {
      toast.error('خطا در ذخیره تنظیمات');
    } finally {
      setToggling(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!status?.ok) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <p className="text-sm text-gray-500 dark:text-gray-400">دسترسی به وضعیت ورود موبایلی محدود است.</p>
      </div>
    );
  }

  const loginOn = status.phone_login_canonical_enabled === true;
  const recoveryOn = status.phone_password_recovery_canonical_enabled === true;
  const loginReady = status.phone_login_canonical_ready === true;
  const recoveryReady = status.phone_password_recovery_canonical_ready === true;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400">
          <Smartphone className="w-4 h-4" />
        </div>
        <h3 className="font-bold text-gray-800 dark:text-white">روش‌های ورود و بازیابی</h3>
        <button onClick={load} className="mr-auto p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors" title="بارگذاری مجدد">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="p-5 space-y-4">
        {/* Login toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600">
          <div className="flex items-center gap-2.5">
            <Smartphone className="w-4 h-4 text-teal-500" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">ورود با شماره موبایل</p>
              <p className="text-xs text-gray-400">ارسال کد یک‌بارمصرف و ورود بدون رمز عبور</p>
            </div>
          </div>
          <button
            onClick={() => toggleFlag(!loginOn)}
            disabled={toggling}
            className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${loginOn ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${loginOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Recovery toggle */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 border border-gray-100 dark:border-gray-600">
          <div className="flex items-center gap-2.5">
            <KeyRound className="w-4 h-4 text-blue-500" />
            <div>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200">بازیابی رمز با شماره موبایل</p>
              <p className="text-xs text-gray-400">ارسال کد یک‌بارمصرف برای تغییر رمز عبور</p>
            </div>
          </div>
          <button
            onClick={() => toggleFlag(undefined, !recoveryOn)}
            disabled={toggling}
            className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${recoveryOn ? 'bg-teal-500' : 'bg-gray-300 dark:bg-gray-600'}`}
          >
            <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${recoveryOn ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {/* Runtime status */}
        <div className="grid grid-cols-2 gap-2 p-3 rounded-xl bg-gray-50 dark:bg-gray-700/30 border border-gray-100 dark:border-gray-600">
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">وضعیت پیش‌نیازها</p>
            <StatusBadge ok={status.provider_active === true} label="سرویس‌دهنده پیامک" />
            <StatusBadge ok={status.login_template_ready === true} label="قالب پیامک ورود" />
            <StatusBadge ok={status.recovery_template_ready === true} label="قالب پیامک بازیابی" />
            <StatusBadge ok={status.origins_set === true} label="Origin مجاز" />
            <StatusBadge ok={status.recovery_secret_configured === true} label="Secret بازیابی" />
            <StatusBadge ok={status.recovery_ttl_valid === true} label="TTL بازیابی" />
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">وضعیت آماده‌باش</p>
            <StatusBadge ok={loginReady} label="ورود موبایلی آماده" />
            <StatusBadge ok={recoveryReady} label="بازیابی موبایلی آماده" />
          </div>
        </div>

        {/* Phone sync stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <div className="text-center p-2.5 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-100 dark:border-green-800">
            <p className="text-lg font-bold text-green-600 dark:text-green-400">{status.sync_matched ?? 0}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">هماهنگ</p>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800">
            <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{(status.sync_profile_only ?? 0) + (status.sync_auth_only ?? 0)}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">ناهماهنگ</p>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800">
            <p className="text-lg font-bold text-red-600 dark:text-red-400">{status.sync_mismatched ?? 0}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">تضاد</p>
          </div>
          <div className="text-center p-2.5 rounded-xl bg-orange-50 dark:bg-orange-900/20 border border-orange-100 dark:border-orange-800">
            <p className="text-lg font-bold text-orange-600 dark:text-orange-400">{status.sync_duplicates ?? 0}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">تکراری</p>
          </div>
        </div>

        {/* Last dispatch */}
        {status.last_dispatch && (
          <div className="flex items-center gap-2 text-xs text-gray-400 px-1">
            <span>آخرین ارسال:</span>
            <StatusBadge ok={status.last_dispatch.status === 'sent'} label={status.last_dispatch.status || 'نامشخص'} />
            <span>•</span>
            <span>{status.last_dispatch.event_type || '—'}</span>
            {status.last_dispatch.created_at && (
              <>
                <span>•</span>
                <span>{new Date(status.last_dispatch.created_at).toLocaleString('fa-IR')}</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { PhoneAuthCard };
