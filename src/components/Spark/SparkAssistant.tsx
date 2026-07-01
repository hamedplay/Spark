import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, Mic, Send, Bot, Loader as Loader2, CircleCheck as CheckCircle2, CircleAlert as AlertCircle, Sparkles, Volume2, VolumeX, Square, RefreshCw, Zap, Brain, Check, X as XIcon } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import { useDraggableFab, panelStyle } from '../../lib/useDraggableFab';
import { jalaliToGregorianIso, jalaliDayRange } from '../../lib/sparkDateUtils';

// ─── Public types ─────────────────────────────────────────────────────────────
export interface SparkLog {
  id: string;
  command_text: string;
  command_type: string;
  status: 'pending' | 'done' | 'failed';
  result_summary: string | null;
  payload: Record<string, any> | null;
  error_message: string | null;
  created_at: string;
}

export interface SparkMeetingPrefill {
  subject?: string;
  location?: string;
  representative?: string;
  phone?: string;
  notes?: string;
  priority?: string;
  startTime?: string;
  endTime?: string;
  dateJy?: number;
  dateJm?: number;
  dateJd?: number;
  participantNames?: string[];
}

export interface SparkCalendarMeetingPrefill {
  subject?: string;
  location?: string;
  representative?: string;
  phone?: string;
  notes?: string;
  priority?: string;
  startTime?: string;
  endTime?: string;
  dateJy?: number;
  dateJm?: number;
  dateJd?: number;
  participantNames?: string[];
}

export interface SparkAssistantProps {
  currentUserId: string;
  onNavigate: (page: string) => void;
  onSetCalendarView?: (view: string) => void;
  onNewLogEntry?: (log: SparkLog) => void;
  onOpenMeetingForm?: (prefill: SparkMeetingPrefill) => void;
  onOpenCalendarMeetingForm?: (prefill: SparkCalendarMeetingPrefill) => void;
  onNavigateToDate?: (jy: number, jm: number, jd: number, view?: string) => void;
  externalCommand?: string | null;
  onExternalCommandConsumed?: () => void;
}

// ─── Internal types ───────────────────────────────────────────────────────────
interface ParsedCommand {
  type: string;
  confidence: number;
  response?: string;
  autoExecute?: boolean;
  requiresConfirmation: boolean;  // REQUIRED - همیشه مقدار دارد
  // navigation
  page?: string;
  // calendar
  calendarView?: string;
  calendarDate?: string;
  // meeting
  subject?: string;
  representative?: string;
  phone?: string;
  location?: string;
  priority?: 'high' | 'medium' | 'low';
  date?: string;
  startTime?: string;
  endTime?: string;
  participantNames?: string[];
  // reschedule / cancel
  meetingSubjectQuery?: string;
  timeDeltaMinutes?: number;
  // chat
  targetUser?: string;
  messageBody?: string;
  messageImportance?: 'normal' | 'important' | 'urgent';
  // task
  taskTitle?: string;
  taskAssigneeName?: string;
  taskDueDate?: string;
  // note
  noteTitle?: string;
  noteContent?: string;
  // contact
  contactName?: string;
  contactPhone?: string;
  contactOrg?: string;
  contactEmail?: string;
  // query
  queryFilter?: string;
  queryDate?: string;
  // explain / clarification
  topic?: string;
  explanation?: string;
  question?: string;
  answer?: string;
}

interface Message {
  id: string;
  role: 'spark' | 'user';
  text: string;
  status?: 'pending' | 'done' | 'failed' | 'executing' | 'waiting_confirm';
  pendingCommand?: ParsedCommand | null;
}

interface SparkMemory { key: string; value: string; }

// ─── تعیین اینکه آیا دستور نیاز به تأیید دارد ─────────────────────────────────
function requiresConfirmationByType(type: string): boolean {
  // دستورات نوشتنی (نیاز به تأیید)
  const writeCommands = [
    'meeting_request',      // ایجاد جلسه جدید
    'reschedule_meeting',   // تغییر زمان جلسه
    'cancel_meeting',       // لغو جلسه
    'chat_send_message',    // ارسال پیام
    'create_task',          // ایجاد اقدام جدید
    'create_note',          // ایجاد یادداشت جدید
    'add_contact',          // افزودن مخاطب جدید
    'calendar_meeting_form', // ایجاد جلسه در تقویم
  ];
  
  // دستورات خواندنی (نیاز به تأیید ندارند)
  const readCommands = [
    'navigate',             // رفتن به صفحه
    'calendar_view',        // تغییر نمای تقویم
    'calendar_list_today',  // نمایش جلسات امروز
    'calendar_list_date',   // نمایش جلسات یک تاریخ خاص
    'query_meetings_count', // تعداد جلسات
    'query_tasks_count',    // تعداد اقدامات
    'query_notes_count',    // تعداد یادداشت‌ها
    'query_contacts_count', // تعداد مخاطبین
    'explain',              // توضیحات
    'calendar_navigate_date', // رفتن به تاریخ خاص در تقویم
    'conversational',       // پاسخ مکالمه‌ای / سوال عمومی
  ];
  
  if (writeCommands.includes(type)) return true;
  if (readCommands.includes(type)) return false;
  
  // پیش‌فرض: اگر نوع ناشناس است، برای امنیت نیاز به تأیید دارد
  return true;
}

// ─── نمایش خلاصه دستور برای تأیید ─────────────────────────────────────────────
function formatCommandSummary(cmd: ParsedCommand): string {
  switch (cmd.type) {
    case 'meeting_request':
      return `✅ **ثبت جلسه جدید**\n\n📌 موضوع: ${cmd.subject || 'نامشخص'}\n👤 نماینده: ${cmd.representative || 'نامشخص'}\n📞 تلفن: ${cmd.phone || 'نامشخص'}\n📍 مکان: ${cmd.location || 'نامشخص'}\n📅 تاریخ: ${cmd.date || 'نامشخص'}\n⏰ ساعت: ${cmd.startTime || 'نامشخص'}\n⚡ اولویت: ${cmd.priority === 'high' ? 'بالا' : cmd.priority === 'low' ? 'پایین' : 'متوسط'}`;
    
    case 'reschedule_meeting': {
      const delta = cmd.timeDeltaMinutes || 0;
      const dir = delta > 0 ? `${delta} دقیقه جلو` : `${Math.abs(delta)} دقیقه عقب`;
      return `⏰ **تغییر زمان جلسه**\n\n🔍 جستجو: "${cmd.meetingSubjectQuery || 'نامشخص'}"\n🕐 جابجایی: ${dir}`;
    }
    
    case 'cancel_meeting':
      return `❌ **لغو جلسه**\n\n🔍 جستجو: "${cmd.meetingSubjectQuery || 'نامشخص'}"\n\n⚠️ این عملیات غیرقابل بازگشت است!`;
    
    case 'chat_send_message':
      return `💬 **ارسال پیام**\n\n👤 به: ${cmd.targetUser || 'نامشخص'}\n📝 متن: ${cmd.messageBody?.substring(0, 100)}${(cmd.messageBody?.length || 0) > 100 ? '...' : ''}\n${cmd.messageImportance === 'urgent' ? '⚠️ اولویت: اورژانسی' : cmd.messageImportance === 'important' ? '❗ اولویت: مهم' : ''}`;
    
    case 'create_task':
      return `📋 **ایجاد اقدام جدید**\n\n📌 عنوان: ${cmd.taskTitle || 'نامشخص'}\n👤 مسئول: ${cmd.taskAssigneeName || 'من'}\n📅 مهلت: ${cmd.taskDueDate || 'نامشخص'}\n⚡ اولویت: ${cmd.priority === 'high' ? 'بالا' : cmd.priority === 'low' ? 'پایین' : 'متوسط'}`;
    
    case 'create_note':
      return `📝 **ایجاد یادداشت جدید**\n\n📌 عنوان: ${cmd.noteTitle || 'نامشخص'}`;
    
    case 'add_contact':
      return `👤 **افزودن مخاطب جدید**\n\n📛 نام: ${cmd.contactName || 'نامشخص'}\n📞 شماره: ${cmd.contactPhone || 'نامشخص'}\n🏢 سازمان: ${cmd.contactOrg || 'نامشخص'}\n📧 ایمیل: ${cmd.contactEmail || 'نامشخص'}`;
    
    case 'navigate':
      const pageNames: Record<string, string> = {
        calendar: 'تقویم', chat: 'چت', tasks: 'اقدامات', notes: 'یادداشت‌ها',
        contacts: 'مخاطبین', reports: 'گزارش‌ها', meetings: 'جلسات',
        'video-conference': 'ویدیو کنفرانس', profile: 'پروفایل'
      };
      return `🧭 **رفتن به صفحه**\n\n📱 صفحه: ${pageNames[cmd.page || ''] || cmd.page}`;
    
    case 'calendar_view':
      const views: Record<string, string> = { 
        day: 'روزانه', week: 'هفتگی', month: 'ماهانه', 
        'list-week': 'لیست هفتگی', 'list-month': 'لیست ماهانه' 
      };
      return `📅 **تغییر نمای تقویم**\n\nنمایش: ${views[cmd.calendarView || 'week']}`;
    
    default:
      return `⚡ **${cmd.type}**\n\n${cmd.response || 'اجرا می‌شود'}`;
  }
}

