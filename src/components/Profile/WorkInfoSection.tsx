import { Building, Briefcase, Hash, Users, MapPin, Building2, Crown, Link2 } from 'lucide-react';
import { Field } from './Field';
import { JalaaliDateInput } from './JalaaliDateInput';
import { inp, inpDisabled, LEVEL_LABELS } from './types';
import type { Profile, OrgPositionInfo } from './types';

export function WorkInfoSection({ profile, orgPositionInfo, set }: { profile: Profile; orgPositionInfo: OrgPositionInfo | null; set: (field: keyof typeof profile, value: string) => void }) {
  return (
    <div className="p-6 space-y-5">
      {orgPositionInfo ? (
        <div className="flex items-center gap-4 p-4 rounded-2xl border-2"
          style={{ borderColor: orgPositionInfo.color + '60', backgroundColor: orgPositionInfo.color + '0d' }}>
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-2xl flex-shrink-0"
            style={{ backgroundColor: orgPositionInfo.color + '20' }}>
            {orgPositionInfo.icon || '💼'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-gray-800 dark:text-white">{orgPositionInfo.title}</span>
              <span className="text-xs px-2 py-0.5 rounded-full text-white font-medium"
                style={{ backgroundColor: orgPositionInfo.color }}>
                {LEVEL_LABELS[orgPositionInfo.level] || `سطح ${orgPositionInfo.level}`}
              </span>
            </div>
            <div className="flex items-center gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400 flex-wrap">
              {orgPositionInfo.unit_name && (
                <span className="flex items-center gap-1">
                  <Building2 className="w-3 h-3" />{orgPositionInfo.unit_name}
                </span>
              )}
              {orgPositionInfo.parent_title && (
                <span className="flex items-center gap-1">
                  <Crown className="w-3 h-3" />گزارش به: {orgPositionInfo.parent_title}
                </span>
              )}
            </div>
          </div>
          <div className="text-xs text-gray-400 flex items-center gap-1 flex-shrink-0">
            <Link2 className="w-3 h-3" /> از چارت سازمانی
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 p-4 rounded-2xl border border-dashed border-gray-200 dark:border-gray-600 text-sm text-gray-400 dark:text-gray-500">
          <Building2 className="w-5 h-5 flex-shrink-0" />
          <span>سمت سازمانی از طریق ساختار سازمانی تخصیص نیافته است. ادمین می‌تواند از پنل پیکربندی → ساختار سازمانی سمت تخصیص دهد.</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Field label="نام سازمان / شرکت" icon={Building}>
          <input type="text" value={profile.organization}
            onChange={e => set('organization', e.target.value)}
            className={(orgPositionInfo || profile.primary_position_id) ? inpDisabled : inp}
            readOnly={!!(orgPositionInfo || profile.primary_position_id)}
            title={(orgPositionInfo || profile.primary_position_id) ? 'این فیلد از ساختار سازمانی تکمیل می‌شود' : ''}
            placeholder="نام سازمان یا شرکت" />
        </Field>

        <Field label="سمت / عنوان شغلی" icon={Briefcase}>
          <input type="text" value={profile.position} disabled className={inpDisabled}
            title="این فیلد توسط ساختار سازمانی مدیریت می‌شود" />
        </Field>

        <Field label="واحد / دپارتمان" icon={Users}>
          <input type="text" value={profile.department} disabled className={inpDisabled}
            title="این فیلد توسط ساختار سازمانی مدیریت می‌شود" />
        </Field>

        <Field label="کد پرسنلی" icon={Hash}>
          <input type="text" value={profile.employee_id} onChange={e => set('employee_id', e.target.value)}
            className={inp} placeholder="شماره پرسنلی" dir="ltr" />
        </Field>

        <div>
          <label className="block text-sm font-medium text-gray-600 dark:text-gray-400 mb-1.5">
            تاریخ استخدام (شمسی)
          </label>
          <JalaaliDateInput value={profile.hire_date || ''} onChange={v => set('hire_date', v)} className="w-full" />
        </div>

        <Field label="موقعیت مکانی (دفتر)" icon={MapPin}>
          <input type="text" value={profile.location} onChange={e => set('location', e.target.value)}
            className={inp} placeholder="آدرس دفتر یا محل کار" />
        </Field>
      </div>

      {(profile.position || profile.department) && (
        <div className="flex items-start gap-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 text-xs text-blue-700 dark:text-blue-300">
          <Building2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          فیلدهای سمت و واحد توسط ادمین از طریق ساختار سازمانی تنظیم می‌شوند و قابل ویرایش نیستند.
        </div>
      )}
    </div>
  );
}
