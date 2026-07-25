import React, { useState, useRef } from 'react';
import { Download, Upload, Database, Loader as Loader2, CircleCheck as CheckCircle, TriangleAlert as AlertTriangle, Shield, FileText, Calendar, ClipboardList, MessageSquare, BookOpen, FolderOpen, Table2, RefreshCw, ChevronDown, ChevronUp, Info, Video, Send, Link } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import * as XLSX from '../lib/xlsxCompat';

interface TableConfig {
  key: string;
  label: string;
  icon: React.ElementType;
  color: string;
  description: string;
}

const TABLES: TableConfig[] = [
  // ── Core content ────────────────────────────────────────────────────────────
  { key: 'meetings',                       label: 'جلسات',                          icon: Calendar,      color: 'text-teal-500',    description: 'تمام جلسات ثبت‌شده' },
  { key: 'shared_meetings',                label: 'جلسات مشترک',                   icon: Calendar,      color: 'text-teal-400',    description: 'جلسات به‌اشتراک گذاشته‌شده' },
  { key: 'meeting_inbox',                  label: 'صندوق ورودی جلسات',             icon: Calendar,      color: 'text-teal-300',    description: 'دعوت‌نامه‌های جلسات' },
  { key: 'participants',                   label: 'شرکت‌کنندگان',                  icon: ClipboardList, color: 'text-teal-400',    description: 'شرکت‌کنندگان جلسات' },
  { key: 'meeting_agenda_items',           label: 'دستور جلسات',                   icon: ClipboardList, color: 'text-teal-600',    description: 'آیتم‌های دستور جلسه' },
  { key: 'tasks',                          label: 'اقدامات',                        icon: ClipboardList, color: 'text-green-500',   description: 'اقدامات و وظایف' },
  { key: 'task_workflow_steps',            label: 'مراحل گردش‌کار',                icon: ClipboardList, color: 'text-green-400',   description: 'مراحل گردش‌کار وظایف' },
  { key: 'notes',                          label: 'یادداشت‌ها',                    icon: BookOpen,      color: 'text-amber-500',   description: 'یادداشت‌های کاربران' },
  { key: 'contacts_email',                 label: 'مخاطبین',                        icon: FolderOpen,    color: 'text-orange-500',  description: 'مخاطبین خارج از سازمان' },
  // ── Calendar ────────────────────────────────────────────────────────────────
  { key: 'calendars',                      label: 'تقویم‌ها',                      icon: Calendar,      color: 'text-cyan-500',    description: 'تقویم‌های شخصی کاربران' },
  { key: 'calendar_occasions',             label: 'مناسبت‌های تقویم',              icon: Calendar,      color: 'text-cyan-400',    description: 'مناسبت‌ها و رویدادهای تقویم' },
  { key: 'all_day_events',                 label: 'رویدادهای تمام‌روز',             icon: Calendar,      color: 'text-cyan-300',    description: 'رویدادهای تمام‌روز تقویم' },
  { key: 'calendar_subscriptions',         label: 'اشتراک‌های تقویم',              icon: Calendar,      color: 'text-cyan-600',    description: 'اشتراک‌های تقویم کاربران' },
  // ── Chat ────────────────────────────────────────────────────────────────────
  { key: 'chat_conversations',             label: 'مکالمات چت',                    icon: MessageSquare, color: 'text-rose-400',    description: 'لیست مکالمات چت سازمانی' },
  { key: 'chat_messages',                  label: 'پیام‌های چت',                   icon: MessageSquare, color: 'text-rose-500',    description: 'پیام‌های داخلی سازمان' },
  { key: 'chat_group_members',             label: 'اعضای گروه‌های چت',             icon: MessageSquare, color: 'text-rose-300',    description: 'عضویت در گروه‌های چت' },
  { key: 'chat_tags',                      label: 'برچسب‌های چت',                  icon: MessageSquare, color: 'text-rose-300',    description: 'برچسب‌های تعریف‌شده در چت' },
  { key: 'chat_message_reactions',         label: 'واکنش‌های پیام چت',             icon: MessageSquare, color: 'text-rose-200',    description: 'واکنش‌های emoji پیام‌های چت' },
  { key: 'chat_message_stars',             label: 'پیام‌های ستاره‌دار چت',         icon: MessageSquare, color: 'text-rose-200',    description: 'پیام‌های ستاره‌دار کاربران در چت' },
  { key: 'chat_reminders',                 label: 'یادآورهای چت',                  icon: MessageSquare, color: 'text-rose-200',    description: 'یادآورهای تنظیم‌شده در چت' },
  // ── Channels ────────────────────────────────────────────────────────────────
  { key: 'channels',                       label: 'کانال‌ها',                      icon: MessageSquare, color: 'text-indigo-500',  description: 'کانال‌های سازمانی' },
  { key: 'channel_members',               label: 'اعضای کانال‌ها',                icon: MessageSquare, color: 'text-indigo-400',  description: 'عضویت کاربران در کانال‌ها' },
  { key: 'channel_messages',              label: 'پیام‌های کانال',                icon: MessageSquare, color: 'text-indigo-600',  description: 'پیام‌های کانال‌های سازمانی' },
  { key: 'channel_work_topics',           label: 'موضوعات کاری',                  icon: MessageSquare, color: 'text-violet-500',  description: 'موضوعات کاری کانال‌ها' },
  { key: 'channel_broadcasts',            label: 'پیام‌های همگانی کانال',         icon: MessageSquare, color: 'text-indigo-300',  description: 'پیام‌های همگانی در کانال‌ها' },
  { key: 'channel_group_tasks',           label: 'وظایف گروهی کانال',             icon: ClipboardList, color: 'text-indigo-500',  description: 'وظایف گروهی در کانال‌ها' },
  { key: 'channel_group_task_assignments',label: 'انتساب وظایف کانال',            icon: ClipboardList, color: 'text-indigo-400',  description: 'انتساب وظایف گروهی به کاربران' },
  { key: 'channel_group_task_activities', label: 'فعالیت‌های وظایف کانال',        icon: ClipboardList, color: 'text-indigo-300',  description: 'تاریخچه فعالیت‌های وظایف کانال' },
  { key: 'channel_notification_rules',    label: 'قوانین اعلان کانال',            icon: FileText,      color: 'text-violet-400',  description: 'قوانین اعلان‌رسانی کانال‌ها' },
  { key: 'channel_sms_rules',             label: 'قوانین پیامک کانال',            icon: FileText,      color: 'text-violet-300',  description: 'قوانین ارسال پیامک کانال‌ها' },
  { key: 'channel_message_reactions',     label: 'واکنش‌های پیام کانال',          icon: MessageSquare, color: 'text-violet-400',  description: 'واکنش‌های emoji در کانال‌ها' },
  { key: 'channel_message_stars',         label: 'ستاره‌های کانال',               icon: MessageSquare, color: 'text-violet-300',  description: 'پیام‌های ستاره‌دار کانال‌ها' },
  { key: 'channel_message_private_pins',  label: 'پین‌های خصوصی کانال',           icon: MessageSquare, color: 'text-violet-200',  description: 'پین‌های خصوصی کاربران در کانال‌ها' },
  // ── Video Conference ─────────────────────────────────────────────────────────
  { key: 'conference_rooms',              label: 'اتاق‌های کنفرانس',              icon: Video,         color: 'text-sky-500',     description: 'اتاق‌های ویدئوکنفرانس' },
  { key: 'conference_participants',       label: 'شرکت‌کنندگان کنفرانس',          icon: Video,         color: 'text-sky-400',     description: 'شرکت‌کنندگان جلسات ویدئو' },
  { key: 'conference_messages',           label: 'پیام‌های کنفرانس',              icon: Video,         color: 'text-sky-300',     description: 'چت جلسات ویدئوکنفرانس' },
  { key: 'conference_polls',              label: 'نظرسنجی‌های کنفرانس',           icon: Video,         color: 'text-sky-600',     description: 'نظرسنجی‌های جلسات ویدئو' },
  { key: 'conference_poll_votes',         label: 'آرای نظرسنجی کنفرانس',          icon: Video,         color: 'text-sky-400',     description: 'آرای نظرسنجی ویدئوکنفرانس' },
  { key: 'conference_breakout_rooms',     label: 'اتاق‌های گروهی کنفرانس',        icon: Video,         color: 'text-sky-300',     description: 'اتاق‌های گروهی ویدئوکنفرانس' },
  { key: 'conference_reactions',          label: 'واکنش‌های کنفرانس',             icon: Video,         color: 'text-sky-200',     description: 'واکنش‌های emoji جلسات ویدئو' },
  { key: 'room_mod_actions',              label: 'اقدامات مدیریت کنفرانس',        icon: Video,         color: 'text-sky-600',     description: 'اقدامات ناظران در اتاق کنفرانس' },
  { key: 'pending_approvals',             label: 'درخواست‌های ورود کنفرانس',      icon: Video,         color: 'text-sky-500',     description: 'درخواست‌های تأیید ورود به اتاق' },
  { key: 'banned_users',                  label: 'کاربران مسدود کنفرانس',         icon: Video,         color: 'text-red-400',     description: 'کاربران مسدود در اتاق کنفرانس' },
  // ── Notifications ───────────────────────────────────────────────────────────
  { key: 'notifications',                 label: 'اعلان‌ها',                      icon: FileText,      color: 'text-gray-500',    description: 'تاریخچه اعلان‌ها' },
  { key: 'notification_templates',        label: 'قالب‌های اعلان',                icon: FileText,      color: 'text-blue-400',    description: 'قالب‌های متن اعلان' },
  { key: 'notification_group_rules',      label: 'قوانین اعلان گروهی',            icon: FileText,      color: 'text-blue-300',    description: 'قوانین اعلان‌رسانی گروه‌ها' },
  // ── Broadcasts ──────────────────────────────────────────────────────────────
  { key: 'broadcast_messages',            label: 'پیام‌های همگانی',               icon: Send,          color: 'text-teal-500',    description: 'پیام‌های همگانی ارسال‌شده' },
  { key: 'broadcast_recipients',          label: 'گیرندگان پیام همگانی',          icon: Send,          color: 'text-teal-400',    description: 'گیرندگان پیام‌های همگانی' },
  // ── User & Groups ───────────────────────────────────────────────────────────
  { key: 'user_preferences',              label: 'تنظیمات کاربران',               icon: Shield,        color: 'text-sky-500',     description: 'تنظیمات و ترجیحات کاربران' },
  { key: 'user_groups',                   label: 'گروه‌های کاربری',               icon: Shield,        color: 'text-red-500',     description: 'گروه‌ها و دسترسی‌ها' },
  { key: 'user_group_members',            label: 'اعضای گروه‌ها',                 icon: Shield,        color: 'text-red-400',     description: 'عضویت در گروه‌های کاربری' },
  { key: 'user_access_relations',         label: 'روابط دسترسی کاربران',          icon: Shield,        color: 'text-red-300',     description: 'روابط و دسترسی‌های بین کاربران' },
  { key: 'user_bale_mapping',             label: 'نگاشت کاربران بله',             icon: Shield,        color: 'text-red-200',     description: 'نگاشت کاربران به حساب پیام‌رسان بله' },
  // ── Org Structure ───────────────────────────────────────────────────────────
  { key: 'org_organizations',             label: 'سازمان‌ها',                     icon: Table2,        color: 'text-cyan-700',    description: 'تعریف سازمان‌ها' },
  { key: 'org_units',                     label: 'واحدهای سازمانی',               icon: Table2,        color: 'text-cyan-600',    description: 'ساختار واحدهای سازمان' },
  { key: 'org_positions',                 label: 'سمت‌های سازمانی',               icon: Table2,        color: 'text-cyan-700',    description: 'سمت‌ها در چارت سازمانی' },
  { key: 'org_position_members',          label: 'اعضای سمت‌ها',                  icon: Table2,        color: 'text-cyan-800',    description: 'انتساب کاربران به سمت‌های سازمانی' },
  { key: 'org_level_definitions',         label: 'سطوح سازمانی',                  icon: Table2,        color: 'text-cyan-400',    description: 'تعریف سطوح سازمانی' },
  { key: 'org_level_permissions',         label: 'مجوزهای سطوح سازمانی',          icon: Table2,        color: 'text-cyan-300',    description: 'مجوزهای سطوح سازمانی' },
  { key: 'org_position_permissions',      label: 'مجوزهای سمت‌ها',                icon: Table2,        color: 'text-cyan-500',    description: 'مجوزهای اختصاصی سمت‌های سازمانی' },
  // ── Config & Logs ───────────────────────────────────────────────────────────
  { key: 'system_config',                 label: 'تنظیمات سیستم',                 icon: Database,      color: 'text-blue-400',    description: 'پیکربندی و تنظیمات' },
  { key: 'spark_config',                  label: 'پیکربندی اسپارک',               icon: Database,      color: 'text-purple-500',  description: 'تنظیمات ماژول‌های اسپارک' },
  { key: 'spark_ai_settings',             label: 'تنظیمات هوش مصنوعی اسپارک',     icon: Database,      color: 'text-purple-400',  description: 'پیکربندی مدل AI اسپارک' },
  { key: 'spark_field_keywords',          label: 'نگاشت فیلدهای اسپارک',          icon: Database,      color: 'text-purple-300',  description: 'کلیدواژه‌ها و نگاشت فیلدهای اسپارک' },
  { key: 'spark_memory',                  label: 'حافظه اسپارک',                  icon: Database,      color: 'text-purple-200',  description: 'حافظه کاربری دستیار اسپارک' },
  { key: 'social_channel_configs',        label: 'تنظیمات شبکه اجتماعی',         icon: Shield,        color: 'text-teal-600',    description: 'پیکربندی بات‌های پیام‌رسان' },
  { key: 'sms_providers',                 label: 'تنظیمات پیامک',                 icon: FileText,      color: 'text-green-600',   description: 'پیکربندی ارائه‌دهنده SMS' },
  { key: 'sms_templates',                 label: 'قالب‌های پیامک',                icon: FileText,      color: 'text-green-500',   description: 'قالب‌های متن پیامک' },
  { key: 'sms_group_rules',               label: 'قوانین گروهی پیامک',            icon: FileText,      color: 'text-green-400',   description: 'قوانین ارسال پیامک به گروه‌ها' },
  { key: 'sms_dispatch_logs',             label: 'لاگ ارسال پیامک',               icon: FileText,      color: 'text-green-300',   description: 'تاریخچه پیامک‌های ارسال‌شده' },
  { key: 'daily_report_config',           label: 'پیکربندی گزارش روزانه',         icon: FileText,      color: 'text-lime-600',    description: 'تنظیمات ارسال گزارش روزانه' },
  { key: 'rahyab_settings',               label: 'تنظیمات رهیاب',                 icon: FileText,      color: 'text-emerald-600', description: 'پیکربندی سرویس پیامک رهیاب' },
  { key: 'bale_link_tokens',              label: 'توکن‌های لینک بله',             icon: Link,          color: 'text-blue-300',    description: 'توکن‌های لینک‌دهی پیام‌رسان بله' },
  { key: 'telegram_link_tokens',          label: 'توکن‌های لینک تلگرام',          icon: Link,          color: 'text-sky-300',     description: 'توکن‌های لینک‌دهی پیام‌رسان تلگرام' },
  { key: 'hr_sso_config',                 label: 'پیکربندی SSO',                  icon: Shield,        color: 'text-slate-400',   description: 'پیکربندی ورود یکپارچه SSO' },
  { key: 'rahyab_inbox',                  label: 'صندوق ورودی رهیاب',             icon: MessageSquare, color: 'text-emerald-400', description: 'پیام‌های دریافتی سرویس رهیاب' },
  { key: 'spark_assistant_logs',          label: 'لاگ دستیار اسپارک',             icon: Database,      color: 'text-purple-300',  description: 'تاریخچه دستورات دستیار اسپارک' },
  { key: 'audit_log',                     label: 'لاگ رخدادها',                   icon: Shield,        color: 'text-slate-500',   description: 'تاریخچه تمام رخدادها' },
  // ── Chat read/tag logs ──────────────────────────────────────────────────────
  { key: 'chat_message_read_log',         label: 'لاگ خواندن پیام چت',            icon: MessageSquare, color: 'text-rose-100',    description: 'وضعیت خواندن پیام‌های چت' },
  { key: 'chat_message_read_receipts',    label: 'رسیدهای خواندن چت',             icon: MessageSquare, color: 'text-rose-100',    description: 'آخرین رسید خواندن مکالمات چت' },
  { key: 'chat_message_tag_assignments',  label: 'برچسب‌های پیام چت',             icon: MessageSquare, color: 'text-rose-200',    description: 'انتساب برچسب به پیام‌های چت' },
  // ── Channel read log ────────────────────────────────────────────────────────
  { key: 'channel_message_read_log',      label: 'لاگ خواندن پیام کانال',         icon: MessageSquare, color: 'text-indigo-200',  description: 'وضعیت خواندن پیام‌های کانال' },
  // ── Call history ────────────────────────────────────────────────────────────
  { key: 'call_sessions',                 label: 'تاریخچه تماس‌ها',               icon: Video,         color: 'text-sky-400',     description: 'تاریخچه تماس‌های صوتی و تصویری' },
  // ── Video Conference (additional) ──────────────────────────────────────────
  { key: 'conference_whiteboard',         label: 'تخته سفید کنفرانس',             icon: Video,         color: 'text-sky-200',     description: 'داده‌های تخته سفید جلسات ویدئو' },
  { key: 'conference_waiting_room',       label: 'اتاق انتظار کنفرانس',           icon: Video,         color: 'text-sky-100',     description: 'درخواست‌های اتاق انتظار ویدئوکنفرانس' },
  { key: 'conference_quality_metrics',    label: 'متریک‌های کیفیت کنفرانس',       icon: Video,         color: 'text-sky-100',     description: 'معیارهای کیفیت شبکه در جلسات ویدئو' },
];