// ─── NLP helpers ──────────────────────────────────────────────────────────────
function p2e(s: string): string {
  return s.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
}

function extractPhone(text: string): string {
  const t = p2e(text);
  const m = t.match(/0[0-9]{10}/);
  return m ? m[0] : '';
}

function extractJalaliDate(text: string): string {
  const t = p2e(text);
  if (/فردا/.test(text)) return moment().add(1, 'day').format('jYYYY/jMM/jDD');
  if (/پس‌فردا|پس فردا/.test(text)) return moment().add(2, 'day').format('jYYYY/jMM/jDD');
  if (/امروز/.test(text)) return moment().format('jYYYY/jMM/jDD');
  const m = t.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (m) return `${m[1]}/${m[2].padStart(2, '0')}/${m[3].padStart(2, '0')}`;
  const days: Record<string, number> = { شنبه: 6, یکشنبه: 0, دوشنبه: 1, 'سه‌شنبه': 2, 'سه شنبه': 2, چهارشنبه: 3, 'پنج‌شنبه': 4, 'پنج شنبه': 4, جمعه: 5 };
  for (const [name, day] of Object.entries(days)) {
    if (text.includes(name)) {
      const today = moment().day();
      const diff = (day - today + 7) % 7 || 7;
      return moment().add(diff, 'day').format('jYYYY/jMM/jDD');
    }
  }
  return moment().format('jYYYY/jMM/jDD');
}

function extractTime(text: string): string {
  const t = p2e(text);
  const m1 = t.match(/ساعت\s*(\d{1,2})(?:[.:](\d{2}))?/);
  if (m1) return `${m1[1].padStart(2, '0')}:${m1[2] || '00'}`;
  const m2 = t.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m2) return `${m2[1].padStart(2, '0')}:${m2[2]}`;
  return '';
}

function addMins(time: string, mins: number): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + mins;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function extractPriority(text: string): 'high' | 'medium' | 'low' {
  if (/اورژانس|فوری|خیلی مهم/.test(text)) return 'high';
  if (/مهم/.test(text)) return 'high';
  if (/پایین|کم اهمیت/.test(text)) return 'low';
  return 'medium';
}

function extractImportance(text: string): 'normal' | 'important' | 'urgent' {
  if (/اورژانس|فوری/.test(text)) return 'urgent';
  if (/مهم/.test(text)) return 'important';
  return 'normal';
}

function extractNameAfter(text: string, kws: string[]): string {
  for (const kw of kws) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${esc}\\s+([\\u0600-\\u06FF]{2,}(?:\\s+[\\u0600-\\u06FF]{2,})?)`, 'i');
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return '';
}

function extractAfterKw(text: string, kws: string[], stopKws: string[] = []): string {
  const stopPat = stopKws.length
    ? `(?=\\s+(?:${stopKws.map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})|[،,]|$)`
    : `(?=[،,]|$)`;
  for (const kw of kws) {
    const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${esc}\\s+([\\u0600-\\u06FF\\w][\\u0600-\\u06FF\\w\\s\\-]*?)${stopPat}`, 'i');
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return '';
}

