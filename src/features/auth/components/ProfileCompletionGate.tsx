import { useState, useEffect, useCallback } from 'react';
import { Loader as Loader2, CircleCheck as CheckCircle, CircleAlert as AlertCircle } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import toast from 'react-hot-toast';

interface ProfileData {
  user_id: string;
  full_name: string;
  username: string;
  email: string;
  phone: string;
  phone_verified_at: string | null;
  organization: string | null;
  position: string | null;
  department: string | null;
  employee_id: string | null;
  birth_date: string | null;
  gender: string | null;
  city: string | null;
  location: string | null;
  bio: string | null;
  website: string | null;
  linkedin_url: string | null;
  profile_completion_status: string;
  profile_completion_version: number;
  account_status: string;
}

interface Props {
  onRefresh: () => void;
}

export function ProfileCompletionGate({ onRefresh }: Props) {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [version, setVersion] = useState(0);
  const [patch, setPatch] = useState<Record<string, string>>({});

  const loadState = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.rpc as any)('get_my_profile_completion_state');
      if (error || !data?.ok) {
        toast.error('خطا در بارگذاری اطلاعات پروفایل');
        return;
      }
      setProfile(data.profile);
      setVersion(data.profile.profile_completion_version);
    } catch {
      toast.error('خطا در بارگذاری اطلاعات پروفایل');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadState();
  }, [loadState]);

  const handleFieldChange = (field: string, value: string) => {
    setPatch((prev: Record<string, string>) => ({ ...prev, [field]: value }));
  };

  const handleSaveDraft = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const patchJson = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined)
      );
      const { data, error } = await (supabase.rpc as any)('save_my_profile_completion', {
        p_patch: patchJson,
        p_expected_version: version,
        p_mark_complete: false,
      });
      if (error || !data?.ok) {
        if (data?.error === 'VERSION_CONFLICT') {
          toast.error('اطلاعات توسط کاربر دیگری تغییر کرده است. صفحه بارگذاری مجدد شد.');
          await loadState();
        } else {
          toast.error('خطا در ذخیره اطلاعات');
        }
        return;
      }
      setVersion(data.new_version);
      setPatch({});
      toast.success('پیش‌نویس ذخیره شد');
    } catch {
      toast.error('خطا در ذخیره اطلاعات');
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const patchJson = Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined)
      );
      const { data, error } = await (supabase.rpc as any)('save_my_profile_completion', {
        p_patch: patchJson,
        p_expected_version: version,
        p_mark_complete: true,
      });
      if (error || !data?.ok) {
        if (data?.error === 'VERSION_CONFLICT') {
          toast.error('اطلاعات توسط کاربر دیگری تغییر کرده است. صفحه بارگذاری مجدد شد.');
          await loadState();
        } else if (data?.error === 'COMPLETION_REQUIREMENTS_NOT_MET') {
          toast.error('برای تکمیل پروفایل، نام، سازمان، سمت و تأیید شماره موبایل الزامی است.');
        } else {
          toast.error('خطا در تکمیل پروفایل');
        }
        return;
      }
      toast.success('پروفایل با موفقیت تکمیل شد');
      onRefresh();
    } catch {
      toast.error('خطا در تکمیل پروفایل');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-6 text-center text-sm text-gray-500">
        <AlertCircle className="w-8 h-8 mx-auto mb-2 text-gray-400" />
        پروفایل یافت نشد.
      </div>
    );
  }

  const inp = 'w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 focus:ring-2 focus:ring-teal-500 focus:border-transparent transition-all dark:bg-gray-700 dark:text-white text-sm';

  return (
    <div className="space-y-6" dir="rtl">
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4">
        <p className="text-sm text-blue-700 dark:text-blue-300">
          برای دسترسی کامل به سامانه، لطفاً پروفایل خود را تکمیل کنید.
        </p>
      </div>

      {/* Readonly fields */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">اطلاعات حساب (غیرقابل ویرایش)</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ReadonlyField label="نام کاربری" value={profile.username} />
          <ReadonlyField label="ایمیل" value={profile.email} />
          <ReadonlyField label="شماره موبایل" value={profile.phone} />
          <ReadonlyField
            label="وضعیت تأیید موبایل"
            value={profile.phone_verified_at ? 'تأیید شده' : 'تأیید نشده'}
          />
        </div>
      </div>

      {/* Editable fields */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">اطلاعات پروفایل</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <EditableField label="نام و نام خانوادگی" field="full_name" value={patch.full_name ?? profile.full_name ?? ''} onChange={handleFieldChange} inp={inp} />
          <EditableField label="سازمان" field="organization" value={patch.organization ?? profile.organization ?? ''} onChange={handleFieldChange} inp={inp} />
          <EditableField label="سمت" field="position" value={patch.position ?? profile.position ?? ''} onChange={handleFieldChange} inp={inp} />
          <EditableField label="دپارتمان" field="department" value={patch.department ?? profile.department ?? ''} onChange={handleFieldChange} inp={inp} />
          <EditableField label="کد پرسنلی" field="employee_id" value={patch.employee_id ?? profile.employee_id ?? ''} onChange={handleFieldChange} inp={inp} />
          <EditableField label="شهر" field="city" value={patch.city ?? profile.city ?? ''} onChange={handleFieldChange} inp={inp} />
          <EditableField label="وب‌سایت" field="website" value={patch.website ?? profile.website ?? ''} onChange={handleFieldChange} inp={inp} />
          <EditableField label="لینکدین" field="linkedin_url" value={patch.linkedin_url ?? profile.linkedin_url ?? ''} onChange={handleFieldChange} inp={inp} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">درباره من</label>
          <textarea
            value={patch.bio ?? profile.bio ?? ''}
            onChange={e => handleFieldChange('bio', e.target.value)}
            className={inp + ' min-h-[80px]'}
            rows={3}
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={handleSaveDraft}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 text-sm text-teal-600 dark:text-teal-400 border border-teal-300 dark:border-teal-700 rounded-xl hover:bg-teal-50 dark:hover:bg-teal-900/20 transition disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          ذخیره پیش‌نویس
        </button>
        <button
          onClick={handleComplete}
          disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 text-sm bg-teal-500 hover:bg-teal-600 text-white rounded-xl transition disabled:opacity-50"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
          تکمیل پروفایل
        </button>
      </div>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <div className="px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 text-sm text-gray-700 dark:text-gray-300">
        {value || '—'}
      </div>
    </div>
  );
}

function EditableField({
  label, field, value, onChange, inp,
}: {
  label: string;
  field: string;
  value: string;
  onChange: (field: string, value: string) => void;
  inp: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(field, e.target.value)}
        className={inp}
      />
    </div>
  );
}