const TABLE_LABEL: Record<string, string> = Object.fromEntries(TABLES.map(t => [t.key, t.label]));
const TABLE_ICON: Record<string, React.ElementType> = Object.fromEntries(TABLES.map(t => [t.key, t.icon]));
const TABLE_COLOR: Record<string, string> = Object.fromEntries(TABLES.map(t => [t.key, t.color]));

const BACKUP_VERSION = '2.0';
const PAGE_SIZE = 1000;

/** Fetch all rows for a table using range-based pagination to avoid the 50K limit. */
async function fetchAllRows(tableKey: string): Promise<any[]> {
  const all: any[] = [];
  let page = 0;
  while (true) {
    const { data, error } = await (supabase as any)
      .from(tableKey)
      .select('*')
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }
  return all;
}

function TableRow({ cfg, selected, onToggle, status }: {
  cfg: TableConfig;
  selected: boolean;
  onToggle: () => void;
  status: 'idle' | 'loading' | 'done' | 'error';
}) {
  const Icon = cfg.icon;
  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${selected ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600'}`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${selected ? 'bg-blue-100 dark:bg-blue-900/40' : 'bg-gray-100 dark:bg-gray-700'}`}>
        <Icon className={`w-4 h-4 ${selected ? 'text-blue-500' : cfg.color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${selected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-white'}`}>{cfg.label}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{cfg.description}</p>
      </div>
      <div className="flex-shrink-0">
        {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-blue-400" />}
        {status === 'done' && <CheckCircle className="w-4 h-4 text-green-500" />}
        {status === 'error' && <AlertTriangle className="w-4 h-4 text-red-400" />}
        {status === 'idle' && (
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'border-blue-500 bg-blue-500' : 'border-gray-300 dark:border-gray-600'}`}>
            {selected && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
        )}
      </div>
    </div>
  );
}

function RestoreTableRow({ tableKey, rowCount, selected, onToggle, status }: {
  tableKey: string;
  rowCount: number;
  selected: boolean;
  onToggle: () => void;
  status: 'idle' | 'loading' | 'done' | 'error';
}) {
  const Icon = TABLE_ICON[tableKey] ?? Database;
  const color = TABLE_COLOR[tableKey] ?? 'text-gray-400';
  const label = TABLE_LABEL[tableKey] ?? tableKey;

  return (
    <div
      onClick={onToggle}
      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-all border ${selected ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700 hover:border-gray-200 dark:hover:border-gray-600'}`}
    >
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${selected ? 'bg-emerald-100 dark:bg-emerald-900/40' : 'bg-gray-100 dark:bg-gray-700'}`}>
        <Icon className={`w-4 h-4 ${selected ? 'text-emerald-600' : color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${selected ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-800 dark:text-white'}`}>{label}</p>
        <p className="text-xs text-gray-400 dark:text-gray-500">{rowCount.toLocaleString('fa-IR')} ردیف</p>
      </div>
      <div className="flex-shrink-0">
        {status === 'loading' && <Loader2 className="w-4 h-4 animate-spin text-emerald-500" />}
        {status === 'done' && <CheckCircle className="w-4 h-4 text-green-500" />}
        {status === 'error' && <AlertTriangle className="w-4 h-4 text-red-400" />}
        {status === 'idle' && (
          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${selected ? 'border-emerald-500 bg-emerald-500' : 'border-gray-300 dark:border-gray-600'}`}>
            {selected && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Restore panel ────────────────────────────────────────────────────────────
function RestorePanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [parsedData, setParsedData] = useState<Record<string, any[]> | null>(null);
  const [backupMeta, setBackupMeta] = useState<Record<string, any> | null>(null);
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState('');
  const [parsing, setParsing] = useState(false);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [strategy, setStrategy] = useState<'upsert' | 'replace'>('upsert');
  const [running, setRunning] = useState(false);
  const [tableStatus, setTableStatus] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [restoreReport, setRestoreReport] = useState<Record<string, any> | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [expandedReportTable, setExpandedReportTable] = useState<string | null>(null);

  const toggleTable = (key: string) => setSelectedTables(s => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const selectAll = () => { if (parsedData) setSelectedTables(new Set(Object.keys(parsedData))); };
  const selectNone = () => setSelectedTables(new Set());

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setParseError('');
    setParsedData(null);
    setBackupMeta(null);
    setSelectedTables(new Set());
    setTableStatus({});
    setConfirmed(false);
    setParsing(true);

    try {
      if (file.name.endsWith('.json')) {
        const text = await file.text();
        const obj = JSON.parse(text);
        if (typeof obj !== 'object' || Array.isArray(obj)) throw new Error('فرمت JSON نامعتبر است');
        // Strip metadata and profiles keys
        const { _meta, profiles: _p, ...rest } = obj as any;
        if (_meta) setBackupMeta(_meta);
        for (const [k, v] of Object.entries(rest)) {
          if (!Array.isArray(v)) throw new Error(`جدول "${k}" آرایه نیست`);
        }
        setParsedData(rest as Record<string, any[]>);
        setSelectedTables(new Set(Object.keys(rest)));
      } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
        const buf = await file.arrayBuffer();
        const wb = await XLSX.read(buf, { type: 'array' });
        const result: Record<string, any[]> = {};
        const labelToKey = Object.fromEntries(TABLES.map(t => [t.label.slice(0, 31), t.key]));
        for (const sheetName of wb.SheetNames) {
          const tableKey = labelToKey[sheetName] ?? sheetName;
          if (tableKey === 'profiles' || tableKey === '_meta') continue;
          const ws = wb.Sheets[sheetName];
          result[tableKey] = XLSX.utils.sheet_to_json(ws);
        }
        setParsedData(result);
        setSelectedTables(new Set(Object.keys(result)));
      } else {
        throw new Error('فقط فایل‌های JSON و XLSX پشتیبانی می‌شوند');
      }
    } catch (err: any) {
      setParseError(err.message || 'خطا در خواندن فایل');
    } finally {
      setParsing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const runRestore = async () => {
    if (!parsedData || selectedTables.size === 0) return;
    setRunning(true);

    const init: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
    for (const k of selectedTables) init[k] = 'loading';
    setTableStatus(init);

    const tables: Record<string, any[]> = {};
    for (const k of selectedTables) tables[k] = parsedData[k] ?? [];

    try {
      const { data, error } = await supabase.functions.invoke('restore-backup', {
        body: { tables, strategy },
      });

      if (error) throw error;

      const results = (data as any)?.results ?? {};
      const newStatus: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
      for (const k of selectedTables) {
        const r = results[k];
        if (!r) { newStatus[k] = 'error'; continue; }
        newStatus[k] = r.success ? 'done' : 'error';
        if (!r.success && r.errors?.length) {
          toast.error(`خطا در بازیابی ${TABLE_LABEL[k] ?? k}: ${r.errors[0]}`);
        }
      }
      setTableStatus(newStatus);
      setRestoreReport(results);

      const doneCount = Object.values(newStatus).filter(s => s === 'done').length;
      const totalInserted = Object.values(results).reduce((s: number, r: any) => s + (r?.inserted ?? 0), 0);
      const totalUpdated = Object.values(results).reduce((s: number, r: any) => s + (r?.updated ?? 0), 0);
      const totalFailed = Object.values(results).reduce((s: number, r: any) => s + (r?.failed ?? 0), 0);
      if (doneCount > 0) {
        const parts = [`بازیابی ${doneCount} جدول`];
        if (totalInserted > 0) parts.push(`${totalInserted.toLocaleString('fa-IR')} ردیف جدید`);
        if (totalUpdated > 0) parts.push(`${totalUpdated.toLocaleString('fa-IR')} به‌روزرسانی`);
        if (totalFailed > 0) parts.push(`${totalFailed.toLocaleString('fa-IR')} ناموفق`);
        toast[totalFailed > 0 ? 'error' : 'success'](parts.join(' — '));
      }
    } catch (err: any) {
      toast.error(`خطا در بازیابی: ${err.message}`);
      const errStatus: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
      for (const k of selectedTables) errStatus[k] = 'error';
      setTableStatus(errStatus);
    }

    setRunning(false);
    setConfirmed(false);
  };

  const doneCount = Object.values(tableStatus).filter(s => s === 'done').length;
  const totalSelected = selectedTables.size;

  return (
    <div className="space-y-4">
      <div
        onClick={() => fileRef.current?.click()}
        className="flex flex-col items-center justify-center gap-3 p-6 border-2 border-dashed border-gray-200 dark:border-gray-600 rounded-2xl cursor-pointer hover:border-emerald-400 dark:hover:border-emerald-500 transition-colors bg-gray-50 dark:bg-gray-800/50 group"
      >
        <div className="w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center group-hover:scale-105 transition-transform">
          <Upload className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />
        </div>
        {parsing ? (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> در حال خواندن فایل...
          </div>
        ) : fileName && parsedData ? (
          <div className="text-center">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">{fileName}</p>
            <p className="text-xs text-gray-400 mt-0.5">{Object.keys(parsedData).length} جدول شناسایی شد</p>
            {backupMeta && (
              <p className="text-xs text-gray-400 mt-0.5">
                نسخه {backupMeta.version} — {new Date(backupMeta.created_at).toLocaleString('fa-IR')}
              </p>
            )}
          </div>
        ) : (
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300">فایل پشتیبان را انتخاب کنید</p>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">JSON یا Excel (.xlsx)</p>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".json,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
      </div>

      {parseError && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
          <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-xs text-red-700 dark:text-red-300">{parseError}</p>
        </div>
      )}

      {parsedData && (
        <>
          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">روش بازیابی</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setStrategy('upsert')}
                className={`p-3 rounded-xl border transition-all text-right ${strategy === 'upsert' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-300 dark:border-emerald-600' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}
              >
                <p className={`text-sm font-semibold ${strategy === 'upsert' ? 'text-emerald-700 dark:text-emerald-300' : 'text-gray-700 dark:text-gray-300'}`}>ادغام (Upsert)</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed">ردیف‌های موجود به‌روز و ردیف‌های جدید اضافه می‌شوند. داده‌های فعلی حذف نمی‌شوند.</p>
              </button>
              <button
                onClick={() => setStrategy('replace')}
                className={`p-3 rounded-xl border transition-all text-right ${strategy === 'replace' ? 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-600' : 'bg-gray-50 dark:bg-gray-700 border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}
              >
                <p className={`text-sm font-semibold ${strategy === 'replace' ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>جایگزینی کامل</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 leading-relaxed">تمام داده‌های فعلی حذف و از فایل پشتیبان بازنویسی می‌شوند.</p>
              </button>
            </div>
          </div>

          <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                جداول ({selectedTables.size} از {Object.keys(parsedData).length} انتخاب‌شده)
              </p>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs px-3 py-1 bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400 rounded-lg hover:bg-emerald-100 transition-colors">همه</button>
                <button onClick={selectNone} className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">هیچ‌کدام</button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-72 overflow-y-auto">
              {Object.entries(parsedData).map(([key, rows]) => (
                <RestoreTableRow
                  key={key}
                  tableKey={key}
                  rowCount={rows.length}
                  selected={selectedTables.has(key)}
                  onToggle={() => toggleTable(key)}
                  status={tableStatus[key] || 'idle'}
                />
              ))}
            </div>
          </div>

          {running && totalSelected > 0 && (
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl border border-emerald-100 dark:border-emerald-800 p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">در حال بازیابی...</span>
                <span className="text-sm text-emerald-600 dark:text-emerald-400">{doneCount} / {totalSelected}</span>
              </div>
              <div className="w-full bg-emerald-100 dark:bg-emerald-900/50 rounded-full h-2">
                <div
                  className="bg-emerald-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${totalSelected > 0 ? (doneCount / totalSelected) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}

          {restoreReport && !running && (
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 space-y-1">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold text-gray-700 dark:text-gray-300">گزارش بازیابی</p>
                <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />وارد شد</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />به‌روز شد</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" />رد شد</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />ناموفق</span>
                </div>
              </div>
              {Object.entries(restoreReport).map(([key, r]: [string, any]) => (
                <div key={key} className="rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
                  <button
                    className="w-full flex items-center justify-between gap-2 px-3 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-right"
                    onClick={() => setExpandedReportTable(expandedReportTable === key ? null : key)}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{TABLE_LABEL[key] ?? key}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">کل: {(r.total ?? 0).toLocaleString('fa-IR')}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0 text-xs">
                      {(r.inserted ?? 0) > 0 && <span className="font-medium text-green-600 dark:text-green-400">+{(r.inserted).toLocaleString('fa-IR')}</span>}
                      {(r.updated ?? 0) > 0 && <span className="font-medium text-blue-600 dark:text-blue-400">↑{(r.updated).toLocaleString('fa-IR')}</span>}
                      {(r.skipped ?? 0) > 0 && <span className="font-medium text-amber-600 dark:text-amber-400">○{(r.skipped).toLocaleString('fa-IR')}</span>}
                      {(r.failed ?? 0) > 0 && <span className="font-medium text-red-600 dark:text-red-400">✗{(r.failed).toLocaleString('fa-IR')}</span>}
                      {r.errors?.length > 0
                        ? expandedReportTable === key
                          ? <ChevronUp className="w-3 h-3 text-gray-400" />
                          : <ChevronDown className="w-3 h-3 text-gray-400" />
                        : null}
                    </div>
                  </button>
                  {expandedReportTable === key && r.errors?.length > 0 && (
                    <div className="border-t border-gray-100 dark:border-gray-700 max-h-52 overflow-y-auto">
                      {r.errors.slice(0, 100).map((e: any, ei: number) => (
                        <div key={ei} className="flex items-start gap-2 px-3 py-2 border-b border-gray-50 dark:border-gray-700/50 last:border-0 bg-gray-50/50 dark:bg-gray-800/50">
                          <span className="flex-shrink-0 w-6 h-6 rounded-lg bg-gray-200 dark:bg-gray-700 flex items-center justify-center text-xs font-medium text-gray-500 dark:text-gray-400">
                            {e.row || '—'}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs text-red-600 dark:text-red-400 leading-relaxed">{e.reason || '(علت نامشخص)'}</p>
                            {e.dependency && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5 font-mono truncate">{e.dependency}</p>}
                            {e.id && <p className="text-xs text-gray-300 dark:text-gray-600 font-mono truncate">{e.id}</p>}
                          </div>
                          {e.code && <span className="flex-shrink-0 text-xs text-gray-300 dark:text-gray-600 font-mono">{e.code}</span>}
                        </div>
                      ))}
                      {r.errors.length > 100 && (
                        <p className="px-3 py-2 text-center text-xs text-gray-400 dark:text-gray-500">
                          ... و {(r.errors.length - 100).toLocaleString('fa-IR')} مورد دیگر
                        </p>
                      )}
                    </div>
                  )}
                  {r.deleteError && (
                    <p className="px-3 py-2 text-xs text-red-500 dark:text-red-400 border-t border-gray-100 dark:border-gray-700">
                      حذف ناموفق: {r.deleteError}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {strategy === 'replace' && (
            <div className="flex items-start gap-2 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl">
              <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed font-medium mb-2">
                  حالت جایگزینی: تمام داده‌های فعلی جداول انتخاب‌شده حذف خواهند شد. این عملیات برگشت‌پذیر نیست.
                </p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} className="w-4 h-4 accent-red-500" />
                  <span className="text-xs text-red-700 dark:text-red-300 font-medium">تأیید می‌کنم که داده‌های فعلی حذف شوند</span>
                </label>
              </div>
            </div>
          )}

          <button
            onClick={runRestore}
            disabled={running || selectedTables.size === 0 || (strategy === 'replace' && !confirmed)}
            className="w-full flex items-center justify-center gap-2 py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-60 text-white rounded-2xl font-medium transition-colors shadow-sm"
          >
            {running
              ? <><Loader2 className="w-4 h-4 animate-spin" /> در حال بازیابی...</>
              : <><RefreshCw className="w-4 h-4" /> بازیابی ({selectedTables.size} جدول)</>
            }
          </button>
        </>
      )}
    </div>
  );
}

// ── Main BackupPanel ─────────────────────────────────────────────────────────
export function BackupPanel() {
  const [selected, setSelected] = useState<Set<string>>(new Set(TABLES.map(t => t.key)));
  const [format, setFormat] = useState<'json' | 'xlsx'>('json');
  const [running, setRunning] = useState(false);
  const [tableStatus, setTableStatus] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [showRestore, setShowRestore] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const toggle = (key: string) => setSelected(s => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });

  const selectAll = () => setSelected(new Set(TABLES.map(t => t.key)));
  const selectNone = () => setSelected(new Set());

  const runBackup = async () => {
    if (selected.size === 0) { toast.error('حداقل یک جدول انتخاب کنید'); return; }
    setRunning(true);
    setProgress({ done: 0, total: selected.size });

    const init: Record<string, 'idle' | 'loading' | 'done' | 'error'> = {};
    TABLES.forEach(t => { init[t.key] = selected.has(t.key) ? 'loading' : 'idle'; });
    setTableStatus(init);

    const result: Record<string, any[]> = {};
    let doneCount = 0;

    for (const cfg of TABLES) {
      if (!selected.has(cfg.key)) continue;
      try {
        const rows = await fetchAllRows(cfg.key);
        result[cfg.key] = rows;
        setTableStatus(s => ({ ...s, [cfg.key]: 'done' }));
      } catch {
        result[cfg.key] = [];
        setTableStatus(s => ({ ...s, [cfg.key]: 'error' }));
        toast.error(`خطا در خواندن ${cfg.label}`);
      }
      doneCount++;
      setProgress({ done: doneCount, total: selected.size });
    }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const rowCounts = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.length]));
    const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);

    if (format === 'json') {
      const payload = {
        _meta: {
          version: BACKUP_VERSION,
          created_at: new Date().toISOString(),
          table_count: Object.keys(result).length,
          total_rows: totalRows,
          row_counts: rowCounts,
        },
        ...result,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `backup_${ts}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const wb = XLSX.utils.book_new();
      for (const cfg of TABLES) {
        if (!selected.has(cfg.key) || !result[cfg.key]?.length) continue;
        const ws = XLSX.utils.json_to_sheet(result[cfg.key]);
        XLSX.utils.book_append_sheet(wb, ws, cfg.label.slice(0, 31));
      }
      await XLSX.writeFile(wb, `backup_${ts}.xlsx`);
    }

    const nonEmpty = Object.values(result).filter(r => r.length > 0).length;
    toast.success(`پشتیبان‌گیری از ${nonEmpty} جدول — ${totalRows.toLocaleString('fa-IR')} ردیف`);
    setRunning(false);
  };

  return (
    <div className="space-y-5" dir="rtl">

      {/* ── Export / Backup section ─────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
          <Database className="w-5 h-5 text-blue-500" />
        </div>
        <div>
          <h3 className="font-bold text-gray-800 dark:text-white">پشتیبان‌گیری از دیتابیس</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            خروجی کامل از {TABLES.length} جدول به فرمت JSON یا Excel
          </p>
        </div>
      </div>

      {/* Format selector */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">فرمت خروجی</p>
        <div className="flex gap-3 mb-3">
          {(['json', 'xlsx'] as const).map(f => (
            <button key={f} onClick={() => setFormat(f)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${format === f ? 'bg-blue-500 text-white border-blue-500' : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-gray-300'}`}>
              {f === 'json' ? 'JSON (پیشنهادی برای مهاجرت)' : 'Excel (.xlsx)'}
            </button>
          ))}
        </div>
        <div className="flex items-start gap-2 px-3 py-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
          <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
            {format === 'json'
              ? 'JSON تمام انواع داده (JSONB، آرایه، null) را بدون محدودیت تعداد ردیف حفظ می‌کند و برای مهاجرت به دیتابیس جدید توصیه می‌شود.'
              : 'Excel برای مشاهده و ویرایش دستی مناسب است اما ممکن است انواع داده پیچیده (JSONB) را دقیق نگه ندارد.'
            }
          </p>
        </div>
      </div>

      {/* Table selection */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4">
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            جداول ({selected.size} از {TABLES.length} انتخاب‌شده)
          </p>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs px-3 py-1 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors">همه</button>
            <button onClick={selectNone} className="text-xs px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">هیچ‌کدام</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
          {TABLES.map(cfg => (
            <TableRow
              key={cfg.key}
              cfg={cfg}
              selected={selected.has(cfg.key)}
              onToggle={() => toggle(cfg.key)}
              status={tableStatus[cfg.key] || 'idle'}
            />
          ))}
        </div>
      </div>

      {/* Progress */}
      {running && progress.total > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-2xl border border-blue-100 dark:border-blue-800 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-blue-700 dark:text-blue-300">در حال پشتیبان‌گیری...</span>
            <span className="text-sm text-blue-600 dark:text-blue-400">{progress.done} / {progress.total}</span>
          </div>
          <div className="w-full bg-blue-100 dark:bg-blue-900/50 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300"
              style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Warning */}
      <div className="flex items-start gap-2 px-4 py-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
          فایل پشتیبان حاوی داده‌های واقعی سازمان است. در مکان امن ذخیره کنید و به اشخاص غیرمجاز دسترسی ندهید.
        </p>
      </div>

      {/* Export button */}
      <button
        onClick={runBackup}
        disabled={running || selected.size === 0}
        className="w-full flex items-center justify-center gap-2 py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-60 text-white rounded-2xl font-medium transition-colors shadow-sm"
      >
        {running
          ? <><Loader2 className="w-4 h-4 animate-spin" /> در حال پشتیبان‌گیری...</>
          : <><Download className="w-4 h-4" /> دریافت پشتیبان ({selected.size} جدول)</>
        }
      </button>

      {/* ── Restore / Import section ────────────────────────────────────── */}
      <div className="border-t border-gray-100 dark:border-gray-700 pt-5">
        <button
          onClick={() => setShowRestore(v => !v)}
          className="w-full flex items-center gap-3 text-right"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center flex-shrink-0">
            <Upload className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-bold text-gray-800 dark:text-white">بازیابی / وارد کردن پشتیبان</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
              بارگذاری فایل پشتیبان و اعمال مجدد داده‌ها
            </p>
          </div>
          {showRestore
            ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
            : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
          }
        </button>

        {showRestore && (
          <div className="mt-4">
            <RestorePanel />
          </div>
        )}
      </div>
    </div>
  );
}