// ─── Fallback local NLP (با requiresConfirmation اجباری) ─────────────────────
function parseLocal(text: string): ParsedCommand {
  const lo = text.toLowerCase();

  // ========== دستورات خواندنی (بدون نیاز به تأیید) ==========
  
  if (/چند تا جلسه|تعداد جلسات|چقدر جلسه|چند جلسه/.test(lo)) {
    return { type: 'query_meetings_count', queryFilter: 'all', confidence: 0.9, autoExecute: true, requiresConfirmation: false, response: 'در حال بررسی...' };
  }
  
  if (/جلسات امروز|برنامه امروز|جلسه امروز|امروز چه جلسه/.test(lo)) {
    return { type: 'calendar_list_today', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'جلسات امروز را بررسی می‌کنم.' };
  }
  
  if (/آموزش|چطور|چه جوری|چه طور|یاد بده|توضیح بده|راهنما/.test(lo)) {
    return { type: 'explain', topic: text, explanation: 'برای این کار می‌توانید از منوی اصلی وارد بخش مربوطه شوید.', confidence: 0.8, autoExecute: true, requiresConfirmation: false, response: 'توضیح می‌دهم.' };
  }

  // Calendar view
  if (/لیست\s*ماه|ماهانه\s*لیست/.test(lo)) {
    return { type: 'calendar_view', calendarView: 'list-month', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'لیست ماهانه.' };
  }
  if (/لیست\s*هفت|هفتگی\s*لیست/.test(lo)) {
    return { type: 'calendar_view', calendarView: 'list-week', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'لیست هفتگی.' };
  }
  if (/ماهانه|جدول\s*ماه|تقویم\s*ماه/.test(lo)) {
    return { type: 'calendar_view', calendarView: 'month', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'تقویم ماهانه.' };
  }
  if (/روزانه|نمای\s*روز/.test(lo)) {
    return { type: 'calendar_view', calendarView: 'day', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'تقویم روزانه.' };
  }
  if (/هفتگی|نمای\s*هفت/.test(lo)) {
    return { type: 'calendar_view', calendarView: 'week', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'تقویم هفتگی.' };
  }

  // Navigation (بدون تأیید)
  const navTargets: [RegExp, string][] = [
    [/تقویم|calendar/, 'calendar'], [/چت|گفتگو|پیام‌ها|chat/, 'chat'],
    [/اقدام|وظیفه|تسک|task/, 'tasks'], [/یادداشت|note/, 'notes'],
    [/مخاطب|contact/, 'contacts'], [/گزارش|report/, 'reports'],
    [/جلسه|میتینگ/, 'meetings'], [/ویدیو|کنفرانس/, 'video-conference'],
    [/پروفایل/, 'profile'],
  ];
  if (/برو|برو به|باز کن|صفحه|بزن|نشون|ببر/.test(lo)) {
    for (const [re, page] of navTargets) {
      if (re.test(lo)) {
        return { type: 'navigate', page, confidence: 0.9, autoExecute: true, requiresConfirmation: false, response: `رفتم.` };
      }
    }
  }

  // تماس (بدون تأیید - فقط ناوبری)
  if (/تماس تصویری|ویدیو کال|ویدیوکال/.test(lo)) {
    const targetUser = extractNameAfter(text, ['با', 'به', 'برای']);
    localStorage.setItem('spark_call_intent', JSON.stringify({ userName: targetUser, callType: 'video' }));
    return { type: 'navigate', page: 'chat', confidence: 0.9, autoExecute: true, requiresConfirmation: false, response: 'رفتم به چت.' };
  }
  if (/تماس صوتی|تماس بگیر|زنگ بزن/.test(lo) && !/جلسه/.test(lo)) {
    const targetUser = extractNameAfter(text, ['با', 'به', 'برای']);
    localStorage.setItem('spark_call_intent', JSON.stringify({ userName: targetUser, callType: 'audio' }));
    return { type: 'navigate', page: 'chat', confidence: 0.9, autoExecute: true, requiresConfirmation: false, response: 'رفتم به چت.' };
  }

  // ========== دستورات نوشتنی (نیاز به تأیید دارند) ==========
  
  // لغو جلسه
  if (/لغو|کنسل/.test(lo) && /جلسه|میتینگ/.test(lo)) {
    const subjectM = text.match(/جلسه\s+([\u0600-\u06FF\w][^\u0600-\u06FF\w\s]*(?:\s+[\u0600-\u06FF\w][^\u0600-\u06FF\w\s]*)*?)\s*(?:را|رو)\s*(?:لغو|کنسل)/);
    const subject = subjectM?.[1]?.trim() || extractAfterKw(text, ['جلسه', 'میتینگ'], ['را', 'رو', 'لغو', 'کنسل']);
    return { type: 'cancel_meeting', meetingSubjectQuery: subject, confidence: 0.9, autoExecute: false, requiresConfirmation: true, response: 'آیا برای لغو این جلسه اطمینان دارید؟' };
  }

  // تغییر زمان جلسه
  if (/(\d+)\s*(دقیقه|دق)\s*(جلو|عقب|بعد|قبل)/.test(lo) && /جلسه/.test(lo)) {
    const deltaM = lo.match(/(\d+)\s*(دقیقه|دق)\s*(جلو|عقب|بعد|قبل)/);
    const delta = deltaM ? parseInt(deltaM[1]) * (deltaM[3] === 'جلو' || deltaM[3] === 'بعد' ? 1 : -1) : 30;
    const subject = extractAfterKw(text, ['جلسه', 'میتینگ', 'برنامه'], ['را', 'رو', 'به', 'بعد', 'قبل', 'جلو', 'عقب']);
    return { type: 'reschedule_meeting', meetingSubjectQuery: subject, timeDeltaMinutes: delta, confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: `آیا جلسه "${subject || 'پیدا شده'}" ${Math.abs(delta)} دقیقه ${delta > 0 ? 'جلو' : 'عقب'} کشیده شود؟` };
  }

  // ارسال پیام
  if (/پیام بده|پیام بفرست|ارسال پیام|یک پیام|پیام بزن/.test(lo)) {
    const targetUser = extractNameAfter(text, ['به', 'برای']) || extractAfterKw(text, ['پیام بده به', 'پیام بفرست به']);
    const bodyM = text.match(/(?:با\s+موضوع|موضوع|با\s+متن|متن|محتوا|متنش|بنویس)\s+(.+?)(?:\s+با\s+اهمیت|$)/i) 
      || text.match(/:\s*(.+?)(?:\s+با\s+اهمیت|$)/) 
      || text.match(/«(.+?)»/) 
      || text.match(/"(.+?)"/);
    const messageBody = bodyM?.[1]?.trim() || '';
    const isUrgent = /اورژانس|فوری/.test(lo);
    return { type: 'chat_send_message', targetUser, messageBody, messageImportance: extractImportance(lo), confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: isUrgent ? '⚠️ پیام اورژانسی است. مطمئن هستید؟' : 'این پیام ارسال شود؟' };
  }

  // ایجاد اقدام
  if (/اقدام|وظیفه|تسک/.test(lo) && /ایجاد|بساز|ثبت|جدید|اضافه/.test(lo)) {
    const titleM = text.match(/(?:با\s+عنوان|عنوان)\s+(.+?)(?:\s+(?:برای|سررسید)|$)/i);
    const taskTitle = titleM?.[1]?.trim() || extractAfterKw(text, ['با عنوان', 'عنوان'], ['برای', 'سررسید']);
    return { type: 'create_task', taskTitle, taskAssigneeName: extractNameAfter(text, ['برای', 'اقدام کننده', 'مسئول']), taskDueDate: extractJalaliDate(text), priority: extractPriority(lo), confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: `اقدام "${taskTitle}" ثبت شود؟` };
  }

  // ایجاد جلسه جدید
  if (/جلسه|درخواست جلسه|میتینگ/.test(lo) && !/لغو/.test(lo) && !/تغییر/.test(lo)) {
    const subject = extractAfterKw(text, ['موضوع', 'با موضوع'], ['نماینده', 'شماره', 'مکان']);
    const repM = text.match(/نماینده\s+([\u0600-\u06FF\w][\u0600-\u06FF\w\s]*?)(?:\s+(?:شماره|مکان|تاریخ)|[،,]|$)/i);
    return { type: 'meeting_request', subject, representative: repM?.[1]?.trim() || extractNameAfter(text, ['نماینده']), phone: extractPhone(text), location: extractAfterKw(text, ['مکان', 'محل', 'اتاق'], ['ساعت', 'تاریخ', 'شماره']), date: extractJalaliDate(text), startTime: extractTime(text), endTime: addMins(extractTime(text), 60), priority: extractPriority(lo), confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: `فرم جلسه باز شود؟` };
  }

  // ایجاد یادداشت
  if (/یادداشت/.test(lo) && /ثبت|بنویس|ایجاد|جدید|اضافه/.test(lo)) {
    const noteTitle = extractAfterKw(text, ['با عنوان', 'عنوان'], ['با متن']);
    return { type: 'create_note', noteTitle, noteContent: '', confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: `یادداشت "${noteTitle}" ثبت شود؟` };
  }

  // افزودن مخاطب
  if (/مخاطب/.test(lo) && /ثبت|اضافه|ذخیره|جدید/.test(lo)) {
    const phone = extractPhone(text);
    const nameM = text.match(/(?:به\s+نام|اسم|نام)\s+([\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,})?)/i);
    return { type: 'add_contact', contactName: nameM?.[1]?.trim() || '', contactPhone: phone, confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: `مخاطب "${nameM?.[1]?.trim() || phone}" ثبت شود؟` };
  }

  // ناشناس
  return { type: 'unknown', confidence: 0, autoExecute: false, requiresConfirmation: false, response: 'متوجه نشدم. می‌توانید بگویید:\n• «تقویم ماهانه نشون بده»\n• «تقویم روزانه»\n• «یک جلسه بزار با موضوع...»\n• «پیام بده به ... با موضوع ...»\n• «اقدام ایجاد کن با عنوان ...»' };
}

