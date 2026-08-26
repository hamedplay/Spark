import type React from 'react';
import { Calendar, ClipboardList, BookOpen, FolderOpen, MessageSquare, FileText, Database, Shield, Table2, Video, Send, Link } from 'lucide-react';

export interface TableConfig {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
}

export const TABLES: TableConfig[] = [
  { key: 'meetings', label: 'جلسات', icon: Calendar, color: 'text-teal-500', description: 'تمام جلسات ثبت‌شده' },
  { key: 'shared_meetings', label: 'جلسات مشترک', icon: Calendar, color: 'text-teal-400', description: 'جلسات به‌اشتراک گذاشته‌شده' },
  { key: 'meeting_inbox', label: 'صندوق ورودی جلسات', icon: Calendar, color: 'text-teal-300', description: 'دعوت‌نامه‌های جلسات' },
  { key: 'participants', label: 'شرکت‌کنندگان', icon: ClipboardList, color: 'text-teal-400', description: 'شرکت‌کنندگان جلسات' },
  { key: 'meeting_agenda_items', label: 'دستور جلسات', icon: ClipboardList, color: 'text-teal-600', description: 'آیتم‌های دستور جلسه' },
  { key: 'tasks', label: 'اقدامات', icon: ClipboardList, color: 'text-green-500', description: 'اقدامات و وظایف' },
  { key: 'task_workflow_steps', label: 'مراحل گردش‌کار', icon: ClipboardList, color: 'text-green-400', description: 'مراحل گردش‌کار وظایف' },
  { key: 'notes', label: 'یادداشت‌ها', icon: BookOpen, color: 'text-amber-500', description: 'یادداشت‌های کاربران' },
  { key: 'contacts_email', label: 'مخاطبین', icon: FolderOpen, color: 'text-orange-500', description: 'مخاطبین خارج از سازمان' },

  { key: 'minutes', label: 'صورتجلسات', icon: FileText, color: 'text-emerald-600', description: 'رکورد اصلی صورتجلسات' },
  { key: 'minutes_participants', label: 'شرکت‌کنندگان صورتجلسه', icon: FileText, color: 'text-emerald-500', description: 'شرکت‌کنندگان داخلی صورتجلسات' },
  { key: 'minutes_external_participants', label: 'مهمانان صورتجلسه', icon: FileText, color: 'text-emerald-400', description: 'شرکت‌کنندگان خارج از سازمان' },
  { key: 'minutes_agenda_results', label: 'نتایج دستور صورتجلسه', icon: FileText, color: 'text-emerald-500', description: 'نتیجه مباحث دستور جلسه' },
  { key: 'minutes_decisions', label: 'مصوبات صورتجلسه', icon: ClipboardList, color: 'text-emerald-600', description: 'مصوبات و مسئولیت‌های صورتجلسه' },
  { key: 'minutes_approvals', label: 'تأییدهای صورتجلسه', icon: Shield, color: 'text-emerald-500', description: 'گردش تأیید و امضای صورتجلسه' },
  { key: 'minutes_approval_comments', label: 'نظرات تأیید صورتجلسه', icon: MessageSquare, color: 'text-emerald-400', description: 'نظرات و درخواست‌های اصلاح' },
  { key: 'minutes_decision_updates', label: 'پیگیری مصوبات', icon: ClipboardList, color: 'text-emerald-500', description: 'تاریخچه پیگیری و پیشرفت مصوبات' },
  { key: 'minutes_decision_reminders', label: 'یادآور مصوبات', icon: FileText, color: 'text-emerald-400', description: 'یادآورهای پیگیری مصوبات' },
  { key: 'minutes_attachments', label: 'فراداده پیوست‌های صورتجلسه', icon: FolderOpen, color: 'text-emerald-400', description: 'فراداده فایل‌ها؛ فایل‌های Storage باید جداگانه پشتیبان‌گیری شوند' },
  { key: 'minutes_audit_log', label: 'لاگ صورتجلسات', icon: Shield, color: 'text-emerald-300', description: 'تاریخچه رخدادهای صورتجلسات' },

  { key: 'calendars', label: 'تقویم‌ها', icon: Calendar, color: 'text-cyan-500', description: 'تقویم‌های شخصی کاربران' },
  { key: 'calendar_occasions', label: 'مناسبت‌های تقویم', icon: Calendar, color: 'text-cyan-400', description: 'مناسبت‌ها و رویدادهای تقویم' },
  { key: 'all_day_events', label: 'رویدادهای تمام‌روز', icon: Calendar, color: 'text-cyan-300', description: 'رویدادهای تمام‌روز تقویم' },
  { key: 'calendar_subscriptions', label: 'اشتراک‌های تقویم', icon: Calendar, color: 'text-cyan-600', description: 'اشتراک‌های تقویم کاربران' },

  { key: 'chat_conversations', label: 'مکالمات چت', icon: MessageSquare, color: 'text-rose-400', description: 'لیست مکالمات چت سازمانی' },
  { key: 'chat_messages', label: 'پیام‌های چت', icon: MessageSquare, color: 'text-rose-500', description: 'پیام‌های داخلی سازمان' },
  { key: 'chat_group_members', label: 'اعضای گروه‌های چت', icon: MessageSquare, color: 'text-rose-300', description: 'عضویت در گروه‌های چت' },
  { key: 'chat_tags', label: 'برچسب‌های چت', icon: MessageSquare, color: 'text-rose-300', description: 'برچسب‌های تعریف‌شده در چت' },
  { key: 'chat_message_reactions', label: 'واکنش‌های پیام چت', icon: MessageSquare, color: 'text-rose-200', description: 'واکنش‌های پیام‌های چت' },
  { key: 'chat_message_stars', label: 'پیام‌های ستاره‌دار چت', icon: MessageSquare, color: 'text-rose-200', description: 'پیام‌های ستاره‌دار کاربران' },
  { key: 'chat_reminders', label: 'یادآورهای چت', icon: MessageSquare, color: 'text-rose-200', description: 'یادآورهای تنظیم‌شده در چت' },
  { key: 'chat_message_read_log', label: 'لاگ خواندن پیام چت', icon: MessageSquare, color: 'text-rose-100', description: 'وضعیت خواندن پیام‌های چت' },
  { key: 'chat_message_read_receipts', label: 'رسیدهای خواندن چت', icon: MessageSquare, color: 'text-rose-100', description: 'آخرین رسید خواندن مکالمات چت' },
  { key: 'chat_message_tag_assignments', label: 'برچسب‌های پیام چت', icon: MessageSquare, color: 'text-rose-200', description: 'انتساب برچسب به پیام‌های چت' },

  { key: 'channels', label: 'کانال‌ها', icon: MessageSquare, color: 'text-indigo-500', description: 'کانال‌های سازمانی' },
  { key: 'channel_members', label: 'اعضای کانال‌ها', icon: MessageSquare, color: 'text-indigo-400', description: 'عضویت کاربران در کانال‌ها' },
  { key: 'channel_messages', label: 'پیام‌های کانال', icon: MessageSquare, color: 'text-indigo-600', description: 'پیام‌های کانال‌های سازمانی' },
  { key: 'channel_work_topics', label: 'موضوعات کاری', icon: MessageSquare, color: 'text-violet-500', description: 'موضوعات کاری کانال‌ها' },
  { key: 'channel_broadcasts', label: 'پیام‌های همگانی کانال', icon: MessageSquare, color: 'text-indigo-300', description: 'پیام‌های همگانی کانال' },
  { key: 'channel_group_tasks', label: 'وظایف گروهی کانال', icon: ClipboardList, color: 'text-indigo-500', description: 'وظایف گروهی کانال‌ها' },
  { key: 'channel_group_task_assignments', label: 'انتساب وظایف کانال', icon: ClipboardList, color: 'text-indigo-400', description: 'انتساب وظایف گروهی' },
  { key: 'channel_group_task_activities', label: 'فعالیت وظایف کانال', icon: ClipboardList, color: 'text-indigo-300', description: 'تاریخچه فعالیت وظایف کانال' },
  { key: 'channel_notification_rules', label: 'قوانین اعلان کانال', icon: FileText, color: 'text-violet-400', description: 'قوانین اعلان کانال‌ها' },
  { key: 'channel_sms_rules', label: 'قوانین پیامک کانال', icon: FileText, color: 'text-violet-300', description: 'قوانین پیامک کانال‌ها' },
  { key: 'channel_message_reactions', label: 'واکنش‌های کانال', icon: MessageSquare, color: 'text-violet-400', description: 'واکنش‌های پیام کانال' },
  { key: 'channel_message_stars', label: 'ستاره‌های کانال', icon: MessageSquare, color: 'text-violet-300', description: 'پیام‌های ستاره‌دار کانال' },
  { key: 'channel_message_private_pins', label: 'پین‌های خصوصی کانال', icon: MessageSquare, color: 'text-violet-200', description: 'پین‌های خصوصی کاربران' },
  { key: 'channel_message_read_log', label: 'لاگ خواندن پیام کانال', icon: MessageSquare, color: 'text-indigo-200', description: 'وضعیت خواندن پیام‌های کانال' },

  { key: 'call_sessions', label: 'تاریخچه تماس‌ها', icon: Video, color: 'text-sky-400', description: 'تاریخچه تماس‌های صوتی و تصویری' },
  { key: 'conference_rooms', label: 'اتاق‌های کنفرانس', icon: Video, color: 'text-sky-500', description: 'اتاق‌های ویدئوکنفرانس' },
  { key: 'conference_participants', label: 'شرکت‌کنندگان کنفرانس', icon: Video, color: 'text-sky-400', description: 'شرکت‌کنندگان ویدئوکنفرانس' },
  { key: 'conference_messages', label: 'پیام‌های کنفرانس', icon: Video, color: 'text-sky-300', description: 'چت ویدئوکنفرانس' },
  { key: 'conference_polls', label: 'نظرسنجی‌های کنفرانس', icon: Video, color: 'text-sky-600', description: 'نظرسنجی‌های کنفرانس' },
  { key: 'conference_poll_votes', label: 'آرای نظرسنجی کنفرانس', icon: Video, color: 'text-sky-400', description: 'آرای نظرسنجی' },
  { key: 'conference_breakout_rooms', label: 'اتاق‌های گروهی کنفرانس', icon: Video, color: 'text-sky-300', description: 'اتاق‌های گروهی' },
  { key: 'conference_reactions', label: 'واکنش‌های کنفرانس', icon: Video, color: 'text-sky-200', description: 'واکنش‌های کنفرانس' },
  { key: 'room_mod_actions', label: 'اقدامات مدیریت کنفرانس', icon: Video, color: 'text-sky-600', description: 'اقدامات ناظران' },
  { key: 'pending_approvals', label: 'درخواست‌های ورود کنفرانس', icon: Video, color: 'text-sky-500', description: 'درخواست‌های تأیید ورود' },
  { key: 'banned_users', label: 'کاربران مسدود کنفرانس', icon: Video, color: 'text-red-400', description: 'کاربران مسدود اتاق' },
  { key: 'conference_whiteboard', label: 'تخته سفید کنفرانس', icon: Video, color: 'text-sky-200', description: 'داده‌های تخته سفید' },
  { key: 'conference_waiting_room', label: 'اتاق انتظار کنفرانس', icon: Video, color: 'text-sky-100', description: 'درخواست‌های اتاق انتظار' },
  { key: 'conference_quality_metrics', label: 'متریک‌های کیفیت کنفرانس', icon: Video, color: 'text-sky-100', description: 'معیارهای کیفیت شبکه' },

  { key: 'notifications', label: 'اعلان‌ها', icon: FileText, color: 'text-gray-500', description: 'تاریخچه اعلان‌ها' },
  { key: 'notification_event_registry', label: 'رجیستری رخدادهای اعلان', icon: FileText, color: 'text-blue-500', description: 'تعریف رخدادها و قابلیت‌های اعلان' },
  { key: 'notification_templates', label: 'قالب‌های اعلان', icon: FileText, color: 'text-blue-400', description: 'قالب‌های متن اعلان' },
  { key: 'notification_group_rules', label: 'قوانین اعلان گروهی', icon: FileText, color: 'text-blue-300', description: 'قوانین اعلان‌رسانی گروه‌ها' },
  { key: 'broadcast_messages', label: 'پیام‌های همگانی', icon: Send, color: 'text-teal-500', description: 'پیام‌های همگانی ارسال‌شده' },
  { key: 'broadcast_recipients', label: 'گیرندگان پیام همگانی', icon: Send, color: 'text-teal-400', description: 'گیرندگان پیام‌های همگانی' },

  { key: 'user_preferences', label: 'تنظیمات کاربران', icon: Shield, color: 'text-sky-500', description: 'تنظیمات و ترجیحات کاربران' },
  { key: 'user_groups', label: 'گروه‌های کاربری', icon: Shield, color: 'text-red-500', description: 'گروه‌ها و دسترسی‌ها' },
  { key: 'user_group_members', label: 'اعضای گروه‌ها', icon: Shield, color: 'text-red-400', description: 'عضویت در گروه‌های کاربری' },
  { key: 'user_access_relations', label: 'روابط دسترسی کاربران', icon: Shield, color: 'text-red-300', description: 'روابط دسترسی بین کاربران' },
  { key: 'user_bale_mapping', label: 'نگاشت کاربران بله', icon: Shield, color: 'text-red-200', description: 'نگاشت کاربران به بله' },

  { key: 'org_organizations', label: 'سازمان‌ها', icon: Table2, color: 'text-cyan-700', description: 'تعریف سازمان‌ها' },
  { key: 'org_units', label: 'واحدهای سازمانی', icon: Table2, color: 'text-cyan-600', description: 'ساختار واحدهای سازمان' },
  { key: 'org_positions', label: 'سمت‌های سازمانی', icon: Table2, color: 'text-cyan-700', description: 'سمت‌ها در چارت سازمانی' },
  { key: 'org_position_members', label: 'اعضای سمت‌ها', icon: Table2, color: 'text-cyan-800', description: 'انتساب کاربران به سمت‌ها' },
  { key: 'org_level_definitions', label: 'سطوح سازمانی', icon: Table2, color: 'text-cyan-400', description: 'تعریف سطوح سازمانی' },
  { key: 'org_level_permissions', label: 'مجوزهای سطوح سازمانی', icon: Table2, color: 'text-cyan-300', description: 'مجوزهای سطوح سازمانی' },
  { key: 'org_position_permissions', label: 'مجوزهای سمت‌ها', icon: Table2, color: 'text-cyan-500', description: 'مجوزهای اختصاصی سمت‌ها' },

  { key: 'system_config', label: 'تنظیمات سیستم', icon: Database, color: 'text-blue-400', description: 'پیکربندی و تنظیمات سامانه' },
  { key: 'spark_config', label: 'پیکربندی اسپارک', icon: Database, color: 'text-purple-500', description: 'تنظیمات ماژول‌های اسپارک' },
  { key: 'spark_ai_settings', label: 'تنظیمات هوش مصنوعی اسپارک', icon: Database, color: 'text-purple-400', description: 'پیکربندی مدل AI' },
  { key: 'spark_field_keywords', label: 'نگاشت فیلدهای اسپارک', icon: Database, color: 'text-purple-300', description: 'کلیدواژه‌ها و نگاشت فیلدها' },
  { key: 'spark_memory', label: 'حافظه اسپارک', icon: Database, color: 'text-purple-200', description: 'حافظه کاربری دستیار' },
  { key: 'spark_assistant_logs', label: 'لاگ دستیار اسپارک', icon: Database, color: 'text-purple-300', description: 'تاریخچه دستورات دستیار' },
  { key: 'social_channel_configs', label: 'تنظیمات شبکه اجتماعی', icon: Shield, color: 'text-teal-600', description: 'پیکربندی بات‌های پیام‌رسان' },
  { key: 'sms_providers', label: 'تنظیمات پیامک', icon: FileText, color: 'text-green-600', description: 'پیکربندی ارائه‌دهنده SMS' },
  { key: 'sms_templates', label: 'قالب‌های پیامک', icon: FileText, color: 'text-green-500', description: 'قالب‌های متن پیامک' },
  { key: 'sms_group_rules', label: 'قوانین گروهی پیامک', icon: FileText, color: 'text-green-400', description: 'قوانین ارسال پیامک به گروه‌ها' },
  { key: 'sms_dispatch_logs', label: 'لاگ ارسال پیامک', icon: FileText, color: 'text-green-300', description: 'تاریخچه پیامک‌های ارسال‌شده' },
  { key: 'daily_report_config', label: 'پیکربندی گزارش روزانه', icon: FileText, color: 'text-lime-600', description: 'تنظیمات گزارش روزانه' },
  { key: 'rahyab_settings', label: 'تنظیمات رهیاب', icon: FileText, color: 'text-emerald-600', description: 'پیکربندی سرویس رهیاب' },
  { key: 'rahyab_inbox', label: 'صندوق ورودی رهیاب', icon: MessageSquare, color: 'text-emerald-400', description: 'پیام‌های دریافتی رهیاب' },
  { key: 'bale_link_tokens', label: 'توکن‌های لینک بله', icon: Link, color: 'text-blue-300', description: 'توکن‌های لینک‌دهی بله' },
  { key: 'telegram_link_tokens', label: 'توکن‌های لینک تلگرام', icon: Link, color: 'text-sky-300', description: 'توکن‌های لینک‌دهی تلگرام' },
  { key: 'hr_sso_config', label: 'پیکربندی SSO', icon: Shield, color: 'text-slate-400', description: 'پیکربندی ورود یکپارچه' },
  { key: 'audit_log', label: 'لاگ رخدادها', icon: Shield, color: 'text-slate-500', description: 'تاریخچه رخدادهای عمومی' },
];

export const TABLE_LABEL: Record<string, string> = Object.fromEntries(TABLES.map(t => [t.key, t.label]));
export const TABLE_ICON: Record<string, React.ElementType> = Object.fromEntries(TABLES.map(t => [t.key, t.icon]));
export const TABLE_COLOR: Record<string, string> = Object.fromEntries(TABLES.map(t => [t.key, t.color]));

export const BACKUP_VERSION = '3.0';
export const PAGE_SIZE = 1000;
