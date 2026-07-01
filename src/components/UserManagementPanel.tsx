import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Users, Search, Plus, RefreshCw, MoveVertical as MoreVertical, KeyRound, UserX, UserCheck, ShieldCheck, Activity, History, MapPin, X, Save, Eye, EyeOff, CircleAlert as AlertCircle, TriangleAlert as AlertTriangle, Camera, Loader as Loader2, CircleCheck as CheckCircle2, User, Mail, Phone, Building, Briefcase, Hash, Globe, Calendar, LogIn as LoginIcon, Shield, Upload, Download, AtSign, Pencil, Link2, Trash2, CreditCard } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import * as XLSX from 'xlsx';

// ─── Jalali date input helper ─────────────────────────────────────────────────
const JALALI_MONTHS_ADMIN = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

function getJMDays(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return moment.jIsLeapYear(jy) ? 30 : 29;
}

function isoToJ(iso: string | null | undefined) {
  if (!iso) return { jy: 0, jm: 0, jd: 0 };
  try {
    const m = moment(iso, 'YYYY-MM-DD');
    if (!m.isValid()) return { jy: 0, jm: 0, jd: 0 };
    return { jy: m.jYear(), jm: m.jMonth() + 1, jd: m.jDate() };
  } catch { return { jy: 0, jm: 0, jd: 0 }; }
}

function jToIso(jy: number, jm: number, jd: number): string {
  if (!jy || !jm || !jd) return '';
  try {
    const d = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jM/jD');
    return d.isValid() ? d.format('YYYY-MM-DD') : '';
  } catch { return ''; }
}