// ─── TTS ──────────────────────────────────────────────────────────────────────
function speak(text: string) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const doSpeak = () => {
    const u = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const fa = voices.find(v => v.lang === 'fa-IR') || voices.find(v => v.lang.startsWith('fa'));
    if (fa) u.voice = fa;
    u.lang = 'fa-IR'; u.rate = 0.95;
    window.speechSynthesis.speak(u);
  };
  if (window.speechSynthesis.getVoices().length > 0) doSpeak();
  else { window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; doSpeak(); }; }
}

// ─── Executors ────────────────────────────────────────────────────────────────
async function execSendMessage(cmd: ParsedCommand, userId: string): Promise<string> {
  if (!cmd.targetUser) throw new Error('نام گیرنده مشخص نیست');
  if (!cmd.messageBody?.trim()) throw new Error('متن پیام مشخص نیست');

  const resolvedBody = cmd.messageBody.trim();
  const msgType = cmd.messageImportance === 'urgent' ? 'urgent' : cmd.messageImportance === 'important' ? 'important' : 'normal';
  const lbl = msgType === 'urgent' ? ' اورژانسی' : msgType === 'important' ? ' مهم' : '';

  // ── جستجو در پروفایل‌های کاربران ─────────────────────────────────────────────
  const { data: profiles } = await supabase.from('profiles').select('user_id, full_name').ilike('full_name', `%${cmd.targetUser}%`).limit(5);
  if (profiles?.length) {
    const recipient = profiles[0];
    const { data: convId, error: convErr } = await supabase.rpc('find_or_create_direct_conversation', { user_a: userId, user_b: recipient.user_id });
    if (convErr || !convId) throw new Error(convErr?.message || 'خطا در ایجاد گفتگو');
    const { error } = await supabase.from('chat_messages').insert({ conversation_id: convId, sender_id: userId, body: resolvedBody, message_type: msgType });
    if (error) throw new Error(error.message);
    return `✅ پیام${lbl} به ${recipient.full_name} ارسال شد.`;
  }

  // ── جستجو در کانال‌ها و گروه‌ها ──────────────────────────────────────────────
  // نام کاربر ممکن است با کلمه «گروه» شروع شده باشد
  const channelQuery = cmd.targetUser.replace(/^گروه\s*/i, '').trim();
  const { data: channels } = await supabase
    .from('channels')
    .select('id, name, type')
    .ilike('name', `%${channelQuery}%`)
    .limit(3);

  if (channels?.length) {
    const ch = channels[0];
    const { data: member } = await supabase
      .from('channel_members').select('id').eq('channel_id', ch.id).eq('user_id', userId).maybeSingle();
    if (!member) return `❌ شما عضو گروه "${ch.name}" نیستید.`;
    const { error: chErr } = await supabase.from('channel_messages').insert({
      channel_id: ch.id, sender_id: userId, body: resolvedBody,
      message_type: msgType, read_by: [],
    });
    if (chErr) throw new Error(chErr.message);
    return `✅ پیام${lbl} در گروه "${ch.name}" ارسال شد.`;
  }

  return `❌ کاربر یا گروهی با نام "${cmd.targetUser}" یافت نشد.`;
}

async function execCreateTask(cmd: ParsedCommand, userId: string): Promise<string> {
  const { data: myProfile } = await supabase.from('profiles').select('full_name').eq('user_id', userId).maybeSingle();
  let assigneeId = userId;
  let assigneeName = myProfile?.full_name || 'من';
  if (cmd.taskAssigneeName) {
    const { data: ap } = await supabase.from('profiles').select('user_id, full_name').ilike('full_name', `%${cmd.taskAssigneeName}%`).limit(1).maybeSingle();
    if (ap) { assigneeId = ap.user_id; assigneeName = ap.full_name || cmd.taskAssigneeName; }
    else assigneeName = cmd.taskAssigneeName;
  }
  const { error } = await supabase.from('tasks').insert({
    user_id: userId,             // همیشه کاربر جاری (ایجادکننده) — رفع خطای RLS
    created_by_id: userId,
    current_assignee_id: assigneeId,
    title: cmd.taskTitle || 'اقدام جدید',
    description: 'ایجاد شده توسط اسپارک',
    priority: cmd.priority || 'medium',
    status: 'pending',
    // Convert Jalali due date (from AI) to Gregorian ISO before storing.
    // Storing raw Jalali causes a double-conversion bug (1405→784) in TasksPage.
    due_date: cmd.taskDueDate ? jalaliToGregorianIso(cmd.taskDueDate) : null,
    assignee: assigneeName,
    archived: false
  });
  if (error) throw new Error(error.message);
  return `✅ اقدام "${cmd.taskTitle}" برای ${assigneeName} ثبت شد.`;
}

async function execCreateNote(cmd: ParsedCommand, userId: string): Promise<string> {
  const { error } = await supabase.from('notes').insert({ user_id: userId, title: cmd.noteTitle || 'یادداشت جدید', content: cmd.noteContent || '' });
  if (error) throw new Error(error.message);
  return `✅ یادداشت "${cmd.noteTitle}" ثبت شد.`;
}

async function execAddContact(cmd: ParsedCommand, userId: string): Promise<string> {
  if (!cmd.contactName && !cmd.contactPhone) throw new Error('نام یا شماره تماس الزامی است');
  const { error } = await supabase.from('contacts_email').insert({
    user_id: userId,
    name: cmd.contactName || '',
    phone: cmd.contactPhone || '',
    email: cmd.contactEmail || '',
    company: cmd.contactOrg || ''
  });
  if (error) throw new Error(error.message);
  return `✅ مخاطب "${cmd.contactName || cmd.contactPhone}" ثبت شد.`;
}

async function execQueryMeetings(cmd: ParsedCommand, userId: string): Promise<string> {
  const filter = cmd.queryFilter || 'all';
  let q = supabase.from('meetings').select('id', { count: 'exact', head: true }).eq('user_id', userId);
  const { count } = await q;
  const filterLabel: Record<string, string> = { all: 'کل', open: 'باز', closed: 'بسته', today: 'امروز', this_week: 'این هفته' };
  return `📊 تعداد جلسات ${filterLabel[filter] || ''}: ${count ?? 0} جلسه`;
}

async function execListMeetingsOnDate(cmd: ParsedCommand, userId: string): Promise<string> {
  const dateStr = cmd.queryDate || cmd.date;
  const jalaliStr = dateStr || moment().format('jYYYY/jMM/jDD');

  const [rangeStart, rangeEnd] = jalaliDayRange(jalaliStr);
  if (!rangeStart) return `📭 تاریخ «${jalaliStr}» معتبر نیست.`;

  const [{ data: owned }, { data: participating }, { data: notified }] = await Promise.all([
    supabase.from('meetings').select('id, subject, start_time, location')
      .eq('user_id', userId)
      .gte('request_date', rangeStart).lt('request_date', rangeEnd)
      .order('start_time', { ascending: true }),
    supabase.from('meetings').select('id, subject, start_time, location')
      .filter('participant_user_ids', 'cs', `{"${userId}"}`)
      .neq('user_id', userId)
      .gte('request_date', rangeStart).lt('request_date', rangeEnd)
      .order('start_time', { ascending: true }),
    supabase.from('meetings').select('id, subject, start_time, location')
      .filter('notify_users', 'cs', `{"${userId}"}`)
      .neq('user_id', userId)
      .gte('request_date', rangeStart).lt('request_date', rangeEnd)
      .order('start_time', { ascending: true }),
  ]);

  const allMap = new Map<string, any>();
  for (const m of [...(owned || []), ...(participating || []), ...(notified || [])]) {
    allMap.set(m.id, m);
  }
  const allMtgs = Array.from(allMap.values()).sort((a, b) =>
    (a.start_time || '').localeCompare(b.start_time || '')
  );

  if (allMtgs.length === 0) return `📭 جلسه‌ای برای تاریخ ${jalaliStr} ثبت نشده.`;
  const lines = allMtgs.map((m: any) => `• ${m.subject}${m.start_time ? ' — ساعت ' + m.start_time : ''}${m.location ? ' — ' + m.location : ''}`).join('\n');
  return `📅 ${allMtgs.length} جلسه در تاریخ ${jalaliStr}:\n${lines}`;
}

