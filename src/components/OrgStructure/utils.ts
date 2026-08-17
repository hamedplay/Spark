import type { LevelDef } from './types';
import { PERMISSION_REGISTRY, type PermissionItem } from '../../features/permissions/permissionRegistry';

const MINUTES_REGISTRY_GROUP = PERMISSION_REGISTRY.find(g => g.moduleKey === 'minutes_view');
const MINUTES_PERMISSION_ITEMS: PermissionItem[] = MINUTES_REGISTRY_GROUP?.items ?? [];

export const DEFAULT_LEVELS: LevelDef[] = [
  { level: 1, label: 'مدیرعامل', color: '#ef4444', icon: '👑', sort_order: 1 },
  { level: 2, label: 'معاون', color: '#f97316', icon: '⭐', sort_order: 2 },
  { level: 3, label: 'مدیر', color: '#3b82f6', icon: '💼', sort_order: 3 },
  { level: 4, label: 'رئیس اداره', color: '#8b5cf6', icon: '🏛️', sort_order: 4 },
  { level: 5, label: 'معاون اداره', color: '#06b6d4', icon: '📋', sort_order: 5 },
  { level: 6, label: 'کارشناس ارشد', color: '#10b981', icon: '🔧', sort_order: 6 },
  { level: 7, label: 'کارشناس', color: '#14b8a6', icon: '📊', sort_order: 7 },
  { level: 8, label: 'کارمند', color: '#6b7280', icon: '👤', sort_order: 8 },
];

export function getLevelInfo(level: number, levels: LevelDef[]): LevelDef {
  return levels.find(l => l.level === level) || DEFAULT_LEVELS.find(l => l.level === level) || DEFAULT_LEVELS[DEFAULT_LEVELS.length - 1];
}

export const ALL_PERMISSION_GROUPS = [
  { group: 'دسترسی ویژه مدیریت', color: '#7c3aed', keys: [
    { key: 'management_dashboard', label: 'داشبورد مدیریتی' },
  ]},
  { group: 'جلسات', color: '#3b82f6', keys: [
    { key: 'meetings',           label: 'مشاهده جلسات' },
    { key: 'meetings_create',    label: 'ایجاد جلسه' },
    { key: 'meetings_edit',      label: 'ویرایش جلسه' },
    { key: 'meetings_delete',    label: 'حذف جلسه' },
    { key: 'meetings_export',    label: 'خروجی جلسات (اکسل)' },
    { key: 'meetings_delegate',  label: 'واگذاری جلسه به دیگران' },
  ]},
  { group: 'تقویم', color: '#8b5cf6', keys: [
    { key: 'calendar',                  label: 'مشاهده تقویم' },
    { key: 'calendar_create_event',     label: 'ایجاد رویداد' },
    { key: 'calendar_create_occasion',  label: 'مدیریت مناسبت‌ها' },
    { key: 'calendar_subscribe',        label: 'دنبال‌کردن تقویم دیگران' },
  ]},
  { group: 'چت سازمانی', color: '#06b6d4', keys: [
    { key: 'chat',                    label: 'چت سازمانی' },
    { key: 'chat_send_urgent',        label: 'ارسال پیام فوری' },
    { key: 'chat_send_confidential',  label: 'ارسال پیام محرمانه' },
    { key: 'chat_forward_message',    label: 'ارسال پیام به دیگران' },
    { key: 'chat_delete_message',     label: 'حذف پیام چت' },
  ]},
  { group: 'کانال‌ها و گروه‌ها', color: '#10b981', keys: [
    { key: 'channels',                label: 'مشاهده کانال‌ها و گروه‌ها' },
    { key: 'channels_create_channel', label: 'ساخت کانال جدید' },
    { key: 'channels_create_group',   label: 'ساخت گروه جدید' },
    { key: 'channels_manage_members', label: 'مدیریت اعضای کانال/گروه' },
    { key: 'channels_delete',         label: 'حذف کانال/گروه' },
  ]},
  { group: 'ویدیو کنفرانس', color: '#f59e0b', keys: [
    { key: 'video_conference',        label: 'کنفرانس ویدیویی' },
    { key: 'video_create_room',       label: 'ایجاد اتاق کنفرانس' },
  ]},
  { group: 'اقدامات', color: '#ef4444', keys: [
    { key: 'tasks',         label: 'مشاهده اقدامات' },
    { key: 'tasks_create',  label: 'ایجاد اقدام' },
    { key: 'tasks_edit',    label: 'ویرایش اقدام' },
    { key: 'tasks_delete',  label: 'حذف اقدام' },
    { key: 'tasks_assign',  label: 'انتساب اقدام به دیگران' },
  ]},
  { group: 'یادداشت‌ها', color: '#f97316', keys: [
    { key: 'notes',         label: 'مشاهده یادداشت‌ها' },
    { key: 'notes_create',  label: 'ایجاد یادداشت' },
    { key: 'notes_edit',    label: 'ویرایش یادداشت' },
    { key: 'notes_delete',  label: 'حذف یادداشت' },
  ]},
  { group: 'مخاطبین', color: '#6366f1', keys: [
    { key: 'contacts',          label: 'مشاهده مخاطبین' },
    { key: 'contacts_create',   label: 'افزودن مخاطب' },
    { key: 'contacts_edit',     label: 'ویرایش مخاطب' },
    { key: 'contacts_delete',   label: 'حذف مخاطب' },
    { key: 'contacts_email',    label: 'مخاطبین ایمیل' },
    { key: 'contacts_share',    label: 'اشتراک‌گذاری مخاطب' },
  ]},
  { group: 'گزارش‌ها', color: '#84cc16', keys: [
    { key: 'reports',           label: 'مشاهده گزارشات' },
    { key: 'reports_export',    label: 'خروجی گزارش (اکسل)' },
    { key: 'reports_view_all',  label: 'مشاهده گزارش همه کاربران' },
  ]},
  { group: 'دستیار هوش مصنوعی', color: '#ec4899', keys: [
    { key: 'spark',             label: 'دستیار اسپارک' },
    { key: 'spark_meeting_req', label: 'درخواست جلسه از طریق اسپارک' },
  ]},
  { group: 'صورت‌جلسات و مصوبات', color: '#0d9488', keys: MINUTES_PERMISSION_ITEMS.map(item => ({ key: item.key, label: item.label })) },
  { group: 'مدیریت سازمانی', color: '#64748b', keys: [
    { key: 'admin_panel',           label: 'پنل مدیریت' },
    { key: 'org_manage_structure',  label: 'مدیریت ساختار سازمانی' },
    { key: 'org_manage_permissions','label': 'مدیریت دسترسی‌های سازمانی' },
    { key: 'user_management',       label: 'مدیریت کاربران' },
    { key: 'system_config',         label: 'تنظیمات سیستم' },
    { key: 'notification_config',   label: 'تنظیمات اعلان‌ها' },
    { key: 'sms_config',            label: 'تنظیمات پیامک' },
    { key: 'backup_access',         label: 'پشتیبان‌گیری' },
    { key: 'audit_log',             label: 'گزارش تاریخچه عملیات' },
  ]},
];