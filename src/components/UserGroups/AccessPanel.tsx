import { useState } from 'react';
import { ShieldCheck, Save, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import { BackHeader, GroupBadge } from './Shared';
import type { UserGroup } from './types';

const PERMISSION_GROUPS = [
  {
    label: 'ماژول‌های اصلی',
    color: 'text-blue-500',
    items: [
      { key: 'meetings', label: 'جلسات و برنامه‌ریزی', desc: 'دسترسی به بخش جلسات' },
      { key: 'calendar', label: 'تقویم', desc: 'دسترسی به تقویم سازمانی' },
      { key: 'chat', label: 'چت سازمانی', desc: 'دسترسی به چت' },
      { key: 'channels', label: 'کانال‌ها و گروه‌ها', desc: 'دسترسی به کانال‌ها و گروه‌های سازمانی' },
      { key: 'video_conference', label: 'ویدیو کنفرانس', desc: 'دسترسی به تماس تصویری' },
      { key: 'tasks', label: 'اقدامات و وظایف', desc: 'دسترسی به وظایف' },
      { key: 'notes', label: 'یادداشت‌ها', desc: 'دسترسی به یادداشت‌ها' },
      { key: 'contacts', label: 'مخاطبین', desc: 'دسترسی به مخاطبین' },
      { key: 'reports', label: 'گزارشات تحلیلی', desc: 'دسترسی به گزارشات' },
      { key: 'admin_panel', label: 'پنل مدیریت', desc: 'دسترسی به پیکربندی سیستم' },
    ],
  },
  {
    label: 'جلسات — عملیات',
    color: 'text-cyan-600',
    items: [
      { key: 'meetings_create', label: 'ایجاد جلسه', desc: 'اجازه ایجاد جلسه جدید' },
      { key: 'meetings_edit', label: 'ویرایش جلسه', desc: 'اجازه ویرایش جلسات' },
      { key: 'meetings_delete', label: 'حذف جلسه', desc: 'اجازه حذف جلسات' },
      { key: 'meetings_approve', label: 'تایید جلسه', desc: 'اجازه تغییر وضعیت جلسه' },
    ],
  },
  {
    label: 'اقدامات — عملیات',
    color: 'text-green-600',
    items: [
      { key: 'tasks_create', label: 'ایجاد اقدام', desc: 'اجازه ثبت اقدام جدید' },
      { key: 'tasks_edit', label: 'ویرایش اقدام', desc: 'اجازه ویرایش اقدامات' },
      { key: 'tasks_delete', label: 'حذف اقدام', desc: 'اجازه حذف اقدامات' },
    ],
  },
  {
    label: 'یادداشت‌ها — عملیات',
    color: 'text-amber-600',
    items: [
      { key: 'notes_create', label: 'ایجاد یادداشت', desc: 'اجازه ثبت یادداشت جدید' },
      { key: 'notes_edit', label: 'ویرایش یادداشت', desc: 'اجازه ویرایش یادداشت‌ها' },
      { key: 'notes_delete', label: 'حذف یادداشت', desc: 'اجازه حذف یادداشت‌ها' },
    ],
  },
  {
    label: 'مخاطبین — عملیات',
    color: 'text-orange-600',
    items: [
      { key: 'contacts_create', label: 'ایجاد مخاطب', desc: 'اجازه افزودن مخاطب' },
      { key: 'contacts_edit', label: 'ویرایش مخاطب', desc: 'اجازه ویرایش مخاطبین' },
      { key: 'contacts_delete', label: 'حذف مخاطب', desc: 'اجازه حذف مخاطبین' },
    ],
  },
  {
    label: 'تقویم — عملیات',
    color: 'text-teal-600',
    items: [
      { key: 'calendar_create_event', label: 'ایجاد رویداد', desc: 'اجازه ایجاد رویداد در تقویم' },
      { key: 'calendar_edit_event', label: 'ویرایش رویداد', desc: 'اجازه ویرایش رویدادها' },
      { key: 'calendar_delete_event', label: 'حذف رویداد', desc: 'اجازه حذف رویدادها' },
      { key: 'calendar_hide_offhours', label: 'پنهان کردن ساعات غیرکاری', desc: 'امکان پنهان/نمایش ساعات خارج از وقت کاری در تقویم' },
    ],
  },
  {
    label: 'چت — امکانات پیشرفته',
    color: 'text-rose-600',
    items: [
      { key: 'chat_send_urgent', label: 'ارسال پیام اورژانسی', desc: 'اجازه ارسال پیام نوع اورژانسی' },
      { key: 'chat_send_confidential', label: 'ارسال پیام محرمانه', desc: 'اجازه ارسال پیام محرمانه' },
      { key: 'chat_delete_messages', label: 'حذف پیام‌ها', desc: 'اجازه حذف پیام برای همه' },
    ],
  },
  {
    label: 'کانال‌ها — عملیات',
    color: 'text-teal-600',
    items: [
      { key: 'channels_create', label: 'ایجاد کانال', desc: 'اجازه ایجاد کانال جدید' },
      { key: 'channels_create_group', label: 'ایجاد گروه', desc: 'اجازه ایجاد گروه جدید' },
      { key: 'channels_pin_messages', label: 'پین کردن پیام', desc: 'اجازه پین کردن پیام در کانال/گروه' },
      { key: 'channels_delete_messages', label: 'حذف پیام', desc: 'اجازه حذف پیام در کانال/گروه' },
      { key: 'channels_manage_members', label: 'مدیریت اعضا', desc: 'اجازه افزودن و حذف اعضای کانال/گروه' },
      { key: 'channels_send_urgent', label: 'ارسال پیام اورژانسی', desc: 'اجازه ارسال پیام اورژانسی در کانال' },
      { key: 'channels_send_confidential', label: 'ارسال پیام محرمانه', desc: 'اجازه ارسال پیام محرمانه در کانال' },
      { key: 'channels_group_tasks', label: 'ایجاد اقدام گروهی', desc: 'اجازه ایجاد اقدامات گروهی' },
    ],
  },
  {
    label: 'گزارشات — عملیات',
    color: 'text-gray-600',
    items: [
      { key: 'reports_export', label: 'خروجی گزارش', desc: 'اجازه دانلود و خروجی گرفتن' },
    ],
  },
  {
    label: 'پیکربندی سیستم — دسترسی',
    color: 'text-red-600',
    items: [
      { key: 'config_view', label: 'مشاهده پیکربندی', desc: 'مشاهده آیکون و ورود به پیکربندی' },
      { key: 'config_platform', label: 'تنظیمات پلتفرم', desc: 'تنظیمات کلی، ظاهر، منطقه‌ای' },
      { key: 'config_users', label: 'مدیریت کاربران', desc: 'فهرست کاربران، گروه‌ها، ساختار سازمانی' },
      { key: 'config_access', label: 'حقوق دسترسی', desc: 'تنظیمات امنیت و دسترسی سرور' },
      { key: 'config_audit', label: 'گزارش رخدادها', desc: 'مشاهده لاگ‌های سیستم' },
      { key: 'config_notifications', label: 'اعلان‌ها و پیامک', desc: 'تنظیم قالب اعلان، پیامک، بات' },
      { key: 'config_modules', label: 'مدیریت موجودیت‌ها', desc: 'ویدیو کنفرانس، تقویم، مانیتورینگ' },
      { key: 'config_spark', label: 'دستیار اسپارک', desc: 'پیکربندی هوش مصنوعی' },
      { key: 'config_backup', label: 'پشتیبان‌گیری', desc: 'دسترسی به خروجی پشتیبان دیتابیس' },
    ],
  },
];

export function AccessPanel({ group, onBack }: { group: UserGroup; onBack: () => void }) {
  const [perms, setPerms] = useState<Record<string, boolean>>(group.permissions || {});
  const [saving, setSaving] = useState(false);

  const toggle = (key: string) => setPerms(p => ({ ...p, [key]: !p[key] }));

  // When a module is enabled, also enable its sub-permissions automatically, and vice versa
  const toggleModule = (moduleKey: string) => {
    const newVal = !perms[moduleKey];
    const subGroup = PERMISSION_GROUPS.find(g => {
      const moduleMapping: Record<string, string> = {
        'جلسات — عملیات': 'meetings',
        'اقدامات — عملیات': 'tasks',
        'یادداشت‌ها — عملیات': 'notes',
        'مخاطبین — عملیات': 'contacts',
        'تقویم — عملیات': 'calendar',
        'چت — امکانات پیشرفته': 'chat',
        'گزارشات — عملیات': 'reports',
      };
      return moduleMapping[g.label] === moduleKey;
    });
    setPerms(p => {
      const updated = { ...p, [moduleKey]: newVal };
      // If disabling a module, disable its sub-perms too
      if (!newVal && subGroup) {
        subGroup.items.forEach(item => { updated[item.key] = false; });
      }
      return updated;
    });
  };

  const mainModuleKeys = new Set(PERMISSION_GROUPS[0].items.map(i => i.key));

  const save = async () => {
    setSaving(true);
    const { error } = await supabase.from('user_groups').update({ permissions: perms }).eq('id', group.id);
    if (error) { toast.error('خطا در ذخیره'); } else { toast.success('دسترسی‌ها ذخیره شد'); }
    setSaving(false);
  };

  return (
    <div className="space-y-4" dir="rtl">
      <BackHeader title="حقوق دسترسی گروه" icon={ShieldCheck} color="text-teal-500" onBack={onBack} />
      <GroupBadge group={group} />
      <div className="space-y-3">
        {PERMISSION_GROUPS.map(group => (
          <div key={group.label} className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
            <div className="px-5 py-2.5 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <ShieldCheck className={`w-4 h-4 ${group.color}`} />
              <span className={`text-xs font-semibold uppercase tracking-wider ${group.color}`}>{group.label}</span>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/50">
              {group.items.map(({ key, label, desc }) => (
                <div key={key} className="flex items-center justify-between px-5 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                  <div className="flex-1 min-w-0 mr-3">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  </div>
                  <button
                    onClick={() => mainModuleKeys.has(key) ? toggleModule(key) : toggle(key)}
                    className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${perms[key] ? 'bg-teal-500' : 'bg-gray-200 dark:bg-gray-600'}`}>
                    <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${perms[key] ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-900 pt-2 pb-4">
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-6 py-2.5 bg-teal-500 hover:bg-teal-600 disabled:opacity-60 text-white rounded-xl text-sm font-medium transition w-full justify-center sm:w-auto">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'در حال ذخیره...' : 'ذخیره دسترسی‌ها'}
        </button>
      </div>
    </div>
  );
}

export { PERMISSION_GROUPS };