async function execRescheduleMeeting(cmd: ParsedCommand, userId: string): Promise<string> {
  if (!cmd.meetingSubjectQuery) throw new Error('موضوع جلسه مشخص نشده');
  if (cmd.timeDeltaMinutes === undefined || cmd.timeDeltaMinutes === 0) throw new Error('مقدار جابجایی زمانی مشخص نشده');
  const { data: meetings } = await supabase
    .from('meetings').select('id, subject, start_time, end_time, user_id, participant_user_ids, notify_users')
    .ilike('subject', `%${cmd.meetingSubjectQuery}%`)
    .or(`user_id.eq.${userId},participant_user_ids.cs.{"${userId}"}`)
    .limit(1);
  if (!meetings?.length) return `❌ جلسه‌ای با موضوع "${cmd.meetingSubjectQuery}" یافت نشد.`;
  const mtg = meetings[0];
  if (!mtg.start_time) return `⚠️ جلسه "${mtg.subject}" زمان ثبت‌شده‌ای ندارد.`;
  const [h, m] = mtg.start_time.split(':').map(Number);
  const totalMins = h * 60 + m + (cmd.timeDeltaMinutes || 0);
  const newH = Math.floor(((totalMins % 1440) + 1440) % 1440 / 60);
  const newM = ((totalMins % 1440) + 1440) % 1440 % 60;
  const newStart = `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  let newEnd = mtg.end_time;
  if (mtg.end_time) {
    const [eh, em] = mtg.end_time.split(':').map(Number);
    const endTotal = eh * 60 + em + (cmd.timeDeltaMinutes || 0);
    const newEH = Math.floor(((endTotal % 1440) + 1440) % 1440 / 60);
    const newEM = ((endTotal % 1440) + 1440) % 1440 % 60;
    newEnd = `${String(newEH).padStart(2, '0')}:${String(newEM).padStart(2, '0')}`;
  }
  const { error } = await supabase.from('meetings').update({ start_time: newStart, end_time: newEnd }).eq('id', mtg.id);
  if (error) throw new Error(error.message);
  const dir = (cmd.timeDeltaMinutes || 0) > 0 ? 'جلو' : 'عقب';
  const mins = Math.abs(cmd.timeDeltaMinutes || 0);
  return `✅ جلسه "${mtg.subject}" ${mins} دقیقه ${dir} کشیده شد.\n⏰ زمان جدید: ${newStart}${newEnd ? ' تا ' + newEnd : ''}`;
}

async function execCancelMeeting(cmd: ParsedCommand, userId: string): Promise<string> {
  if (!cmd.meetingSubjectQuery) throw new Error('موضوع جلسه مشخص نشده');
  const { data: meetings } = await supabase
    .from('meetings')
    .select('id, subject, start_time, user_id, participant_user_ids, notify_users')
    .ilike('subject', `%${cmd.meetingSubjectQuery}%`)
    .or(`user_id.eq.${userId},participant_user_ids.cs.{"${userId}"}`)
    .limit(1);
  if (!meetings?.length) return `❌ جلسه‌ای با موضوع "${cmd.meetingSubjectQuery}" یافت نشد.`;
  const mtg = meetings[0];
  const { error } = await supabase.from('meetings').update({ status_type: 'cancelled', status: 'لغو شد' }).eq('id', mtg.id);
  if (error) throw new Error(error.message);
  return `✅ جلسه "${mtg.subject}" لغو شد.`;
}

// ─── Execute command after confirmation ───────────────────────────────────────
async function executeCommand(
  cmd: ParsedCommand,
  userId: string,
  onNavigate: (page: string) => void,
  onSetCalendarView: ((view: string) => void) | undefined,
  onOpenMeetingForm: ((prefill: SparkMeetingPrefill) => void) | undefined,
  onOpenCalendarMeetingForm: ((prefill: SparkCalendarMeetingPrefill) => void) | undefined,
  onNavigateToDate: ((jy: number, jm: number, jd: number, view?: string) => void) | undefined,
): Promise<{ success: boolean; message: string }> {
  switch (cmd.type) {
    case 'navigate':
      onNavigate(cmd.page!);
      return { success: true, message: `✅ صفحه ${cmd.page} باز شد.` };
      
    case 'calendar_view': {
      const view = cmd.calendarView || 'week';
      if (onSetCalendarView) onSetCalendarView(view);
      else onNavigate('calendar');
      const labels: Record<string, string> = { day: 'روزانه', week: 'هفتگی', month: 'ماهانه', 'list-week': 'لیست هفتگی', 'list-month': 'لیست ماهانه' };
      return { success: true, message: `✅ تقویم ${labels[view] || view} نمایش داده شد.` };
    }
    
    case 'calendar_list_today':
      return { success: true, message: await execListMeetingsOnDate({ ...cmd, queryDate: moment().format('jYYYY/jMM/jDD') }, userId) };
      
    case 'calendar_list_date':
      return { success: true, message: await execListMeetingsOnDate(cmd, userId) };
      
    case 'meeting_request': {
      const parts = cmd.date ? cmd.date.split('/').map(Number) : [];
      const prefill: SparkMeetingPrefill = {
        subject: cmd.subject,
        representative: cmd.representative,
        phone: cmd.phone,
        location: cmd.location,
        priority: cmd.priority || 'medium',
        startTime: cmd.startTime,
        endTime: cmd.endTime,
        dateJy: parts[0],
        dateJm: parts[1],
        dateJd: parts[2],
        participantNames: cmd.participantNames,
      };
      if (onOpenMeetingForm) {
        onOpenMeetingForm(prefill);
        return { success: true, message: `✅ فرم درخواست جلسه باز شد.` };
      }
      return { success: false, message: '❌ فرم درخواست جلسه در دسترس نیست.' };
    }
    
    case 'reschedule_meeting':
      return { success: true, message: await execRescheduleMeeting(cmd, userId) };
      
    case 'cancel_meeting':
      return { success: true, message: await execCancelMeeting(cmd, userId) };
      
    case 'chat_send_message':
      return { success: true, message: await execSendMessage(cmd, userId) };
      
    case 'create_task':
      return { success: true, message: await execCreateTask(cmd, userId) };
      
    case 'create_note':
      return { success: true, message: await execCreateNote(cmd, userId) };
      
    case 'add_contact':
      return { success: true, message: await execAddContact(cmd, userId) };
      
    case 'query_meetings_count':
      return { success: true, message: await execQueryMeetings(cmd, userId) };
      
    case 'calendar_navigate_date': {
      const dateStr = cmd.calendarDate || cmd.date;
      if (dateStr && onNavigateToDate) {
        const parts = dateStr.split('/').map(Number);
        if (parts.length === 3) {
          onNavigateToDate(parts[0], parts[1], parts[2], cmd.calendarView || 'day');
          return { success: true, message: `✅ تقویم به تاریخ ${dateStr} رفت.` };
        }
      }
      onNavigate('calendar');
      return { success: true, message: '✅ تقویم باز شد.' };
    }

    case 'calendar_meeting_form': {
      const parts = cmd.date ? cmd.date.split('/').map(Number) : [];
      const prefill: SparkCalendarMeetingPrefill = {
        subject: cmd.subject,
        representative: cmd.representative,
        phone: cmd.phone,
        location: cmd.location,
        priority: cmd.priority || 'medium',
        startTime: cmd.startTime,
        endTime: cmd.endTime,
        dateJy: parts[0],
        dateJm: parts[1],
        dateJd: parts[2],
        participantNames: cmd.participantNames,
      };
      if (onOpenCalendarMeetingForm) {
        onOpenCalendarMeetingForm(prefill);
        return { success: true, message: '✅ فرم تنظیم جلسه در تقویم باز شد.' };
      }
      onNavigate('calendar');
      return { success: true, message: '✅ به تقویم رفتید.' };
    }

    case 'conversational':
      return { success: true, message: (cmd as any).answer || cmd.response || 'پاسخی یافت نشد.' };

    case 'explain':
      return { success: true, message: cmd.explanation || cmd.response || 'اطلاعات بیشتری در دسترس نیست.' };
      
    default:
      return { success: false, message: cmd.response || '❌ دستور شناخته نشد.' };
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export function SparkAssistant({
  currentUserId, onNavigate, onSetCalendarView, onNewLogEntry, onOpenMeetingForm,
  onOpenCalendarMeetingForm, onNavigateToDate,
  externalCommand, onExternalCommandConsumed,
}: SparkAssistantProps) {
  const SPARK_FAB_SIZE = 38;
  const { pos: fabPos, onDragStart, wasDragged } = useDraggableFab('spark-fab-pos', 'left', SPARK_FAB_SIZE);
  const [open, setOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [listening, setListening] = useState<'off' | 'recording'>('off');
  const [processing, setProcessing] = useState(false);
  const [muted, setMuted] = useState(false);
  const [pulse, setPulse] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [memory, setMemory] = useState<SparkMemory[]>([]);
  const [configsLoaded, setConfigsLoaded] = useState(false);
  const [pendingConfirmCmd, setPendingConfirmCmd] = useState<ParsedCommand | null>(null);
  const [pendingConfirmMsgId, setPendingConfirmMsgId] = useState<string | null>(null);

  const transcriptRef = useRef('');
  const recognitionRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadSettings = useCallback(async () => {
    const [{ data: aiCfg }, { data: mem }] = await Promise.all([
      supabase.from('spark_ai_settings').select('enabled, api_key').maybeSingle(),
      supabase.from('spark_memory').select('key, value').eq('user_id', currentUserId).order('usage_count', { ascending: false }).limit(20),
    ]);
    setAiEnabled((aiCfg?.enabled === true) && !!aiCfg?.api_key?.trim());
    setMemory((mem || []) as SparkMemory[]);
    setConfigsLoaded(true);
  }, [currentUserId]);

  useEffect(() => { loadSettings(); }, [loadSettings]);
  useEffect(() => { if (open) loadSettings(); }, [open, loadSettings]);

  useEffect(() => {
    if (!externalCommand || !configsLoaded) return;
    setOpen(true);
    const t = setTimeout(() => { handleCommand(externalCommand); onExternalCommandConsumed?.(); }, 400);
    return () => clearTimeout(t);
  }, [externalCommand, configsLoaded]);

  useEffect(() => { const iv = setInterval(() => setPulse(p => !p), 3000); return () => clearInterval(iv); }, []);
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  useEffect(() => {
    if (open && messages.length === 0) {
      const g = aiEnabled
        ? '🤖 سلام! اسپارک AI آماده است.\n\n⚠️ توجه: قبل از هر اقدام مهم (ارسال پیام، ایجاد جلسه، لغو و ...) از شما تأیید می‌گیرم.\n\nدستور خود را بگویید.'
        : '🤖 سلام! اسپارک آماده است.\n\n⚠️ توجه: قبل از هر اقدام مهم از شما تأیید می‌گیرم.\n\nدستور خود را بگویید.';
      addMsg('spark', g);
      if (!muted) setTimeout(() => speak(g), 300);
    }
  }, [open]);

  const addMsg = (role: 'spark' | 'user', text: string, status?: Message['status'], pendingCmd?: ParsedCommand | null) =>
    setMessages(prev => [...prev, { id: `${Date.now()}_${Math.random()}`, role, text, status, pendingCommand: pendingCmd }]);

  const updateLastSparkMsg = (status: Message['status'], text?: string) =>
    setMessages(prev => {
      const msgs = [...prev];
      let last = -1;
      for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === 'spark') { last = i; break; } }
      if (last >= 0) msgs[last] = { ...msgs[last], status, ...(text ? { text } : {}) };
      return msgs;
    });

  const logCmd = async (raw: string, type: string, payload: any): Promise<string | null> => {
    try {
      const { data } = await supabase.from('spark_assistant_logs').insert({ user_id: currentUserId, command_text: raw, command_type: type, status: 'pending', payload }).select().maybeSingle();
      return data?.id || null;
    } catch { return null; }
  };

  const finishLog = async (id: string | null, status: 'done' | 'failed', summary: string, err?: string) => {
    if (!id) return;
    const { data } = await supabase.from('spark_assistant_logs').update({ status, result_summary: summary, error_message: err || null }).eq('id', id).select().maybeSingle();
    if (data && onNewLogEntry) onNewLogEntry(data as SparkLog);
  };

  const callAI = async (rawText: string): Promise<ParsedCommand | null> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return null;
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spark-ai`;
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}`, 'Content-Type': 'application/json', 'Apikey': import.meta.env.VITE_SUPABASE_ANON_KEY },
        body: JSON.stringify({ command: rawText, todayDate: moment().format('jYYYY/jMM/jDD'), conversationHistory: messages.slice(-8).map(m => ({ role: m.role, text: m.text })), memory }),
      });
      if (!res.ok) {
        console.error('AI call failed with status:', res.status);
        return null;
      }
      const data = await res.json();
      if (data.error === 'AI_NOT_CONFIGURED') {
        await loadSettings();
        return null;
      }
      if (data.error) throw new Error(data.error);
      // اطمینان از وجود requiresConfirmation در پاسخ AI
      const cmd = data as ParsedCommand;
      cmd.requiresConfirmation = requiresConfirmationByType(cmd.type);
      return cmd;
    } catch (e) {
      console.error('AI call failed:', e);
      return null;
    }
  };

  // ─── تأیید دستور توسط کاربر ─────────────────────────────────────────────────
  const confirmCommand = async (confirmed: boolean) => {
    if (!pendingConfirmCmd || !pendingConfirmMsgId) {
      setPendingConfirmCmd(null);
      setPendingConfirmMsgId(null);
      setProcessing(false);
      return;
    }

    const cmd = pendingConfirmCmd;
    const msgId = pendingConfirmMsgId;

    setPendingConfirmCmd(null);
    setPendingConfirmMsgId(null);

    if (!confirmed) {
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, status: 'failed', text: '❌ دستور لغو شد. هیچ اقدامی انجام نشد.' } : m
      ));
      if (!muted) speak('دستور لغو شد.');
      setProcessing(false);
      return;
    }

    setMessages(prev => prev.map(m =>
      m.id === msgId ? { ...m, status: 'executing', text: '⏳ در حال اجرا...' } : m
    ));

    try {
      const result = await executeCommand(cmd, currentUserId, onNavigate, onSetCalendarView, onOpenMeetingForm, onOpenCalendarMeetingForm, onNavigateToDate);
      const finalMsg = result.message;
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, status: result.success ? 'done' : 'failed', text: finalMsg } : m
      ));
      if (!muted) speak(finalMsg.split('\n')[0]);
    } catch (err: any) {
      const errMsg = '❌ خطا: ' + (err?.message || 'نامشخص');
      setMessages(prev => prev.map(m =>
        m.id === msgId ? { ...m, status: 'failed', text: errMsg } : m
      ));
      if (!muted) speak('خطایی رخ داد.');
    }

    setProcessing(false);
  };

  // ─── پردازش دستور اصلی ──────────────────────────────────────────────────────
  const handleCommand = useCallback(async (rawText: string) => {
    if (!rawText.trim() || processing) return;
    addMsg('user', rawText);
    setInputText('');
    setProcessing(true);

    addMsg('spark', aiEnabled ? '🤖 هوش مصنوعی در حال تحلیل...' : '📝 در حال تحلیل...', 'executing');
    const logId = await logCmd(rawText, 'processing', { raw: rawText });

    let cmd: ParsedCommand;
    let usedAI = false;
    try {
      if (aiEnabled) {
        const aiResult = await callAI(rawText);
        if (aiResult) {
          cmd = aiResult;
          usedAI = true;
        } else {
          cmd = parseLocal(rawText);
        }
      } else {
        cmd = parseLocal(rawText);
      }
    } catch {
      cmd = parseLocal(rawText);
    }

    // اطمینان از وجود requiresConfirmation
    if (cmd.requiresConfirmation === undefined) {
      cmd.requiresConfirmation = requiresConfirmationByType(cmd.type);
    }

    if (cmd.type === 'clarification') {
      const q = cmd.question || cmd.response || 'اطلاعات بیشتری لازم است. لطفاً واضح‌تر بگویید.';
      updateLastSparkMsg('pending', q);
      if (!muted) speak(q);
      await finishLog(logId, 'pending', q);
      setProcessing(false);
      return;
    }

    if (cmd.type === 'unknown') {
      const resp = usedAI
        ? (cmd.response || '❌ متوجه نشدم. سوال یا دستور خود را واضح‌تر بیان کنید.')
        : '❌ دستور را متوجه نشدم. دوباره با جزئیات بیشتر بگویید.';
      updateLastSparkMsg('failed', resp);
      if (!muted) speak('متوجه نشدم.');
      await finishLog(logId, 'failed', 'unknown');
      setProcessing(false);
      return;
    }

    // بررسی نیاز به تأیید
    if (cmd.requiresConfirmation === true) {
      const summary = formatCommandSummary(cmd);
      const confirmMsg = `🔐 **تأیید لازم است**\n\n${summary}\n\n━━━━━━━━━━━━━━━━━━━━\nآیا برای اجرا مطمئن هستید؟`;

      const newMsgId = `${Date.now()}_${Math.random()}`;
      setMessages(prev => {
        const msgs = [...prev];
        // آپدیت پیام "در حال تحلیل..." به حالت pending
        let last = -1;
        for (let i = msgs.length - 1; i >= 0; i--) { if (msgs[i].role === 'spark') { last = i; break; } }
        if (last >= 0) msgs[last] = { ...msgs[last], status: 'pending', text: cmd.response || 'تحلیل شد.' };
        return [...msgs, { id: newMsgId, role: 'spark', text: confirmMsg, status: 'waiting_confirm', pendingCommand: cmd }];
      });

      setPendingConfirmCmd(cmd);
      setPendingConfirmMsgId(newMsgId);

      if (!muted) speak('لطفاً تأیید کنید.');

      await finishLog(logId, 'pending', 'awaiting confirmation');
      setProcessing(false);
      return;
    }

    // دستورات بدون نیاز به تأیید - اجرای مستقیم
    try {
      const result = await executeCommand(cmd, currentUserId, onNavigate, onSetCalendarView, onOpenMeetingForm, onOpenCalendarMeetingForm, onNavigateToDate);
      const finalMsg = result.message;
      updateLastSparkMsg(result.success ? 'done' : 'failed', finalMsg);
      if (!muted) speak(finalMsg.split('\n')[0]);
      await finishLog(logId, result.success ? 'done' : 'failed', finalMsg);
    } catch (err: any) {
      const errMsg = '❌ خطا: ' + (err?.message || 'نامشخص');
      updateLastSparkMsg('failed', errMsg);
      if (!muted) speak('خطایی رخ داد.');
      await finishLog(logId, 'failed', '', err?.message);
    }

    setProcessing(false);
  }, [processing, currentUserId, onNavigate, onSetCalendarView, onOpenMeetingForm, onOpenCalendarMeetingForm, onNavigateToDate, muted, aiEnabled, memory, messages]);

  const startRecording = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { toast.error('مرورگر از تشخیص صدا پشتیبانی نمی‌کند'); return; }
    transcriptRef.current = '';
    const r = new SR();
    r.lang = 'fa-IR'; r.continuous = true; r.interimResults = true;
    r.onstart = () => setListening('recording');
    r.onresult = (e: any) => {
      let final = '';
      for (let i = 0; i < e.results.length; i++) { if (e.results[i].isFinal) final += e.results[i][0].transcript + ' '; }
      transcriptRef.current = final.trim();
      setInputText(final.trim() || e.results[e.results.length - 1][0].transcript);
    };
    r.onerror = (e: any) => { setListening('off'); if (e.error !== 'aborted') addMsg('spark', '❌ خطا در تشخیص صدا.', 'failed'); };
    r.onend = () => { setListening('off'); if (transcriptRef.current.trim()) handleCommand(transcriptRef.current.trim()); };
    recognitionRef.current = r;
    r.start();
  };

  const stopRecording = () => recognitionRef.current?.stop();
  const toggleListening = () => { if (listening === 'recording') stopRecording(); else startRecording(); };
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); if (inputText.trim() && !processing) handleCommand(inputText); };

  const renderMessage = (msg: Message) => {
    if (msg.role === 'spark' && msg.status === 'waiting_confirm' && msg.pendingCommand) {
      return (
        <div className="max-w-[95%]">
          <div className="flex items-end gap-2">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center flex-shrink-0 mb-0.5">
              {aiEnabled ? <Brain className="w-3.5 h-3.5 text-white" /> : <Bot className="w-3.5 h-3.5 text-white" />}
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-br-sm text-sm shadow-md bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 max-w-full">
              <div className="whitespace-pre-line text-gray-800 dark:text-gray-200 mb-3 font-mono text-xs md:text-sm">{msg.text}</div>
              <div className="flex gap-3 mt-2">
                <button onClick={() => confirmCommand(true)} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold rounded-xl flex items-center gap-2 transition-all shadow-md">
                  <Check className="w-4 h-4" /> بله، اجرا کن
                </button>
                <button onClick={() => confirmCommand(false)} className="px-4 py-2 bg-gray-400 hover:bg-gray-500 dark:bg-gray-600 dark:hover:bg-gray-700 text-white text-sm font-bold rounded-xl flex items-center gap-2 transition-all shadow-md">
                  <XIcon className="w-4 h-4" /> لغو
                </button>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className={`flex ${msg.role === 'user' ? 'justify-start' : 'justify-end'}`}>
        {msg.role === 'spark' && (
          <div className="flex items-end gap-2 max-w-[92%]">
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center flex-shrink-0 mb-0.5">
              {aiEnabled ? <Brain className="w-3.5 h-3.5 text-white" /> : <Bot className="w-3.5 h-3.5 text-white" />}
            </div>
            <div className={`px-3 py-2 rounded-2xl rounded-br-sm text-sm shadow-sm leading-relaxed ${
              msg.status === 'failed' ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-800'
              : msg.status === 'done' ? 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 border border-emerald-200 dark:border-emerald-800'
              : msg.status === 'executing' ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
              : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-100'}`}>
              <div className="flex items-start gap-1.5">
                {msg.status === 'done' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0 mt-0.5" />}
                {msg.status === 'failed' && <AlertCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />}
                {msg.status === 'executing' && <Loader2 className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5 animate-spin" />}
                <span className="whitespace-pre-line">{msg.text}</span>
              </div>
            </div>
          </div>
        )}
        {msg.role === 'user' && (
          <div className="max-w-[80%] px-3 py-2 rounded-2xl rounded-bl-sm text-sm text-white leading-relaxed" style={{ background: 'linear-gradient(135deg,#0ea5e9,#2563eb)' }}>
            {msg.text}
          </div>
        )}
      </div>
    );
  };

  const SUGGESTIONS = [
    '📅 جلسات امروز چیه؟',
    '➕ یک جلسه بزار با موضوع هماهنگی قرارداد',
    '💬 یک پیام بده به احمدی با موضوع پیگیری پروژه',
    '📋 اقدام ایجاد کن با عنوان بررسی گزارش ماهانه',
    '❌ جلسه تست را لغو کن',
    '⏰ جلسه هماهنگی را ۳۰ دقیقه جلو بنداز',
  ];

  const statusLabel = listening === 'recording' ? '🎙️ در حال ضبط...'
    : processing ? (aiEnabled ? '🧠 هوش مصنوعی پردازش می‌کند...' : '⚙️ پردازش...')
    : aiEnabled ? '🤖 AI فعال' : '✅ آنلاین';

  return (
    <>
      {/* Draggable FAB */}
      <button
        onMouseDown={onDragStart}
        onTouchStart={onDragStart}
        onClick={() => { if (!wasDragged()) setOpen(true); }}
        className={`fixed z-[60] rounded-full shadow-xl flex items-center justify-center transition-all duration-200 select-none ${open ? 'scale-0 opacity-0 pointer-events-none' : 'opacity-80 hover:opacity-100 hover:scale-105'}`}
        style={{
          top: fabPos.y,
          left: fabPos.x,
          width: SPARK_FAB_SIZE,
          height: SPARK_FAB_SIZE,
          background: 'linear-gradient(135deg,#0ea5e9,#2563eb)',
          boxShadow: pulse ? '0 0 0 8px rgba(14,165,233,0.15),0 6px 20px rgba(37,99,235,0.4)' : '0 6px 20px rgba(37,99,235,0.3)',
          cursor: 'grab',
          touchAction: 'none',
        }}
        title="اسپارک"
      >
        <Bot className="w-[18px] h-[18px] text-white pointer-events-none" />
        <span className={`absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white animate-pulse ${aiEnabled ? 'bg-yellow-400' : 'bg-emerald-400'}`} />
      </button>

      {open && (
        <div
          className="fixed z-[60] w-[460px] max-w-[calc(100vw-1.5rem)] rounded-3xl shadow-2xl flex flex-col overflow-hidden"
          style={{ ...panelStyle(fabPos, 460, 620, SPARK_FAB_SIZE), height: '620px', boxShadow: '0 24px 64px rgba(0,0,0,0.22)' }}
          dir="rtl"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ background: 'linear-gradient(135deg,#0ea5e9,#2563eb)' }}>
            <div className="flex items-center gap-3">
              <div className={`w-9 h-9 rounded-full flex items-center justify-center ${listening === 'recording' ? 'bg-red-500 animate-pulse' : 'bg-white/20'}`}>
                {aiEnabled ? <Brain className="w-5 h-5 text-white" /> : <Bot className="w-5 h-5 text-white" />}
              </div>
              <div>
                <p className="font-bold text-white text-sm flex items-center gap-1.5">
                  اسپارک {aiEnabled ? <Zap className="w-3 h-3 text-yellow-300" /> : <Sparkles className="w-3 h-3 text-yellow-300" />}
                </p>
                <p className="text-[11px] text-blue-100">{statusLabel}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button onClick={() => { loadSettings(); toast.success('بارگذاری شد'); }} className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setMuted(v => !v)} className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
                {muted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => { setOpen(false); window.speechSynthesis?.cancel(); recognitionRef.current?.stop(); }} className="w-7 h-7 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Recording bar */}
          {listening === 'recording' && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 flex-shrink-0">
              <div className="flex gap-0.5 items-end">
                {[6, 10, 14, 10, 6].map((h, i) => <div key={i} className="w-1 bg-red-500 rounded-full animate-bounce" style={{ height: h, animationDelay: `${i * 0.12}s` }} />)}
              </div>
              <span className="text-xs text-red-700 dark:text-red-300 font-medium flex-1">🎙️ در حال ضبط... دستور کامل خود را بگویید، سپس توقف را بزنید</span>
              <button onClick={stopRecording} className="px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white text-xs font-bold rounded-lg flex items-center gap-1">
                <Square className="w-3 h-3" /> توقف
              </button>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-gray-50 dark:bg-gray-900">
            {messages.map(msg => <React.Fragment key={msg.id}>{renderMessage(msg)}</React.Fragment>)}
            {processing && messages[messages.length - 1]?.status !== 'executing' && messages[messages.length - 1]?.status !== 'waiting_confirm' && (
              <div className="flex items-end gap-2">
                <div className="w-7 h-7 rounded-full bg-gradient-to-br from-sky-400 to-blue-600 flex items-center justify-center"><Bot className="w-3.5 h-3.5 text-white" /></div>
                <div className="px-3 py-2 rounded-2xl bg-white dark:bg-gray-800 flex items-center gap-2 text-gray-400 text-sm shadow-sm">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> در حال پردازش...
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestions */}
          {messages.length <= 1 && (
            <div className="px-3 pb-2 flex-shrink-0 bg-gray-50 dark:bg-gray-900">
              <p className="text-[10px] text-gray-400 mb-1.5 font-medium">✨ نمونه دستورات:</p>
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map(s => (
                  <button key={s} onClick={() => handleCommand(s)} className="text-[11px] px-2.5 py-1 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-800 hover:bg-blue-100 transition-colors truncate max-w-[200px]" title={s}>
                    {s.length > 35 ? s.slice(0, 35) + '...' : s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Input */}
          <form onSubmit={handleSubmit} className="flex items-center gap-2 px-3 py-3 border-t border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800 flex-shrink-0">
            <button type="button" onClick={toggleListening} disabled={processing} className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 transition-all disabled:opacity-40 ${listening === 'recording' ? 'bg-red-500 hover:bg-red-600 text-white shadow-lg' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-blue-50 hover:text-blue-500'}`}>
              {listening === 'recording' ? <Square className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <input type="text" value={inputText} onChange={e => setInputText(e.target.value)} placeholder={listening === 'recording' ? '🎙️ در حال ضبط...' : aiEnabled ? '🤖 هر دستوری بدید...' : '✏️ دستور متنی یا صوتی...'} disabled={processing} dir="rtl" className="flex-1 px-3 py-2 text-sm bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl text-gray-800 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50" />
            <button type="submit" disabled={!inputText.trim() || processing || listening === 'recording'} className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white flex items-center justify-center flex-shrink-0 transition-colors">
              {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      )}
    </>
  );
}