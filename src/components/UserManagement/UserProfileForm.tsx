import React, { useState, useEffect, useRef } from 'react';
import { X, Save, Eye, EyeOff, Shield, KeyRound, User, Mail, Phone, AtSign, CreditCard, Calendar, Users, MapPin, Building, Briefcase, Hash, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import type { AdminProfile } from './types';
import { inp, inpDis } from './utils';
import { Field } from './Field';
import { SectionAccordion } from './SectionAccordion';
import { AvatarBlock } from './AvatarBlock';
import { JDateInput } from './JDateInput';

function UserProfileForm({
  title, profile, isNew, onSave, onBack,
}: {
  title: string;
  profile: AdminProfile;
  isNew: boolean;
  onSave: (updated: AdminProfile, password?: string) => Promise<void>;
  onBack: () => void;
}) {
  const [form, setForm] = useState<AdminProfile>({ ...profile });
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [avatarProcessing, setAvatarProcessing] = useState(false);
  const avatarPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [section, setSection] = useState<'personal' | 'work' | 'social'>('personal');

  useEffect(() => {
    supabase.from('org_organizations').select('name').maybeSingle().then(({ data }) => {
      if (data?.name) {
        if (profile.position) {
          setForm(f => ({ ...f, organization: data.name }));
        }
      }
    });
  }, [profile.position]);

  const isOrgLocked = !isNew && !!form.position;

  const set = (k: keyof AdminProfile, v: string | boolean) => setForm(f => ({ ...f, [k]: v }));

  const stopAvatarPoll = () => {
    if (avatarPollRef.current) { clearInterval(avatarPollRef.current); avatarPollRef.current = null; }
  };
  useEffect(() => () => stopAvatarPoll(), []);

  const startAvatarPoll = (jobId: string) => {
    stopAvatarPoll();
    const startTime = Date.now();
    const maxMs = 60_000;
    const intervalMs = 2_000;
    avatarPollRef.current = setInterval(async () => {
      if (Date.now() - startTime > maxMs) {
        stopAvatarPoll();
        setAvatarProcessing(false);
        toast.error('پردازش تصویر طولانی شد. لطفاً بعداً دوباره بررسی کنید.');
        return;
      }
      try {
        const { data, error } = await supabase
          .from('avatar_jobs')
          .select('status')
          .eq('id', jobId)
          .maybeSingle();
        if (error) throw error;
        if (!data) return;
        if (data.status === 'completed') {
          stopAvatarPoll();
          setAvatarProcessing(false);
          const { data: p, error: pErr } = await supabase
            .from('profiles')
            .select('avatar_url')
            .eq('user_id', form.user_id)
            .maybeSingle();
          if (!pErr && p?.avatar_url) {
            setForm(f => ({ ...f, avatar_url: `${p.avatar_url}${p.avatar_url.includes('?') ? '&' : '?'}t=${Date.now()}` }));
          }
          toast.success('تصویر آپلود شد');
        } else if (data.status === 'failed') {
          stopAvatarPoll();
          setAvatarProcessing(false);
          toast.error('پردازش تصویر ناموفق بود. لطفاً فایل دیگری امتحان کنید.');
        }
      } catch {
        // transient poll error — keep polling
      }
    }, intervalMs);
  };

  const handleAvatar = async (file: File) => {
    if (isNew) { toast.error('ابتدا کاربر را ذخیره کنید، سپس تصویر آپلود کنید'); return; }
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('فقط فرمت‌های JPEG، PNG و WebP مجاز هستند');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('حجم فایل نباید بیشتر از ۲ مگابایت باشد');
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('target_user_id', form.user_id);
      const { data, error } = await supabase.functions.invoke('avatar-upload', { body: formData });
      if (error) throw error;
      if (!data?.job_id) throw new Error('پاسخ نامعتبر از سرور');
      setUploading(false);
      setAvatarProcessing(true);
      toast.success('تصویر ارسال شد. در حال پردازش...');
      startAvatarPoll(data.job_id);
    } catch {
      setUploading(false);
      toast.error('خطا در آپلود');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isNew && (!form.email || !password)) { toast.error('ایمیل و رمز عبور الزامی است'); return; }
    if (isNew && password.length < 6) { toast.error('رمز عبور حداقل ۶ کاراکتر'); return; }
    setSaving(true);
    try { await onSave(form, isNew ? password : undefined); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3 mb-2">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
          <X className="w-4 h-4" />
        </button>
        <h3 className="font-bold text-gray-800 dark:text-white text-lg">{title}</h3>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 flex items-center gap-5">
        <div className="relative">
          {uploading || avatarProcessing
            ? <div className="w-20 h-20 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-teal-500" /></div>
            : <AvatarBlock profile={form} editable={!isNew} onUpload={handleAvatar} uploading={uploading} avatarProcessing={avatarProcessing} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 dark:text-white truncate">{form.full_name || (isNew ? 'کاربر جدید' : '—')}</p>
          <p className="text-xs text-gray-400 truncate">{form.email || '—'}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${form.is_security_admin ? 'bg-purple-500 text-white border-purple-500' : form.is_admin ? 'bg-blue-500 text-white border-blue-500' : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}
              title="سطح دسترسی فقط از بخش مدیریت سطح دسترسی تغییر می‌کند"
            >
              <Shield className="w-3 h-3" />
              {form.is_security_admin ? 'Security Admin' : form.is_admin ? 'Admin' : 'کاربر عادی'}
            </span>
            <span
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${form.is_active !== false ? 'bg-green-500 text-white border-green-500' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800'}`}
              title="وضعیت حساب از بخش فعال/غیرفعال کردن مدیریت می‌شود"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-current" />{form.is_active !== false ? 'فعال' : 'غیرفعال'}
            </span>
            <button type="button" onClick={() => set('is_hidden', !form.is_hidden)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${form.is_hidden ? 'bg-gray-700 text-white border-gray-700 dark:bg-gray-600 dark:border-gray-500' : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
              <EyeOff className="w-3 h-3" />{form.is_hidden ? 'مخفی' : 'قابل مشاهده'}
            </button>
          </div>
          {!isNew && <p className="text-[11px] text-gray-400 mt-2">نقش و وضعیت حساب از عملیات مدیریتی اختصاصی تغییر می‌کنند.</p>}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <SectionAccordion title="اطلاعات شخصی" subtitle="نام، تماس، مشخصات فردی" open={section === 'personal'} onToggle={() => setSection('personal')}>
          <Field label="نام و نام خانوادگی" icon={User}>
            <input className={inp} value={form.full_name || ''} onChange={e => set('full_name', e.target.value)} placeholder="نام کامل" />
          </Field>
          <Field label="ایمیل" icon={Mail}>
            <input className={isNew ? inp : inpDis} type="email" value={form.email || ''} disabled={!isNew} onChange={e => set('email', e.target.value)} placeholder="email@example.com" dir="ltr" />
          </Field>
          <Field label="نام کاربری" icon={AtSign}>
            <input className={inp} value={form.username || ''} onChange={e => set('username', e.target.value.replace(/[^a-zA-Z0-9._]/g, ''))} placeholder="h.khaleghi" dir="ltr" />
          </Field>
          {isNew && (
            <Field label="رمز عبور *" icon={KeyRound}>
              <div className="relative">
                <input className={inp + ' pl-10'} type={showPass ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="حداقل ۶ کاراکتر" dir="ltr" />
                <button type="button" onClick={() => setShowPass(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </Field>
          )}
          <Field label="شماره موبایل" icon={Phone}>
            <input className={inp} type="tel" value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="09xxxxxxxxx" dir="ltr" />
          </Field>
          <Field label="کد ملی" icon={CreditCard}>
            <input className={inp} value={form.national_id || ''} onChange={e => set('national_id', e.target.value)} placeholder="۱۰ رقم" dir="ltr" maxLength={10} />
          </Field>
          <Field label="تاریخ تولد (شمسی)" icon={Calendar}>
            <JDateInput value={form.birth_date} onChange={v => set('birth_date', v)} />
          </Field>
          <Field label="جنسیت" icon={Users}>
            <select className={inp} value={form.gender || ''} onChange={e => set('gender', e.target.value)}>
              <option value="">انتخاب کنید</option>
              <option value="male">مرد</option>
              <option value="female">زن</option>
              <option value="other">سایر</option>
            </select>
          </Field>
          <Field label="شهر" icon={MapPin}>
            <input className={inp} value={form.city || ''} onChange={e => set('city', e.target.value)} placeholder="شهر محل سکونت" />
          </Field>
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">درباره کاربر</label>
            <textarea rows={3} value={form.bio || ''} onChange={e => set('bio', e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 transition text-sm resize-none"
              placeholder="توضیحات کوتاه..." />
          </div>
        </SectionAccordion>

        <SectionAccordion title="اطلاعات سازمانی" subtitle="سازمان، سمت، واحد و مشخصات شغلی" open={section === 'work'} onToggle={() => setSection('work')}>
          <Field label="نام سازمان / شرکت" icon={Building}>
            <input
              className={isOrgLocked ? inpDis : inp}
              value={form.organization || ''}
              onChange={e => set('organization', e.target.value)}
              readOnly={isOrgLocked}
              title={isOrgLocked ? 'این فیلد از ساختار سازمانی تکمیل می‌شود' : ''}
              placeholder="نام سازمان"
            />
          </Field>
          <Field label="سمت / عنوان شغلی" icon={Briefcase}>
            <input className={inp} value={form.position || ''} onChange={e => set('position', e.target.value)} placeholder="مثال: مدیر پروژه" />
          </Field>
          <Field label="واحد / دپارتمان" icon={Users}>
            <input className={inp} value={form.department || ''} onChange={e => set('department', e.target.value)} placeholder="مثال: فناوری اطلاعات" />
          </Field>
          <Field label="کد پرسنلی" icon={Hash}>
            <input className={inp} value={form.employee_id || ''} onChange={e => set('employee_id', e.target.value)} placeholder="شماره پرسنلی" dir="ltr" />
          </Field>
          <Field label="تاریخ استخدام" icon={Calendar}>
            <input className={inp} type="date" value={form.hire_date || ''} onChange={e => set('hire_date', e.target.value)} dir="ltr" />
          </Field>
          <Field label="موقعیت مکانی (دفتر)" icon={MapPin}>
            <input className={inp} value={form.location || ''} onChange={e => set('location', e.target.value)} placeholder="آدرس دفتر" />
          </Field>
        </SectionAccordion>

        <div className="flex gap-3 pb-4">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white px-8 py-2.5 rounded-xl font-medium transition shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'در حال ذخیره...' : isNew ? 'ایجاد کاربر' : 'ذخیره تغییرات'}
          </button>
          <button type="button" onClick={onBack}
            className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">
            انصراف
          </button>
        </div>
      </form>
    </div>
  );
}

export { UserProfileForm };
