import { User, Mail, Phone, Building, MapPin, CreditCard, Users, AtSign } from 'lucide-react';
import { Field } from './Field';
import { JalaaliDateInput } from './JalaaliDateInput';
import { inp, inpDisabled } from './types';
import type { Profile } from './types';

export function PersonalInfoSection({ profile, set }: { profile: Profile; set: (field: keyof typeof profile, value: string) => void }) {
  return (
    <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
      <Field label="نام و نام خانوادگی" icon={User}>
        <input type="text" value={profile.full_name} onChange={e => set('full_name', e.target.value)}
          className={inp} placeholder="نام کامل" />
      </Field>

      <Field label="نام کاربری" icon={AtSign}>
        <input type="text" value={profile.username || ''} disabled
          className={inpDisabled} placeholder="username_123" dir="ltr" />
        <p className="text-xs text-gray-400 mt-1">نام کاربری توسط مدیر تعیین می‌شود و قابل تغییر نیست</p>
      </Field>

      <Field label="ایمیل" icon={Mail}>
        <input type="email" value={profile.email} disabled className={inpDisabled} />
      </Field>

      <Field label="شماره موبایل" icon={Phone}>
        <input type="tel" value={profile.phone} onChange={e => set('phone', e.target.value)}
          className={inp} placeholder="09xxxxxxxxx" dir="ltr" />
      </Field>

      <Field label="کد ملی" icon={CreditCard}>
        <input type="text" value={profile.national_id} onChange={e => set('national_id', e.target.value)}
          className={inp} placeholder="کد ملی ۱۰ رقمی" dir="ltr" maxLength={10} />
      </Field>

      <div>
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">
          تاریخ تولد (شمسی)
        </label>
        <JalaaliDateInput value={profile.birth_date || ''} onChange={v => set('birth_date', v)} className="w-full" />
      </div>

      <Field label="جنسیت" icon={Users}>
        <select value={profile.gender} onChange={e => set('gender', e.target.value)} className={inp}>
          <option value="">انتخاب کنید</option>
          <option value="male">مرد</option>
          <option value="female">زن</option>
          <option value="other">سایر</option>
        </select>
      </Field>

      <Field label="شهر" icon={MapPin}>
        <input type="text" value={profile.city} onChange={e => set('city', e.target.value)}
          className={inp} placeholder="شهر محل سکونت" />
      </Field>

      <div className="md:col-span-2">
        <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">درباره من</label>
        <textarea value={profile.bio} onChange={e => set('bio', e.target.value)} rows={3}
          className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent transition text-sm resize-none"
          placeholder="چند جمله درباره خودتان بنویسید..." />
      </div>
    </div>
  );
}
