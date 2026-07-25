import React from 'react';
import { X, Eye, Pencil, Shield, User, Briefcase } from 'lucide-react';
import type { AdminProfile } from './types';

function UserPreviewPanel({ user, onBack, onEdit }: { user: AdminProfile; onBack: () => void; onEdit: () => void }) {
  const initials = (user.full_name || user.email || '?').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  const genderLabel: Record<string, string> = { male: 'مرد', female: 'زن', other: 'سایر' };

  const InfoRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    value ? (
      <div className="flex items-start gap-2 py-2 border-b border-gray-100 dark:border-gray-700/50 last:border-0">
        <span className="text-xs text-gray-400 w-28 flex-shrink-0 pt-0.5">{label}</span>
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

      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5">
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl overflow-hidden bg-gradient-to-br from-teal-400 to-blue-500 flex-shrink-0">
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

      <div className="text-xs text-gray-400 text-left pb-4">
        تاریخ ثبت: {user.created_at ? new Date(user.created_at).toLocaleString('fa-IR') : '—'}
      </div>
    </div>
  );
}

export { UserPreviewPanel };