function JDateInput({ value, onChange }: { value: string | null | undefined; onChange: (v: string) => void }) {
  const parsed = isoToJ(value);
  const currentJYear = moment().jYear();
  const [jy, setJy] = useState(parsed.jy);
  const [jm, setJm] = useState(parsed.jm);
  const [jd, setJd] = useState(parsed.jd);

  useEffect(() => {
    const p = isoToJ(value);
    setJy(p.jy); setJm(p.jm); setJd(p.jd);
  }, [value]);

  const emit = (y: number, m: number, d: number) => onChange(jToIso(y, m, d));
  const days = jy && jm ? getJMDays(jy, jm) : 31;
  const years = Array.from({ length: 120 }, (_, i) => currentJYear - i);

  const cls = 'flex-1 py-2 px-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm focus:outline-hidden focus:ring-2 focus:ring-teal-500';
  return (
    <div className="flex gap-1" dir="rtl">
      <select value={jy || ''} onChange={e => { const v = Number(e.target.value); setJy(v); emit(v, jm, jd); }} className={cls}>
        <option value="">سال</option>
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select value={jm || ''} onChange={e => { const v = Number(e.target.value); setJm(v); emit(jy, v, jd); }} className={cls}>
        <option value="">ماه</option>
        {JALALI_MONTHS_ADMIN.map((name, i) => <option key={i+1} value={i+1}>{name}</option>)}
      </select>
      <select value={jd || ''} onChange={e => { const v = Number(e.target.value); setJd(v); emit(jy, jm, v); }} className={cls}>
        <option value="">روز</option>
        {Array.from({ length: days }, (_, i) => i + 1).map(d => <option key={d} value={d}>{d}</option>)}
      </select>
    </div>
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AdminProfile {
  user_id: string;
  full_name: string | null;
  email: string | null;
  username?: string | null;
  phone?: string | null;
  organization?: string | null;
  position: string | null;
  department: string | null;
  employee_id?: string | null;
  hire_date?: string | null;
  birth_date?: string | null;
  gender?: string | null;
  city?: string | null;
  location?: string | null;
  bio?: string | null;
  national_id?: string | null;
  avatar_url?: string | null;
  is_admin: boolean | null;
  is_active: boolean | null;
  is_hidden?: boolean | null;
  created_at: string | null;
}

interface AuditRow { id: string; created_at: string; ip_address: string | null; user_agent: string | null; action: string; module: string | null; entity_name: string | null; details: string | null; severity: string; }

type Panel = 'list' | 'edit' | 'add' | 'password' | 'deactivate' | 'access' | 'activity' | 'logins' | 'urls' | 'preview' | 'relations';

// ─── Shared styles ────────────────────────────────────────────────────────────
const inp = 'w-full pr-10 pl-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-teal-500 focus:border-transparent transition text-sm';
const inpDis = inp + ' bg-gray-50 dark:bg-gray-600 text-gray-500 cursor-not-allowed';

function Field({ label, icon: Icon, children }: { label: string; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">{label}</label>
      <div className="relative">
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <Icon className="w-4 h-4" />
        </div>
        {children}
      </div>
    </div>
  );
}

function SectionAccordion({ title, subtitle, open, onToggle, children }: {
  title: string; subtitle: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xs border border-gray-100 dark:border-gray-700 overflow-hidden">
      <button type="button" onClick={onToggle}
        className="w-full flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700 transition text-right">
        <div>
          <p className="font-semibold text-gray-800 dark:text-white text-sm">{title}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{subtitle}</p>
        </div>
        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors shrink-0 mr-3 ${open ? 'border-teal-500 bg-teal-500' : 'border-gray-300 dark:border-gray-600'}`}>
          {open && <CheckCircle2 className="w-3 h-3 text-white" />}
        </div>
      </button>
      {open && <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">{children}</div>}
    </div>
  );
}

// ─── Avatar ───────────────────────────────────────────────────────────────────
function AvatarBlock({ profile, editable, onUpload }: {
  profile: AdminProfile; editable: boolean;
  onUpload?: (file: File) => void;
}) {
  const initials = (profile.full_name || profile.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="relative shrink-0">
      <div className="w-20 h-20 rounded-2xl overflow-hidden bg-teal-100 dark:bg-teal-900/30">
        {profile.avatar_url
          ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-teal-600 dark:text-teal-400">{initials}</div>}
      </div>
      {editable && onUpload && (
        <label className="absolute -bottom-2 -left-2 w-7 h-7 bg-teal-500 hover:bg-teal-600 rounded-xl flex items-center justify-center cursor-pointer shadow-md transition">
          <Camera className="w-3.5 h-3.5 text-white" />
          <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
        </label>
      )}
    </div>
  );
}

// ─── Edit / Add profile form ───────────────────────────────────────────────────
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
  const [section, setSection] = useState<'personal' | 'work' | 'social'>('personal');

  // Load the org name and auto-fill if user has a position assigned
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

  const handleAvatar = async (file: File) => {
    if (isNew) { toast.error('ابتدا کاربر را ذخیره کنید، سپس تصویر آپلود کنید'); return; }
    setUploading(true);
    const ext = file.name.split('.').pop();
    const path = `${form.user_id}/avatar.${ext}`;
    const { error } = await supabase.storage.from('profiles').upload(path, file, { upsert: true });
    if (error) { toast.error('خطا در آپلود'); setUploading(false); return; }
    const { data: { publicUrl } } = supabase.storage.from('profiles').getPublicUrl(path);
    const url = `${publicUrl}?t=${Date.now()}`;
    await supabase.from('profiles').update({ avatar_url: url }).eq('user_id', form.user_id);
    setForm(f => ({ ...f, avatar_url: url }));
    toast.success('تصویر آپلود شد');
    setUploading(false);
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

      {/* Avatar + header */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 flex items-center gap-5">
        <div className="relative">
          {uploading
            ? <div className="w-20 h-20 rounded-2xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-teal-500" /></div>
            : <AvatarBlock profile={form} editable={!isNew} onUpload={handleAvatar} />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-800 dark:text-white truncate">{form.full_name || (isNew ? 'کاربر جدید' : '—')}</p>
          <p className="text-xs text-gray-400 truncate">{form.email || '—'}</p>
          <div className="flex items-center gap-2 mt-2">
            <button type="button" onClick={() => set('is_admin', !form.is_admin)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${form.is_admin ? 'bg-blue-500 text-white border-blue-500' : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
              <Shield className="w-3 h-3" />{form.is_admin ? 'ادمین' : 'کاربر عادی'}
            </button>
            <button type="button" onClick={() => set('is_active', !(form.is_active !== false))}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${form.is_active !== false ? 'bg-green-500 text-white border-green-500' : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-current" />{form.is_active !== false ? 'فعال' : 'غیرفعال'}
            </button>
            <button type="button" onClick={() => set('is_hidden', !form.is_hidden)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${form.is_hidden ? 'bg-gray-700 text-white border-gray-700 dark:bg-gray-600 dark:border-gray-500' : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'}`}>
              <EyeOff className="w-3 h-3" />{form.is_hidden ? 'مخفی' : 'قابل مشاهده'}
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Personal section */}
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
              className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-hidden focus:ring-2 focus:ring-teal-500 transition text-sm resize-none"
              placeholder="توضیحات کوتاه..." />
          </div>
        </SectionAccordion>

        {/* Work section */}
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
            className="flex items-center gap-2 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white px-8 py-2.5 rounded-xl font-medium transition shadow-xs">
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

// ─── Detail panel: full-page view for non-edit actions ───────────────────────
function DetailPanel({ title, icon: Icon, iconColor, user, onBack, children }: {
  title: string; icon: React.ElementType; iconColor: string; user: AdminProfile; onBack: () => void; children: React.ReactNode;
}) {
  const initials = (user.full_name || user.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
          <X className="w-4 h-4" />
        </button>
        <Icon className={`w-5 h-5 ${iconColor}`} />
        <h3 className="font-bold text-gray-800 dark:text-white text-lg">{title}</h3>
      </div>
      {/* User badge */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl overflow-hidden bg-teal-100 dark:bg-teal-900/30 shrink-0">
          {user.avatar_url
            ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center font-bold text-teal-600 dark:text-teal-400">{initials}</div>}
        </div>
        <div>
          <p className="font-semibold text-gray-800 dark:text-white">{user.full_name || '—'}</p>
          <p className="text-xs text-gray-400">{user.email}</p>
        </div>
        <div className="mr-auto flex gap-2">
          {user.is_admin && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-1 rounded-full">ادمین</span>}
          <span className={`text-xs px-2 py-1 rounded-full ${user.is_active !== false ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
            {user.is_active !== false ? 'فعال' : 'غیرفعال'}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}

// ─── Password panel ────────────────────────────────────────────────────────────
function PasswordPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const [pass, setPass] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (pass.length < 6) { toast.error('رمز عبور حداقل ۶ کاراکتر'); return; }
    if (pass !== confirm) { toast.error('رمز و تکرار آن یکسان نیست'); return; }
    setSaving(true);
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users/password`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: user.user_id, password: pass }),
      }
    );
    const result = await res.json();
    if (!res.ok || result.error) {
      toast.error(result.error || 'خطا در تغییر رمز');
    } else {
      toast.success('رمز عبور با موفقیت تغییر یافت');
      setPass(''); setConfirm('');
      onBack();
    }
    setSaving(false);
  };

  return (
    <DetailPanel title="تغییر رمز عبور" icon={KeyRound} iconColor="text-amber-500" user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6 space-y-4">
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          رمز جدید بلافاصله جایگزین رمز قبلی می‌شود. این عملیات قابل بازگشت نیست.
        </div>
        <Field label="رمز عبور جدید" icon={KeyRound}>
          <div className="relative">
            <input className={inp + ' pl-10'} type={show ? 'text' : 'password'} value={pass} onChange={e => setPass(e.target.value)} placeholder="حداقل ۶ کاراکتر" dir="ltr" />
            <button type="button" onClick={() => setShow(v => !v)} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </Field>
        <Field label="تکرار رمز عبور" icon={KeyRound}>
          <input className={inp} type="password" value={confirm} onChange={e => setConfirm(e.target.value)} placeholder="تکرار رمز" dir="ltr" />
        </Field>
        <div className="flex gap-3 pt-2">
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-6 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
            {saving ? 'در حال ذخیره...' : 'تغییر رمز'}
          </button>
          <button onClick={onBack} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
        </div>
      </div>
    </DetailPanel>
  );
}

// ─── Deactivate panel ─────────────────────────────────────────────────────────
function DeactivatePanel({ user, onBack, onDone }: { user: AdminProfile; onBack: () => void; onDone: () => void }) {
  const isActive = user.is_active !== false;
  const [saving, setSaving] = useState(false);

  const handle = async () => {
    setSaving(true);
    const { error } = await supabase.from('profiles').update({ is_active: !isActive }).eq('user_id', user.user_id);
    if (error) { toast.error('خطا'); setSaving(false); return; }
    toast.success(isActive ? 'کاربر غیرفعال شد' : 'کاربر فعال شد');
    onDone();
  };

  return (
    <DetailPanel title={isActive ? 'غیرفعال کردن کاربر' : 'فعال کردن کاربر'} icon={isActive ? UserX : UserCheck} iconColor={isActive ? 'text-red-500' : 'text-green-500'} user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-6">
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-6">
          {isActive
            ? `با غیرفعال کردن "${user.full_name || user.email}" دسترسی آن‌ها به سامانه مسدود می‌شود. اطلاعات حذف نمی‌شود.`
            : `با فعال کردن "${user.full_name || user.email}" دسترسی آن‌ها به سامانه بازگردانده می‌شود.`}
        </p>
        <div className="flex gap-3">
          <button onClick={handle} disabled={saving}
            className={`flex items-center gap-2 px-6 py-2.5 text-white rounded-xl text-sm font-medium transition disabled:opacity-60 ${isActive ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : isActive ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
            {saving ? 'در حال انجام...' : isActive ? 'غیرفعال کن' : 'فعال کن'}
          </button>
          <button onClick={onBack} className="px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm transition">انصراف</button>
        </div>
      </div>
    </DetailPanel>
  );
}

// ─── Access panel ─────────────────────────────────────────────────────────────
interface GroupMembership { group_id: string; group_name: string | null; permissions: Record<string, boolean>; }

function AccessPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const MODULES = [
    { key: 'meetings', label: 'جلسات', icon: Calendar },
    { key: 'meetings_create', label: 'ایجاد جلسه', icon: Calendar },
    { key: 'meetings_edit', label: 'ویرایش جلسه', icon: Calendar },
    { key: 'meetings_delete', label: 'حذف جلسه', icon: Calendar },
    { key: 'calendar', label: 'تقویم', icon: Calendar },
    { key: 'calendar_create_event', label: 'ایجاد رویداد تقویم', icon: Calendar },
    { key: 'chat', label: 'چت سازمانی', icon: Mail },
    { key: 'chat_send_urgent', label: 'ارسال پیام اورژانسی', icon: Mail },
    { key: 'chat_send_confidential', label: 'ارسال پیام محرمانه', icon: Mail },
    { key: 'video_conference', label: 'ویدیو کنفرانس', icon: Globe },
    { key: 'tasks', label: 'اقدامات', icon: CheckCircle2 },
    { key: 'tasks_create', label: 'ایجاد اقدام', icon: CheckCircle2 },
    { key: 'tasks_edit', label: 'ویرایش اقدام', icon: CheckCircle2 },
    { key: 'notes', label: 'یادداشت‌ها', icon: Globe },
    { key: 'notes_create', label: 'ایجاد یادداشت', icon: Globe },
    { key: 'notes_edit', label: 'ویرایش یادداشت', icon: Globe },
    { key: 'contacts', label: 'مخاطبین', icon: Users },
    { key: 'contacts_create', label: 'ایجاد مخاطب', icon: Users },
    { key: 'contacts_edit', label: 'ویرایش مخاطب', icon: Users },
    { key: 'reports', label: 'گزارشات', icon: Activity },
    { key: 'reports_export', label: 'خروجی گزارش', icon: Activity },
    { key: 'admin_panel', label: 'پنل مدیریت', icon: Shield },
  ];

  const [groups, setGroups] = useState<GroupMembership[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      // Fetch groups the user belongs to
      const { data: memberships } = await supabase
        .from('user_group_members')
        .select('group_id')
        .eq('user_id', user.user_id);
      if (!memberships || memberships.length === 0) { setLoading(false); return; }
      const groupIds = memberships.map(m => m.group_id);
      const { data: groupData } = await supabase
        .from('user_groups')
        .select('id, display_name, name, permissions')
        .in('id', groupIds);
      setGroups((groupData || []).map(g => ({
        group_id: g.id,
        group_name: g.display_name || g.name,
        permissions: (g.permissions || {}) as Record<string, boolean>,
      })));
      setLoading(false);
    })();
  }, [user.user_id]);

  // Merge: user is inactive → no access to anything. Admin → all. Otherwise check group permissions.
  const mergedPerms = (key: string): { has: boolean; source: string } => {
    if (user.is_active === false) return { has: false, source: 'کاربر غیرفعال' };
    if (key === 'admin_panel') return { has: !!user.is_admin, source: user.is_admin ? 'ادمین' : 'بدون دسترسی' };
    if (user.is_admin) return { has: true, source: 'ادمین' };
    // Check group permissions
    for (const g of groups) {
      if (g.permissions['all'] || g.permissions[key]) return { has: true, source: g.group_name || 'گروه' };
    }
    return { has: false, source: 'بدون گروه' };
  };

  return (
    <DetailPanel title="حقوق دسترسی" icon={ShieldCheck} iconColor="text-teal-500" user={user} onBack={onBack}>
      <div className="space-y-3">
        {/* Group memberships */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">عضویت در گروه‌ها</span>
            <span className="text-xs text-gray-400">{groups.length} گروه</span>
          </div>
          {loading && <div className="py-6 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>}
          {!loading && groups.length === 0 && (
            <div className="px-5 py-4 text-sm text-gray-400">عضو هیچ گروهی نیست</div>
          )}
          {!loading && groups.map(g => (
            <div key={g.group_id} className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700 last:border-0">
              <span className="text-sm text-gray-700 dark:text-gray-300">{g.group_name}</span>
              <div className="flex flex-wrap gap-1">
                {g.permissions['all'] && <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2 py-0.5 rounded-full">همه دسترسی‌ها</span>}
                {!g.permissions['all'] && Object.entries(g.permissions).filter(([, v]) => v).map(([k]) => (
                  <span key={k} className="text-xs bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 px-2 py-0.5 rounded-full">{k}</span>
                ))}
                {!g.permissions['all'] && Object.values(g.permissions).every(v => !v) && (
                  <span className="text-xs text-gray-400">بدون دسترسی خاص</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Per-module access */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">دسترسی به ماژول‌ها</p>
            <p className="text-xs text-gray-400 mt-0.5">دسترسی از ترکیب وضعیت کاربر و گروه‌های عضو محاسبه شده</p>
          </div>
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {MODULES.map(({ key, label, icon: Icon }) => {
              const { has, source } = mergedPerms(key);
              return (
                <div key={key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <div className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-gray-400" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">{source}</span>
                    <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${has ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${has ? 'bg-green-500' : 'bg-red-500'}`} />
                      {has ? 'دارد' : 'ندارد'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}

// ─── Activity panel ────────────────────────────────────────────────────────────
function ActivityPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    supabase.from('audit_log').select('*').eq('user_id', user.user_id).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => { setLogs((data || []) as AuditRow[]); setLoading(false); });
  }, [user.user_id]);

  const filtered = logs.filter(l => !search || l.action.includes(search) || (l.module || '').includes(search));

  const sevColor = (s: string) => {
    if (s === 'critical' || s === 'error') return 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400';
    if (s === 'warning') return 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400';
    return 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400';
  };

  return (
    <DetailPanel title="فعالیت‌های کاربر" icon={Activity} iconColor="text-blue-500" user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو در فعالیت‌ها..."
              className="w-full pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500" />
          </div>
          <span className="text-xs text-gray-400">{filtered.length} رویداد</span>
        </div>
        {loading && <div className="text-center py-10 text-gray-400 text-sm"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" />در حال بارگذاری...</div>}
        {!loading && filtered.length === 0 && <div className="text-center py-10 text-gray-400 text-sm">فعالیتی ثبت نشده</div>}
        <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[60vh] overflow-y-auto">
          {filtered.map(a => (
            <div key={a.id} className="px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <div className="flex items-center justify-between gap-3 mb-1">
                <span className="text-sm font-medium text-gray-800 dark:text-white">{a.action}</span>
                <span className="text-xs text-gray-400 shrink-0">{new Date(a.created_at).toLocaleString('fa-IR')}</span>
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                {a.module && <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sevColor(a.severity)}`}>{a.module}</span>}
                {a.ip_address && <span className="text-xs text-gray-400 font-mono">{a.ip_address}</span>}
                {a.details && <span className="text-xs text-gray-400 truncate">{a.details}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </DetailPanel>
  );
}

// ─── Login history panel ──────────────────────────────────────────────────────
function LoginsPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('audit_log').select('*').eq('user_id', user.user_id)
      .or('action.ilike.%لاگین%,action.ilike.%ورود%,action.ilike.%login%')
      .order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => { setLogs((data || []) as AuditRow[]); setLoading(false); });
  }, [user.user_id]);

  const parseUA = (ua: string | null) => {
    if (!ua) return '—';
    if (ua.includes('Chrome')) return 'Chrome';
    if (ua.includes('Firefox')) return 'Firefox';
    if (ua.includes('Safari')) return 'Safari';
    if (ua.includes('Edge')) return 'Edge';
    return ua.split('/')[0] || ua;
  };

  return (
    <DetailPanel title="تاریخچه ورودها" icon={History} iconColor="text-gray-500" user={user} onBack={onBack}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading && <div className="text-center py-10 text-gray-400 text-sm"><Loader2 className="w-6 h-6 animate-spin mx-auto mb-2" /></div>}
        {!loading && logs.length === 0 && (
          <div className="text-center py-12">
            <LoginIcon className="w-10 h-10 text-gray-200 dark:text-gray-700 mx-auto mb-3" />
            <p className="text-gray-400 text-sm">سابقه ورودی ثبت نشده</p>
            <p className="text-gray-300 dark:text-gray-600 text-xs mt-1">ورودهای آتی اینجا نمایش داده خواهند شد</p>
          </div>
        )}
        <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[60vh] overflow-y-auto">
          {logs.map((l, i) => (
            <div key={l.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <div className="w-8 h-8 rounded-xl bg-gray-100 dark:bg-gray-700 flex items-center justify-center shrink-0 text-xs font-bold text-gray-500">
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{l.action}</span>
                  <span className="text-xs text-gray-400 shrink-0">{new Date(l.created_at).toLocaleString('fa-IR')}</span>
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  {l.ip_address && <span className="text-xs text-gray-400 font-mono">{l.ip_address}</span>}
                  <span className="text-xs text-gray-400">{parseUA(l.user_agent)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </DetailPanel>
  );
}

// ─── Visited URLs panel ───────────────────────────────────────────────────────
function UrlsPanel({ user, onBack }: { user: AdminProfile; onBack: () => void }) {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('audit_log').select('*').eq('user_id', user.user_id)
      .not('module', 'is', null).order('created_at', { ascending: false }).limit(200)
      .then(({ data }) => { setLogs((data || []) as AuditRow[]); setLoading(false); });
  }, [user.user_id]);

  const moduleMap: Record<string, { count: number; last: string }> = {};
  logs.forEach(l => {
    if (!l.module) return;
    if (!moduleMap[l.module]) moduleMap[l.module] = { count: 0, last: l.created_at };
    moduleMap[l.module].count++;
    if (l.created_at > moduleMap[l.module].last) moduleMap[l.module].last = l.created_at;
  });

  return (
    <DetailPanel title="آدرس‌های مراجعه شده" icon={MapPin} iconColor="text-orange-500" user={user} onBack={onBack}>
      <div className="space-y-4">
        {/* Summary grid */}
        {Object.keys(moduleMap).length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">خلاصه بازدیدها</p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(moduleMap).map(([mod, { count, last }]) => (
                <div key={mod} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">{mod}</p>
                  <p className="text-2xl font-bold text-teal-500 mt-1">{count}</p>
                  <p className="text-xs text-gray-400 mt-0.5">آخرین: {new Date(last).toLocaleDateString('fa-IR')}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Detailed log */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">جزئیات رویدادها</span>
            <span className="text-xs text-gray-400">{logs.length} رویداد</span>
          </div>
          {loading && <div className="text-center py-8 text-gray-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>}
          {!loading && logs.length === 0 && <div className="text-center py-10 text-gray-400 text-sm">رویدادی ثبت نشده</div>}
          <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[50vh] overflow-y-auto">
            {logs.slice(0, 50).map(l => (
              <div key={l.id} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                <MapPin className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-24 shrink-0 truncate">{l.module}</span>
                <span className="text-xs text-gray-600 dark:text-gray-300 flex-1 truncate">{l.action}</span>
                <span className="text-xs text-gray-300 dark:text-gray-600 shrink-0">{new Date(l.created_at).toLocaleDateString('fa-IR')}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </DetailPanel>
  );
}

// ─── Main UserManagementPanel ─────────────────────────────────────────────────
interface Props { currentUserId: string; }

// Excel column headers mapping
const EXCEL_COLUMNS = [
  { key: 'full_name',    label: 'نام و نام خانوادگی' },
  { key: 'email',        label: 'ایمیل' },
  { key: 'username',     label: 'نام کاربری' },
  { key: 'phone',        label: 'شماره موبایل' },
  { key: 'national_id',  label: 'کد ملی' },
  { key: 'employee_id',  label: 'کد پرسنلی' },
  { key: 'gender',       label: 'جنسیت (male/female)' },
  { key: 'birth_date',   label: 'تاریخ تولد' },
  { key: 'city',         label: 'شهر' },
  { key: 'organization', label: 'سازمان' },
  { key: 'position',     label: 'سمت' },
  { key: 'department',   label: 'واحد' },
  { key: 'hire_date',    label: 'تاریخ استخدام' },
  { key: 'location',     label: 'موقعیت مکانی' },
  { key: 'bio',          label: 'درباره کاربر' },
  { key: 'is_admin',     label: 'ادمین (true/false)' },
  { key: 'is_active',    label: 'فعال (true/false)' },
];

// ─── Import result types & modal ─────────────────────────────────────────────
interface ImportRowError { row: number; email: string; reason: string; }
interface ImportResult { total: number; created: number; failed: number; errors: ImportRowError[]; }

function ImportResultModal({ result, onClose }: { result: ImportResult; onClose: () => void }) {
  const reasonCounts: Record<string, number> = {};
  result.errors.forEach(e => { reasonCounts[e.reason] = (reasonCounts[e.reason] || 0) + 1; });
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const allSameReason = topReason && result.errors.every(e => e.reason === topReason);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col" dir="rtl"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-gray-800 dark:text-white text-lg flex items-center gap-2">
            <Upload className="w-5 h-5 text-amber-500" />نتایج ورود دسته‌ای
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 p-5 border-b border-gray-100 dark:border-gray-700">
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-gray-800 dark:text-white">{result.total}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">کل سطرها</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">{result.created}</p>
            <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">ایجاد شد</p>
          </div>
          <div className={`rounded-xl p-3 text-center ${result.failed > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-700/50'}`}>
            <p className={`text-2xl font-bold ${result.failed > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-400'}`}>{result.failed}</p>
            <p className={`text-xs mt-0.5 ${result.failed > 0 ? 'text-red-500' : 'text-gray-400'}`}>ناموفق</p>
          </div>
        </div>

        {/* Prominent reason banner — shown when all/most errors share the same reason */}
        {result.failed > 0 && topReason && (
          <div className="mx-5 mt-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800 dark:text-amber-300">
              <span className="font-bold">{allSameReason ? 'دلیل همه خطاها:' : `شایع‌ترین خطا (${reasonCounts[topReason]} سطر):`}</span>
              {' '}{topReason}
            </div>
          </div>
        )}

        {result.errors.length > 0 ? (
          <div className="flex-1 overflow-y-auto p-5">
            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-3 uppercase tracking-wide">جزئیات سطرهای ناموفق</p>
            <div className="space-y-2">
              {result.errors.map((e, i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800">
                  <div className="shrink-0 w-6 h-6 rounded-full bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
                    <span className="text-xs font-bold text-red-600 dark:text-red-400">{e.row}</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-red-700 dark:text-red-400 truncate">{e.email || '(بدون ایمیل)'}</p>
                    <p className="text-xs text-red-500 dark:text-red-400 mt-0.5 break-words">{e.reason || '(علت نامشخص)'}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-6 flex flex-col items-center gap-2 text-center">
            <CheckCircle2 className="w-10 h-10 text-green-500" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">همه کاربران با موفقیت ایجاد شدند</p>
          </div>
        )}

        <div className="p-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose}
            className="w-full py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition">
            بستن
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── User Preview Panel ───────────────────────────────────────────────────────
function UserPreviewPanel({ user, onBack, onEdit }: { user: AdminProfile; onBack: () => void; onEdit: () => void }) {
  const initials = (user.full_name || user.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const genderLabel: Record<string, string> = { male: 'مرد', female: 'زن', other: 'سایر' };

  const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    value ? (
      <div className="flex items-start gap-2 py-2 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
        <span className="text-xs text-gray-400 w-28 shrink-0 pt-0.5">{label}</span>
        <span className="text-sm text-gray-700 dark:text-gray-200 font-medium break-all">{value}</span>
      </div>
    ) : null
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors">
          <X className="w-4 h-4" />
        </button>
        <Eye className="w-5 h-5 text-teal-500" />
        <h3 className="font-bold text-gray-800 dark:text-white text-lg">پیش‌نمایش کاربر</h3>
        <button onClick={onEdit} className="mr-auto flex items-center gap-1.5 px-4 py-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition">
          <Pencil className="w-3.5 h-3.5" />ویرایش
        </button>
      </div>

      {/* Avatar + header */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-teal-400 to-blue-500 shrink-0">
            {user.avatar_url
              ? <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-white text-2xl font-bold">{initials}</div>}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">{user.full_name || '—'}</h2>
            {user.position && <p className="text-sm text-teal-600 dark:text-teal-400">{user.position}</p>}
            {user.organization && <p className="text-xs text-gray-400">{user.organization}</p>}
            <div className="flex flex-wrap gap-2 mt-2">
              {user.is_admin && (
                <span className="inline-flex items-center gap-1 text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-2.5 py-1 rounded-full">
                  <Shield className="w-3 h-3" />ادمین
                </span>
              )}
              <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${user.is_active !== false ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${user.is_active !== false ? 'bg-green-500' : 'bg-red-500'}`} />
                {user.is_active !== false ? 'فعال' : 'غیرفعال'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Contact info */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
          <User className="w-4 h-4 text-teal-500" />اطلاعات شخصی و تماس
        </h4>
        <InfoRow label="ایمیل" value={<span className="font-mono">{user.email}</span>} />
        <InfoRow label="نام کاربری" value={user.username ? <span className="font-mono text-teal-600 dark:text-teal-400">@{user.username}</span> : null} />
        <InfoRow label="شماره موبایل" value={user.phone} />
        <InfoRow label="کد ملی" value={user.national_id} />
        <InfoRow label="جنسیت" value={user.gender ? genderLabel[user.gender] || user.gender : null} />
        <InfoRow label="شهر" value={user.city} />
        {user.bio && <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/50">
          <p className="text-xs text-gray-400 mb-1">درباره کاربر</p>
          <p className="text-sm text-gray-600 dark:text-gray-300">{user.bio}</p>
        </div>}
      </div>

      {/* Work info */}
      {(user.organization || user.department || user.employee_id || user.hire_date) && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
          <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
            <Briefcase className="w-4 h-4 text-blue-500" />اطلاعات سازمانی
          </h4>
          <InfoRow label="سازمان" value={user.organization} />
          <InfoRow label="واحد" value={user.department} />
          <InfoRow label="سمت" value={user.position} />
          <InfoRow label="کد پرسنلی" value={user.employee_id} />
          <InfoRow label="محل کار" value={user.location} />
          <InfoRow label="تاریخ استخدام" value={user.hire_date} />
        </div>
      )}

      {/* Social section removed */}

      <div className="text-xs text-gray-400 text-left pb-4">
        تاریخ ثبت: {user.created_at ? new Date(user.created_at).toLocaleString('fa-IR') : '—'}
      </div>
    </div>
  );
}

// ─── User Relations Panel ─────────────────────────────────────────────────────
function UserRelationsPanel({ user, onBack, allProfiles }: { user: AdminProfile; onBack: () => void; allProfiles: AdminProfile[] }) {
  interface Relation {
    id: string;
    user_id: string;
    related_user_id: string;
    relation_type: string;
    note: string | null;
    created_at: string;
  }
  const [relations, setRelations] = useState<Relation[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ related_user_id: '', relation_type: 'view', note: '' });
  const [saving, setSaving] = useState(false);

  const RELATION_TYPES = [
    { value: 'view', label: 'مشاهده', desc: 'فقط می‌تواند داده‌های طرف مقابل را ببیند' },
    { value: 'collaborate', label: 'همکاری', desc: 'می‌توانند با هم همکاری کنند' },
    { value: 'manage', label: 'مدیریت', desc: 'می‌تواند داده‌های طرف مقابل را مدیریت کند' },
  ];

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('user_access_relations')
      .select('*')
      .or(`user_id.eq.${user.user_id},related_user_id.eq.${user.user_id}`)
      .order('created_at', { ascending: false });
    setRelations((data || []) as Relation[]);
    setLoading(false);
  };

  useEffect(() => { load(); }, [user.user_id]);

  const getProfile = (uid: string) => allProfiles.find(p => p.user_id === uid);

  const handleAdd = async () => {
    if (!form.related_user_id) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('user_access_relations').insert({
        user_id: user.user_id,
        related_user_id: form.related_user_id,
        relation_type: form.relation_type,
        note: form.note || null,
      });
      if (error) { toast.error('خطا: ' + error.message); return; }
      toast.success('ارتباط اضافه شد');
      setAdding(false);
      setForm({ related_user_id: '', relation_type: 'view', note: '' });
      load();
    } finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('user_access_relations').delete().eq('id', id);
    if (error) { toast.error('خطا در حذف'); return; }
    toast.success('ارتباط حذف شد');
    load();
  };

  const relTypeLabel = (type: string) => RELATION_TYPES.find(r => r.value === type)?.label || type;

  const otherUsers = allProfiles.filter(p =>
    p.user_id !== user.user_id &&
    !relations.some(r => r.user_id === user.user_id && r.related_user_id === p.user_id)
  );

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors">
          <X className="w-4 h-4 text-gray-500" />
        </button>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
            <Link2 className="w-4 h-4 text-blue-500" />
            ارتباطات دستی — {user.full_name || user.email}
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">ارتباطات خارج از ساختار سازمانی</p>
        </div>
      </div>

      {/* دکمه افزودن */}
      {!adding && (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" /> افزودن ارتباط جدید
        </button>
      )}

      {/* فرم افزودن */}
      {adding && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-3">
          <h4 className="text-sm font-bold text-gray-700 dark:text-gray-200">ارتباط جدید</h4>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">کاربر مرتبط</label>
            <select
              value={form.related_user_id}
              onChange={e => setForm(f => ({ ...f, related_user_id: e.target.value }))}
              className="w-full p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-white"
            >
              <option value="">— انتخاب کنید —</option>
              {otherUsers.map(p => (
                <option key={p.user_id} value={p.user_id}>
                  {p.full_name || p.email}
                  {p.position ? ` (${p.position})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع ارتباط</label>
            <div className="flex gap-2">
              {RELATION_TYPES.map(r => (
                <button
                  key={r.value}
                  onClick={() => setForm(f => ({ ...f, relation_type: r.value }))}
                  title={r.desc}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium border transition-colors ${form.relation_type === r.value ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-blue-300'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">{RELATION_TYPES.find(r => r.value === form.relation_type)?.desc}</p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">توضیح (اختیاری)</label>
            <input
              type="text"
              value={form.note}
              onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
              placeholder="دلیل این ارتباط..."
              className="w-full p-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAdd} disabled={!form.related_user_id || saving}
              className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-sm font-semibold transition-colors">
              {saving ? 'در حال ذخیره...' : 'ثبت ارتباط'}
            </button>
            <button onClick={() => { setAdding(false); setForm({ related_user_id: '', relation_type: 'view', note: '' }); }}
              className="px-4 py-2 border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 rounded-xl text-sm hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
              انصراف
            </button>
          </div>
        </div>
      )}

      {/* لیست ارتباطات */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading ? (
          <div className="py-8 text-center text-gray-400 text-sm">در حال بارگذاری...</div>
        ) : relations.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Link2 className="w-8 h-8 mx-auto text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-400">هیچ ارتباط دستی تعریف نشده است</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {relations.map(r => {
              const isOwner = r.user_id === user.user_id;
              const otherUserId = isOwner ? r.related_user_id : r.user_id;
              const other = getProfile(otherUserId);
              return (
                <div key={r.id} className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${isOwner ? 'bg-blue-500' : 'bg-green-500'}`}>
                      {(other?.full_name || other?.email || '?')[0]}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 dark:text-white truncate">
                        {other?.full_name || other?.email || otherUserId}
                        {other?.position ? <span className="text-xs text-gray-400 mr-1">({other.position})</span> : null}
                      </p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={`text-xs px-1.5 py-0.5 rounded-md font-medium ${r.relation_type === 'manage' ? 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400' : r.relation_type === 'collaborate' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'}`}>
                          {relTypeLabel(r.relation_type)}
                        </span>
                        {!isOwner && <span className="text-xs text-green-600 dark:text-green-400">(تعریف شده توسط طرف مقابل)</span>}
                        {r.note && <span className="text-xs text-gray-400 truncate">{r.note}</span>}
                      </div>
                    </div>
                  </div>
                  {isOwner && (
                    <button
                      onClick={() => handleDelete(r.id)}
                      className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors shrink-0"
                      title="حذف ارتباط"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export function UserManagementPanel({ currentUserId }: Props) {
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [panel, setPanel] = useState<Panel>('list');
  const [selectedUser, setSelectedUser] = useState<AdminProfile | null>(null);
  const [menuOpen, setMenuOpen] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const importRef = useRef<HTMLInputElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (data) setProfiles(data as AdminProfile[]);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(null);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const openPanel = (p: Panel, user: AdminProfile) => {
    setSelectedUser(user);
    setPanel(p);
    setMenuOpen(null);
  };

  const goBack = () => { setPanel('list'); setSelectedUser(null); };

  const handleSaveUser = async (updated: AdminProfile, password?: string) => {
    if (password) {
      // Create new user via admin edge function (service role, no email confirmation needed)
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users/create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            email: updated.email!.trim(),
            password,
            profile: {
              full_name: updated.full_name,
              username: updated.username || null,
              phone: updated.phone,
              organization: updated.organization,
              position: updated.position,
              department: updated.department,
              employee_id: updated.employee_id,
              hire_date: updated.hire_date,
              birth_date: updated.birth_date,
              gender: updated.gender,
              city: updated.city,
              location: updated.location,
              bio: updated.bio,
              national_id: updated.national_id,
              is_admin: updated.is_admin,
            },
          }),
        }
      );
      const result = await res.json();
      if (!res.ok || result.error) { toast.error(result.error || 'خطا در ایجاد کاربر'); return; }
      toast.success('کاربر ایجاد شد');
      await load();
      goBack();
    } else {
      const { error } = await supabase.from('profiles').update({
        full_name: updated.full_name,
        username: updated.username || null,
        phone: updated.phone,
        organization: updated.organization,
        position: updated.position,
        department: updated.department,
        employee_id: updated.employee_id,
        hire_date: updated.hire_date,
        birth_date: updated.birth_date,
        gender: updated.gender,
        city: updated.city,
        location: updated.location,
        bio: updated.bio,
        national_id: updated.national_id,
        is_admin: updated.is_admin,
        is_active: updated.is_active,
        is_hidden: updated.is_hidden ?? false,
      }).eq('user_id', updated.user_id);
      if (error) { toast.error('خطا در ذخیره'); return; }
      toast.success('اطلاعات ذخیره شد');
      await load();
      goBack();
    }
  };

  const emptyNew: AdminProfile = {
    user_id: '', full_name: '', email: '', username: '', phone: '', organization: '', position: '',
    department: '', employee_id: '', hire_date: '', birth_date: '', gender: '', city: '',
    location: '', bio: '', national_id: '', avatar_url: '',
    is_admin: false, is_active: true, is_hidden: false, created_at: null,
  };

  const exportToExcel = () => {
    const rows = profiles.map(p => {
      const row: Record<string, string> = {};
      EXCEL_COLUMNS.forEach(col => {
        const val = (p as any)[col.key];
        row[col.label] = val === null || val === undefined ? '' : String(val);
      });
      return row;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'کاربران');
    XLSX.writeFile(wb, `users_${new Date().toLocaleDateString('fa-IR').replace(/\//g, '-')}.xlsx`);
    toast.success(`${profiles.length} کاربر خروجی گرفته شد`);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('[IMPORT] Import started');

    const file = e.target.files?.[0];
    if (!file) return;
    console.log('[IMPORT] File received:', file.name);

    e.target.value = '';
    setImporting(true);

    const result: ImportResult = { total: 0, created: 0, failed: 0, errors: [] };

    try {
      const data = await file.arrayBuffer();
      const wb = XLSX.read(data);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
      console.log('[IMPORT] Total rows:', rows.length);

      if (!rows.length) {
        toast.error('فایل خالی است');
        setImporting(false);
        return;
      }

      // Normalize Persian/Arabic Unicode variants so column lookup is robust
      // regardless of which keyboard layout was used to type the headers.
      const normKey = (s: string) =>
        s.trim()
          .normalize('NFC')
          .replace(/[\u064A\u0649]/g, '\u06CC') // Arabic Yeh/Alef Maqsura → Persian Yeh
          .replace(/\u0643/g, '\u06A9')          // Arabic Kaf → Persian Kaf
          .replace(/\u0647\u0654/g, '\u06C0')
          .toLowerCase();

      const fileKeys = rows[0] ? Object.keys(rows[0]) : [];

      // Build a normalised-key → original-key map for O(1) lookup
      const normMap = new Map<string, string>();
      fileKeys.forEach(k => normMap.set(normKey(k), k));

      // Resolve a cell value by trying multiple column name candidates
      const cell = (row: Record<string, unknown>, ...candidates: string[]): string => {
        for (const c of candidates) {
          const orig = normMap.get(normKey(c));
          if (orig !== undefined) {
            const v = String(row[orig] ?? '').trim();
            if (v) return v;
          }
        }
        return '';
      };

      const emailColKey = normMap.get(normKey('ایمیل')) ?? normMap.get('email') ?? normMap.get('e-mail');
      if (!emailColKey) {
        console.error('[IMPORT] Email column not found in file');
        toast.error(`ستون «ایمیل» در فایل یافت نشد. ستون‌های موجود: ${fileKeys.slice(0, 5).join(', ')}`);
        setImporting(false);
        return;
      }

      result.total = rows.length;

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error('جلسه کاربر منقضی شده — لطفاً دوباره وارد شوید');
        setImporting(false);
        return;
      }

      const str = (v: string): string | null => v.trim() || null;
      const bool = (v: string, fallback: boolean): boolean => {
        const s = v.trim().toLowerCase();
        if (s === 'true' || s === '1') return true;
        if (s === 'false' || s === '0') return false;
        return fallback;
      };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] as Record<string, unknown>;
        const rowNum = i + 2;

        const email = String(row[emailColKey] ?? '').trim().toLowerCase();
        const passwordRaw = cell(row, 'رمز عبور', 'password', 'Password');
        const password = passwordRaw || 'Ss123456';

        if (!email) {
          result.failed++;
          result.errors.push({ row: rowNum, email: '', reason: 'مقدار ستون ایمیل خالی است' });
          continue;
        }

        const payload = {
          email,
          password,
          profile: {
            full_name:    str(cell(row, 'نام و نام خانوادگی', 'full_name', 'name')),
            username:     str(cell(row, 'نام کاربری', 'username')),
            phone:        str(cell(row, 'شماره موبایل', 'phone', 'mobile')),
            national_id:  str(cell(row, 'کد ملی', 'national_id')),
            employee_id:  str(cell(row, 'کد پرسنلی', 'employee_id')),
            gender:       str(cell(row, 'جنسیت (male/female)', 'جنسیت', 'gender')),
            birth_date:   str(cell(row, 'تاریخ تولد', 'birth_date')),
            city:         str(cell(row, 'شهر', 'city')),
            organization: str(cell(row, 'سازمان', 'organization')),
            position:     str(cell(row, 'سمت', 'position')),
            department:   str(cell(row, 'واحد', 'department')),
            hire_date:    str(cell(row, 'تاریخ استخدام', 'hire_date')),
            location:     str(cell(row, 'موقعیت مکانی', 'location')),
            bio:          str(cell(row, 'درباره کاربر', 'bio')),
            is_admin:     bool(cell(row, 'ادمین (true/false)', 'is_admin', 'admin'), false),
            is_active:    bool(cell(row, 'فعال (true/false)', 'is_active', 'active'), true),
          },
        };

        try {
          const res = await fetch(
            `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-users/create`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
                'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
              },
              body: JSON.stringify(payload),
            }
          );

          const json = await res.json();
          if (!res.ok || json.error) {
            result.failed++;
            result.errors.push({ row: rowNum, email, reason: json.error || `HTTP ${res.status}` });
          } else {
            result.created++;
          }
        } catch (err: any) {
          console.error('[IMPORT] Row', rowNum, 'network error:', err.message);
          result.failed++;
          result.errors.push({ row: rowNum, email, reason: err.message || 'خطای شبکه' });
        }
      }

      console.log('[IMPORT] Import finished — total:', result.total, '| created:', result.created, '| failed:', result.failed);

      await load();
      setImportResult(result);
    } catch (err: any) {
      console.error('[IMPORT] Failed to process file:', err.message);
      toast.error('خطا در پردازش فایل: ' + err.message);
    } finally {
      setImporting(false);
    }
  };

  const downloadTemplate = () => {
    const headers = [...EXCEL_COLUMNS.map(c => c.label), 'رمز عبور'];
    const example = [
      'علی محمدی',       // نام و نام خانوادگی
      'ali@example.com', // ایمیل
      'ali.mohammadi',   // نام کاربری
      '09123456789',     // شماره موبایل
      '1234567890',      // کد ملی
      'P001',            // کد پرسنلی
      'male',            // جنسیت
      '1370/01/01',      // تاریخ تولد
      'تهران',           // شهر
      '',                // سازمان
      '',                // سمت
      '',                // واحد
      '',                // تاریخ استخدام
      '',                // موقعیت مکانی
      '',                // درباره کاربر
      'false',           // ادمین (true/false)
      'true',            // فعال (true/false)
      'Password@123',    // رمز عبور (اختیاری — پیش‌فرض: Ss123456)
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, example]);
    ws['!cols'] = headers.map(() => ({ wch: 22 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'قالب');
    XLSX.writeFile(wb, 'users_template.xlsx');
    toast.success('قالب دانلود شد');
  };

  const filtered = profiles.filter(p =>
    !search || (p.full_name || '').includes(search) || (p.email || '').includes(search) || (p.department || '').includes(search)
  );

  const menuItems = (p: AdminProfile) => [
    { icon: Pencil, label: 'ویرایش اطلاعات', panel: 'edit' as Panel, color: 'text-blue-500' },
    { icon: KeyRound, label: 'تغییر رمز عبور', panel: 'password' as Panel, color: 'text-amber-500' },
    { icon: p.is_active !== false ? UserX : UserCheck, label: p.is_active !== false ? 'غیرفعال کردن' : 'فعال کردن', panel: 'deactivate' as Panel, color: p.is_active !== false ? 'text-red-500' : 'text-green-500' },
    { icon: ShieldCheck, label: 'حقوق دسترسی', panel: 'access' as Panel, color: 'text-teal-500' },
    { icon: Link2, label: 'ارتباطات دستی', panel: 'relations' as Panel, color: 'text-blue-500' },
    { icon: Activity, label: 'فعالیت‌های کاربر', panel: 'activity' as Panel, color: 'text-blue-500' },
    { icon: History, label: 'تاریخچه ورودها', panel: 'logins' as Panel, color: 'text-gray-500' },
    { icon: MapPin, label: 'آدرس‌های مراجعه شده', panel: 'urls' as Panel, color: 'text-orange-500' },
  ];

  // ── Render non-list panels ────────────────────────────────────────────────
  if (panel === 'preview' && selectedUser) {
    return <UserPreviewPanel user={selectedUser} onBack={goBack} onEdit={() => setPanel('edit')} />;
  }
  if (panel === 'add') {
    return <UserProfileForm title="افزودن کاربر جدید" profile={emptyNew} isNew onSave={handleSaveUser} onBack={goBack} currentUserId={currentUserId} />;
  }
  if (panel === 'edit' && selectedUser) {
    return <UserProfileForm title="ویرایش اطلاعات کاربر" profile={selectedUser} isNew={false} onSave={handleSaveUser} onBack={goBack} currentUserId={currentUserId} />;
  }
  if (panel === 'password' && selectedUser) return <PasswordPanel user={selectedUser} onBack={goBack} />;
  if (panel === 'deactivate' && selectedUser) return <DeactivatePanel user={selectedUser} onBack={goBack} onDone={() => { load(); goBack(); }} />;
  if (panel === 'access' && selectedUser) return <AccessPanel user={selectedUser} onBack={goBack} />;
  if (panel === 'relations' && selectedUser) return <UserRelationsPanel user={selectedUser} onBack={goBack} allProfiles={profiles} />;
  if (panel === 'activity' && selectedUser) return <ActivityPanel user={selectedUser} onBack={goBack} />;
  if (panel === 'logins' && selectedUser) return <LoginsPanel user={selectedUser} onBack={goBack} />;
  if (panel === 'urls' && selectedUser) return <UrlsPanel user={selectedUser} onBack={goBack} />;

  // ── Users list ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4" dir="rtl">
      {importResult && <ImportResultModal result={importResult} onClose={() => setImportResult(null)} />}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Users className="w-5 h-5 text-blue-500" />فهرست کاربران
          <span className="text-sm font-normal text-gray-400">({profiles.length})</span>
        </h3>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو..."
              className="pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 w-44" />
          </div>
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors" title="بارگذاری مجدد">
            <RefreshCw className="w-4 h-4" />
          </button>
          {/* Export */}
          <button onClick={exportToExcel}
            className="flex items-center gap-1.5 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-xl text-sm font-medium transition-colors" title="خروجی اکسل">
            <Download className="w-4 h-4" />خروجی
          </button>
          {/* Import */}
          <div className="relative">
            <input
              ref={importRef}
              type="file"
              accept=".xlsx,.xls"
              style={{ position: 'absolute', width: 1, height: 1, opacity: 0, overflow: 'hidden', zIndex: -1 }}
              onChange={handleImportFile}
            />
            <button
              onClick={() => {
                importRef.current?.click();
              }}
              disabled={importing}
              className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition-colors" title="ورود دسته‌ای از اکسل">
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing ? 'در حال وارد کردن...' : 'وارد کردن'}
            </button>
          </div>
          {/* Template */}
          <button onClick={downloadTemplate}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors" title="دانلود قالب اکسل">
            قالب
          </button>
          <button onClick={() => setPanel('add')}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" />افزودن کاربر
          </button>
        </div>
      </div>
      {/* Import hint */}
      <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800 text-xs text-amber-700 dark:text-amber-300">
        <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
        <span>برای وارد کردن دسته‌ای: ابتدا «قالب» را دانلود کنید، اطلاعات کاربران را پر کنید، سپس «وارد کردن» را بزنید. تنها ستون «ایمیل» الزامی است — اگر رمز عبور خالی باشد، رمز پیش‌فرض <span className="font-mono font-semibold">Ss123456</span> تنظیم می‌شود.</span>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-right">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">کاربر</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">ایمیل / نام کاربری</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">واحد / سمت</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">ادمین</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">وضعیت</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">تاریخ ثبت</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filtered.map(p => (
                <tr key={p.user_id} onClick={() => openPanel('preview', p)}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 bg-gradient-to-br from-teal-400 to-blue-500">
                        {p.avatar_url
                          ? <img src={p.avatar_url} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                              {(p.full_name || p.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
                            </div>}
                      </div>
                      <div>
                        <div className="font-medium text-gray-800 dark:text-white flex items-center gap-1 text-sm">
                          {p.full_name || '—'}
                          {p.user_id === currentUserId && <span className="text-xs bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 px-1.5 py-0.5 rounded-full">شما</span>}
                          {p.is_hidden && <span className="text-xs bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full flex items-center gap-0.5"><EyeOff className="w-2.5 h-2.5" />مخفی</span>}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-400 text-xs font-mono">{p.email}</div>
                    {p.username && (
                      <div className="text-xs text-teal-600 dark:text-teal-400 font-medium mt-0.5">@{p.username}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">
                    {p.department && <div className="font-medium">{p.department}</div>}
                    {p.position && <div className="text-gray-400">{p.position}</div>}
                    {!p.department && !p.position && '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button onClick={() => supabase.from('profiles').update({ is_admin: !p.is_admin }).eq('user_id', p.user_id).then(load)}
                      className={`w-9 h-5 rounded-full relative transition-colors ${p.is_admin ? 'bg-blue-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
                      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${p.is_admin ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${p.is_active !== false ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${p.is_active !== false ? 'bg-green-500' : 'bg-red-500'}`} />
                      {p.is_active !== false ? 'فعال' : 'غیرفعال'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-400">
                    {p.created_at ? new Date(p.created_at).toLocaleDateString('fa-IR') : '—'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="relative inline-block" ref={menuOpen === p.user_id ? menuRef : undefined}>
                      <button
                        onClick={e => { e.stopPropagation(); setMenuOpen(menuOpen === p.user_id ? null : p.user_id); }}
                        className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors">
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {menuOpen === p.user_id && (
                        <div
                          className="absolute left-0 top-full mt-1 w-52 bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-700 z-50 overflow-hidden py-1"
                          onClick={e => e.stopPropagation()}>
                          {menuItems(p).map(({ icon: Icon, label, panel: target, color }) => (
                            <button key={target} onClick={() => openPanel(target, p)}
                              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-right">
                              <Icon className={`w-4 h-4 shrink-0 ${color}`} />
                              <span className="text-sm text-gray-700 dark:text-gray-200">{label}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-14">
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <User className="w-10 h-10 opacity-30" />
                      <p className="text-sm">
                        {search ? `کاربری با عنوان «${search}» یافت نشد` : 'هنوز کاربری ثبت نشده است'}
                      </p>
                      <button
                        onClick={() => setPanel('add')}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-sm font-medium transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                        {search ? `افزودن کاربر جدید` : 'افزودن اولین کاربر'}
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
