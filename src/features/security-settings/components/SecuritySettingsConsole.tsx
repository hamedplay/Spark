import { useState, useEffect, useCallback, useRef } from 'react';
import { Shield, Loader as Loader2, Save, Lock, LogIn, Settings as SettingsIcon, Clock, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { loadSecurityConsoleState, saveSecuritySettingsPatch } from '../services/securitySettingsService';
import { buildSecuritySettingsPatch, isPatchEmpty } from '../utils/buildSecuritySettingsPatch';
import { validateSecuritySettings, validateChangeReason } from '../utils/validateSecuritySettings';
import { SECURITY_ERROR_MESSAGES, type SecurityConsoleState, type SecuritySettings, type SecuritySettingsPatch, type MfaPolicy } from '../types/securitySettings';
import { MfaPolicyImpactCard } from './MfaPolicyImpactCard';
import { SecuritySettingsHistory } from './SecuritySettingsHistory';
import { SecurityStepUpDialog } from './SecurityStepUpDialog';
import { listCurrentUserTotpFactors } from '../../auth/services/mfaOperations';

interface ConflictSnapshot {
  expectedVersion: number;
  patch: SecuritySettingsPatch;
  changeReason: string;
  draft: SecuritySettings;
}

export function SecuritySettingsConsole() {
  const [state, setState] = useState<SecurityConsoleState | null>(null);
  const [draft, setDraft] = useState<SecuritySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [confirmRequired, setConfirmRequired] = useState(false);
  const [hasVerifiedTotp, setHasVerifiedTotp] = useState(false);
  const [conflict, setConflict] = useState<ConflictSnapshot | null>(null);
  const patchRef = useRef<SecuritySettingsPatch | null>(null);
  const reasonRef = useRef<string>('');

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadSecurityConsoleState();
      setState(result);
      if (result.ok && result.settings) {
        setDraft({ ...result.settings });
      }
      try {
        const factors = await listCurrentUserTotpFactors();
        const verified = factors.filter((f) => f.status === 'verified');
        setHasVerifiedTotp(verified.length > 0);
      } catch {
        setHasVerifiedTotp(false);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadState(); }, [loadState]);

  const isRequiredTransition = useCallback(() => {
    if (!state?.settings || !draft) return false;
    return state.settings.mfa_policy !== 'required' && draft.mfa_policy === 'required';
  }, [state, draft]);

  const handleSave = useCallback(async () => {
    if (!draft || !state?.settings) return;

    const patch = buildSecuritySettingsPatch(state.settings, draft);
    patchRef.current = patch;

    if (isPatchEmpty(patch)) {
      toast('تغییری برای ذخیره وجود ندارد.');
      return;
    }

    const validation = validateSecuritySettings(draft, patch);
    if (!validation.ok) {
      toast.error(validation.message ?? 'خطا در اعتبارسنجی.');
      return;
    }

    const reasonValidation = validateChangeReason(changeReason);
    if (!reasonValidation.ok) {
      toast.error(reasonValidation.message ?? 'دلیل تغییر نامعتبر است.');
      return;
    }
    reasonRef.current = changeReason.trim();

    if (isRequiredTransition()) {
      if (state.impact.security_admins_without_verified_totp > 0) {
        toast.error('فعال‌سازی سیاست «الزامی» مسدود است: برخی مدیران امنیت TOTP فعال ندارند.');
        return;
      }
      if (!confirmRequired) {
        toast.error('لطفاً کادر تأیید اثر سیاست را علامت بزنید.');
        return;
      }
    }

    if (!hasVerifiedTotp) {
      toast.error('برای تغییر تنظیمات امنیتی ابتدا TOTP را در پروفایل خود فعال کنید.');
      return;
    }

    setStepUpOpen(true);
  }, [draft, state, changeReason, confirmRequired, hasVerifiedTotp, isRequiredTransition]);

  const handleStepUpSuccess = useCallback(async () => {
    setStepUpOpen(false);

    if (!patchRef.current || !state?.settings) return;

    setSaving(true);
    try {
      const result = await saveSecuritySettingsPatch({
        expectedVersion: state.settings.settings_version,
        patch: patchRef.current,
        changeReason: reasonRef.current,
      });

      if (!result.ok) {
        const errorCode = result.error ?? 'UNKNOWN_SECURITY_ERROR';
        const message = SECURITY_ERROR_MESSAGES[errorCode] ?? SECURITY_ERROR_MESSAGES.UNKNOWN_SECURITY_ERROR;

        if (errorCode === 'VERSION_CONFLICT') {
          setConflict({
            expectedVersion: state.settings.settings_version,
            patch: patchRef.current,
            changeReason: reasonRef.current,
            draft: { ...draft! },
          });
          toast.error(message);
          await loadState();
        } else {
          toast.error(message);
        }
        return;
      }

      toast.success('تنظیمات امنیتی با موفقیت ذخیره شد.');
      setChangeReason('');
      setConfirmRequired(false);
      setConflict(null);
      await loadState();
    } finally {
      setSaving(false);
      patchRef.current = null;
      reasonRef.current = '';
    }
  }, [state, draft, loadState]);

  if (loading) {
    return (
      <div className="flex justify-center items-center h-48">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!state || !state.ok) {
    const errCode = state?.error;
    if (errCode === 'SECURITY_ADMIN_REQUIRED') {
      return (
        <div className="p-6 text-center" dir="rtl">
          <Lock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            دسترسی به تنظیمات امنیتی فقط برای مدیر امنیت فعال است.
          </p>
        </div>
      );
    }
    if (errCode === 'UNAUTHORIZED' || errCode === 'SESSION_INVALID') {
      return (
        <div className="p-6 text-center" dir="rtl">
          <Lock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <p className="text-sm text-gray-600 dark:text-gray-400">
            نشست شما نامعتبر است. لطفاً دوباره وارد شوید.
          </p>
        </div>
      );
    }
    return (
      <div className="p-6 text-center" dir="rtl">
        <Lock className="w-12 h-12 text-gray-400 mx-auto mb-3" />
        <p className="text-sm text-gray-600 dark:text-gray-400">
          خطا در بارگذاری تنظیمات امنیتی.
        </p>
      </div>
    );
  }

  if (!draft) return null;

  const showImpact = isRequiredTransition();

  return (
    <div className="space-y-5" dir="rtl">
      <SecurityStepUpDialog
        open={stepUpOpen}
        purpose="auth_settings_change"
        title="تأیید احراز هویت دومرحله‌ای"
        description="برای ذخیره تنظیمات امنیتی، کد ۶ رقمی از برنامه احراز هویت خود را وارد کنید."
        confirmLabel="تأیید و ذخیره"
        onClose={() => setStepUpOpen(false)}
        onSuccess={handleStepUpSuccess}
      />

      {conflict && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl p-5 space-y-3">
          <h4 className="text-sm font-bold text-amber-800 dark:text-amber-200">تعارض نسخه</h4>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            نسخه قبلی: {conflict.expectedVersion} — نسخه جدید: {state.settings.settings_version}
          </p>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            فیلدهای مورد نظر برای تغییر: {Object.keys(conflict.patch).join('، ')}
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            تغییرات جدید روی State جدید بارگذاری شد. لطفاً تغییرات خود را بازبینی و دوباره اعمال کنید.
          </p>
        </div>
      )}

      {/* Login Methods */}
      <SectionCard title="روش‌های ورود" icon={LogIn}>
        <ToggleRow
          label="ورود با نام کاربری"
          value={draft.username_login}
          onChange={(v) => setDraft({ ...draft, username_login: v })}
        />
        <ToggleRow
          label="ورود با ایمیل"
          value={draft.email_login}
          onChange={(v) => setDraft({ ...draft, email_login: v })}
        />
        <ToggleRow
          label="ورود با تلفن"
          value={draft.phone_login}
          onChange={(v) => setDraft({ ...draft, phone_login: v })}
        />
      </SectionCard>

      {/* MFA Policy */}
      <SectionCard title="سیاست احراز هویت دومرحله‌ای" icon={Shield}>
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 block">سیاست MFA</label>
            <div className="flex gap-2">
              {(['disabled', 'optional', 'required'] as MfaPolicy[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDraft({ ...draft, mfa_policy: p })}
                  disabled={p === 'required' && !draft.allow_totp_mfa}
                  className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                    draft.mfa_policy === p
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-400'
                  } ${p === 'required' && !draft.allow_totp_mfa ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {p === 'disabled' ? 'غیرفعال' : p === 'optional' ? 'اختیاری' : 'الزامی'}
                </button>
              ))}
            </div>
          </div>

          <ToggleRow
            label="اجازه احراز هویت TOTP"
            value={draft.allow_totp_mfa}
            onChange={(v) => {
              const newDraft = { ...draft, allow_totp_mfa: v };
              if (!v && newDraft.mfa_policy === 'required') {
                newDraft.mfa_policy = 'optional';
              }
              setDraft(newDraft);
            }}
          />

          <ReadonlyToggle label="احراز هویت بله" value={draft.allow_bale_mfa} />
          <ReadonlyToggle label="احراز هویت ایمیل" value={draft.allow_email_mfa} />
          <ReadonlyToggle label="کدهای بازیابی" value={draft.allow_recovery_codes} />
        </div>
      </SectionCard>

      {/* Impact Card */}
      <MfaPolicyImpactCard impact={state.impact} visible={showImpact} />

      {/* Confirmation checkbox */}
      {showImpact && (
        <label className="flex items-start gap-3 p-4 bg-gray-50 dark:bg-gray-700/50 rounded-xl cursor-pointer">
          <input
            type="checkbox"
            checked={confirmRequired}
            onChange={(e) => setConfirmRequired(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
          />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            تأیید می‌کنم کاربران فاقد TOTP پس از اعمال سیاست به مسیر فعال‌سازی هدایت خواهند شد.
          </span>
        </label>
      )}

      {/* Registration */}
      <SectionCard title="ثبت‌نام" icon={SettingsIcon}>
        <ToggleRow
          label="ثبت‌نام کاربر جدید"
          value={draft.registration_enabled}
          onChange={(v) => setDraft({ ...draft, registration_enabled: v })}
        />
        <ToggleRow
          label="تأیید مدیر برای ثبت‌نام"
          value={draft.registration_requires_admin_approval}
          onChange={(v) => setDraft({ ...draft, registration_requires_admin_approval: v })}
        />
        <ToggleRow
          label="الزام تکمیل پروفایل"
          value={draft.require_profile_completion}
          onChange={(v) => setDraft({ ...draft, require_profile_completion: v })}
        />
      </SectionCard>

      {/* Session */}
      <SectionCard title="تنظیمات نشست" icon={Clock}>
        <NumberRow
          label="زمان بیکاری نشست (دقیقه)"
          value={draft.session_idle_timeout_minutes}
          min={1}
          max={10080}
          onChange={(v) => setDraft({ ...draft, session_idle_timeout_minutes: v })}
        />
        <NumberRow
          label="طول کل نشست (دقیقه)"
          value={draft.session_absolute_lifetime_minutes}
          min={1}
          max={43200}
          onChange={(v) => setDraft({ ...draft, session_absolute_lifetime_minutes: v })}
        />
        <NumberRow
          label="حداکثر نشست‌های فعال"
          value={draft.max_active_sessions}
          min={1}
          max={100}
          onChange={(v) => setDraft({ ...draft, max_active_sessions: v })}
        />
      </SectionCard>

      {/* Lockout */}
      <SectionCard title="قفل حساب" icon={Lock}>
        <NumberRow
          label="آستانه قفل (تلاش ناموفق)"
          value={draft.lock_threshold}
          min={1}
          max={50}
          onChange={(v) => setDraft({ ...draft, lock_threshold: v })}
        />
        <NumberRow
          label="مدت قفل (دقیقه)"
          value={draft.lock_duration_minutes}
          min={1}
          max={1440}
          onChange={(v) => setDraft({ ...draft, lock_duration_minutes: v })}
        />
      </SectionCard>

      {/* Recovery */}
      <SectionCard title="بازیابی" icon={KeyRound}>
        <ToggleRow
          label="بازیابی فعال"
          value={draft.recovery_enabled}
          onChange={(v) => setDraft({ ...draft, recovery_enabled: v })}
        />
        <ReadonlyToggle label="کدهای بازیابی" value={draft.allow_recovery_codes} />
      </SectionCard>

      {/* Change Reason */}
      <div>
        <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 block">
          دلیل تغییر <span className="text-red-500">*</span>
        </label>
        <textarea
          value={changeReason}
          onChange={(e) => setChangeReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="دلیل این تغییر امنیتی را توضیح دهید (حداقل ۱۰ کاراکتر)..."
          className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
        <p className="text-xs text-gray-400 mt-1">{changeReason.trim().length}/500</p>
      </div>

      {/* Save Button */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-8 py-2.5 rounded-xl font-medium transition disabled:opacity-60 shadow-sm"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}
        </button>
      </div>

      {/* History */}
      <SecuritySettingsHistory history={state.recent_history} />
    </div>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: React.ComponentType<{ className?: string }>; children: React.ReactNode }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
        <div className="w-8 h-8 rounded-xl flex items-center justify-center bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400">
          <Icon className="w-4 h-4" />
        </div>
        <h3 className="font-bold text-gray-800 dark:text-white text-sm">{title}</h3>
      </div>
      <div className="p-5 space-y-3">{children}</div>
    </div>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={`relative w-12 h-6 rounded-full transition-colors flex-shrink-0 ${value ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`}
      >
        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${value ? 'left-7' : 'left-1'}`} />
      </button>
    </div>
  );
}

function ReadonlyToggle({ label, value }: { label: string; value: boolean }) {
  return (
    <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl opacity-60">
      <div>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <p className="text-xs text-gray-400 mt-0.5">این روش هنوز برای ورود MFA عملیاتی نشده است.</p>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-400">{value ? 'روشن' : 'خاموش'}</span>
        <div className="w-12 h-6 rounded-full bg-gray-200 dark:bg-gray-600 flex-shrink-0" />
      </div>
    </div>
  );
}

function NumberRow({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v)) onChange(v);
        }}
        className="w-24 px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
      />
    </div>
  );
}
