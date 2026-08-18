import moment from 'moment-jalaali';
import type { ParsedCommand } from './SparkAssistantTypes';

export function requiresConfirmationByType(type: string): boolean {
  const writeCommands = [
    'meeting_request',
    'reschedule_meeting',
    'cancel_meeting',
    'chat_send_message',
    'create_task',
    'create_note',
    'add_contact',
    'calendar_meeting_form',
  ];
  const readCommands = [
    'navigate',
    'calendar_view',
    'calendar_list_today',
    'calendar_list_date',
    'query_meetings_count',
    'query_tasks_count',
    'query_notes_count',
    'query_contacts_count',
    'explain',
    'calendar_navigate_date',
    'conversational',
  ];
  if (writeCommands.includes(type)) return true;
  if (readCommands.includes(type)) return false;
  return true;
}

export function formatCommandSummary(cmd: ParsedCommand): string {
  switch (cmd.type) {
    case 'meeting_request':
      return `✅ **ثبت جلسه جدید**\n\n📌 موضوع: ${cmd.subject || 'نامشخص'}\n👤 نماینده: ${cmd.representative || 'نامشخص'}\n📞 تلفن: ${cmd.phone || 'نامشخص'}\n📍 مکان: ${cmd.location || 'نامشخص'}\n📅 تاریخ: ${cmd.date || 'نامشخص'}\n⏰ ساعت: ${cmd.startTime || 'نامشخص'}\n⚡ اولویت: ${cmd.priority === 'high' ? 'بالا' : cmd.priority === 'low' ? 'پایین' : 'متوسط'}`;
    case 'reschedule_meeting': {
      const delta = cmd.timeDeltaMinutes || 0;
      const direction = delta > 0 ? `${delta} دقیقه جلو` : `${Math.abs(delta)} دقیقه عقب`;
      return `⏰ **تغییر زمان جلسه**\n\n🔍 جستجو: "${cmd.meetingSubjectQuery || 'نامشخص'}"\n🕐 جابجایی: ${direction}`;
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
    case 'navigate': {
      const pageNames: Record<string, string> = {
        calendar: 'تقویم', chat: 'چت', tasks: 'اقدامات', notes: 'یادداشت‌ها',
        contacts: 'مخاطبین', reports: 'گزارش‌ها', meetings: 'جلسات',
        'video-conference': 'ویدیو کنفرانس', profile: 'پروفایل',
      };
      return `🧭 **رفتن به صفحه**\n\n📱 صفحه: ${pageNames[cmd.page || ''] || cmd.page}`;
    }
    case 'calendar_view': {
      const views: Record<string, string> = {
        day: 'روزانه', week: 'هفتگی', month: 'ماهانه',
        'list-week': 'لیست هفتگی', 'list-month': 'لیست ماهانه',
      };
      return `📅 **تغییر نمای تقویم**\n\nنمایش: ${views[cmd.calendarView || 'week']}`;
    }
    default:
      return `⚡ **${cmd.type}**\n\n${cmd.response || 'اجرا می‌شود'}`;
  }
}

function p2e(value: string): string {
  return value.replace(/[۰-۹]/g, digit => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function extractPhone(text: string): string {
  const match = p2e(text).match(/0[0-9]{10}/);
  return match ? match[0] : '';
}

function extractJalaliDate(text: string): string {
  const normalized = p2e(text);
  if (/فردا/.test(text)) return moment().add(1, 'day').format('jYYYY/jMM/jDD');
  if (/پس‌فردا|پس فردا/.test(text)) return moment().add(2, 'day').format('jYYYY/jMM/jDD');
  if (/امروز/.test(text)) return moment().format('jYYYY/jMM/jDD');
  const match = normalized.match(/(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (match) return `${match[1]}/${match[2].padStart(2, '0')}/${match[3].padStart(2, '0')}`;
  const days: Record<string, number> = {
    شنبه: 6, یکشنبه: 0, دوشنبه: 1, 'سه‌شنبه': 2, 'سه شنبه': 2,
    چهارشنبه: 3, 'پنج‌شنبه': 4, 'پنج شنبه': 4, جمعه: 5,
  };
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
  const normalized = p2e(text);
  const first = normalized.match(/ساعت\s*(\d{1,2})(?:[.:](\d{2}))?/);
  if (first) return `${first[1].padStart(2, '0')}:${first[2] || '00'}`;
  const second = normalized.match(/\b(\d{1,2}):(\d{2})\b/);
  if (second) return `${second[1].padStart(2, '0')}:${second[2]}`;
  return '';
}

function addMins(time: string, minutes: number): string {
  if (!time) return '';
  const [hours, mins] = time.split(':').map(Number);
  const total = hours * 60 + mins + minutes;
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

function extractNameAfter(text: string, keywords: string[]): string {
  for (const keyword of keywords) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}\\s+([\\u0600-\\u06FF]{2,}(?:\\s+[\\u0600-\\u06FF]{2,})?)`, 'i');
    const match = text.match(regex);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

function extractAfterKw(text: string, keywords: string[], stopKeywords: string[] = []): string {
  const stopPattern = stopKeywords.length
    ? `(?=\\s+(?:${stopKeywords.map(keyword => keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})|[،,]|$)`
    : '(?=[،,]|$)';
  for (const keyword of keywords) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`${escaped}\\s+([\\u0600-\\u06FF\\w][\\u0600-\\u06FF\\w\\s\\-]*?)${stopPattern}`, 'i');
    const match = text.match(regex);
    if (match?.[1]?.trim()) return match[1].trim();
  }
  return '';
}

export function parseLocal(text: string): ParsedCommand {
  const lower = text.toLowerCase();

  if (/چند تا جلسه|تعداد جلسات|چقدر جلسه|چند جلسه/.test(lower)) {
    return { type: 'query_meetings_count', queryFilter: 'all', confidence: 0.9, autoExecute: true, requiresConfirmation: false, response: 'در حال بررسی...' };
  }
  if (/جلسات امروز|برنامه امروز|جلسه امروز|امروز چه جلسه/.test(lower)) {
    return { type: 'calendar_list_today', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'جلسات امروز را بررسی می‌کنم.' };
  }
  if (/آموزش|چطور|چه جوری|چه طور|یاد بده|توضیح بده|راهنما/.test(lower)) {
    return { type: 'explain', topic: text, explanation: 'برای این کار می‌توانید از منوی اصلی وارد بخش مربوطه شوید.', confidence: 0.8, autoExecute: true, requiresConfirmation: false, response: 'توضیح می‌دهم.' };
  }

  if (/لیست\s*ماه|ماهانه\s*لیست/.test(lower)) return { type: 'calendar_view', calendarView: 'list-month', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'لیست ماهانه.' };
  if (/لیست\s*هفت|هفتگی\s*لیست/.test(lower)) return { type: 'calendar_view', calendarView: 'list-week', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'لیست هفتگی.' };
  if (/ماهانه|جدول\s*ماه|تقویم\s*ماه/.test(lower)) return { type: 'calendar_view', calendarView: 'month', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'تقویم ماهانه.' };
  if (/روزانه|نمای\s*روز/.test(lower)) return { type: 'calendar_view', calendarView: 'day', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'تقویم روزانه.' };
  if (/هفتگی|نمای\s*هفت/.test(lower)) return { type: 'calendar_view', calendarView: 'week', confidence: 0.95, autoExecute: true, requiresConfirmation: false, response: 'تقویم هفتگی.' };

  const navTargets: [RegExp, string][] = [
    [/تقویم|calendar/, 'calendar'], [/چت|گفتگو|پیام‌ها|chat/, 'chat'],
    [/اقدام|وظیفه|تسک|task/, 'tasks'], [/یادداشت|note/, 'notes'],
    [/مخاطب|contact/, 'contacts'], [/گزارش|report/, 'reports'],
    [/جلسه|میتینگ/, 'meetings'], [/ویدیو|کنفرانس/, 'video-conference'],
    [/پروفایل/, 'profile'],
  ];
  if (/برو|برو به|باز کن|صفحه|بزن|نشون|ببر/.test(lower)) {
    for (const [regex, page] of navTargets) {
      if (regex.test(lower)) return { type: 'navigate', page, confidence: 0.9, autoExecute: true, requiresConfirmation: false, response: 'رفتم.' };
    }
  }

  if (/تماس تصویری|ویدیو کال|ویدیوکال/.test(lower)) {
    const targetUser = extractNameAfter(text, ['با', 'به', 'برای']);
    localStorage.setItem('spark_call_intent', JSON.stringify({ userName: targetUser, callType: 'video' }));
    return { type: 'navigate', page: 'chat', confidence: 0.9, autoExecute: true, requiresConfirmation: false, response: 'رفتم به چت.' };
  }
  if (/تماس صوتی|تماس بگیر|زنگ بزن/.test(lower) && !/جلسه/.test(lower)) {
    const targetUser = extractNameAfter(text, ['با', 'به', 'برای']);
    localStorage.setItem('spark_call_intent', JSON.stringify({ userName: targetUser, callType: 'audio' }));
    return { type: 'navigate', page: 'chat', confidence: 0.9, autoExecute: true, requiresConfirmation: false, response: 'رفتم به چت.' };
  }

  if (/لغو|کنسل/.test(lower) && /جلسه|میتینگ/.test(lower)) {
    const subjectMatch = text.match(/جلسه\s+([\u0600-\u06FF\w][^\u0600-\u06FF\w\s]*(?:\s+[\u0600-\u06FF\w][^\u0600-\u06FF\w\s]*)*?)\s*(?:را|رو)\s*(?:لغو|کنسل)/);
    const subject = subjectMatch?.[1]?.trim() || extractAfterKw(text, ['جلسه', 'میتینگ'], ['را', 'رو', 'لغو', 'کنسل']);
    return { type: 'cancel_meeting', meetingSubjectQuery: subject, confidence: 0.9, autoExecute: false, requiresConfirmation: true, response: 'آیا برای لغو این جلسه اطمینان دارید؟' };
  }

  if (/(\d+)\s*(دقیقه|دق)\s*(جلو|عقب|بعد|قبل)/.test(lower) && /جلسه/.test(lower)) {
    const deltaMatch = lower.match(/(\d+)\s*(دقیقه|دق)\s*(جلو|عقب|بعد|قبل)/);
    const delta = deltaMatch ? parseInt(deltaMatch[1]) * (deltaMatch[3] === 'جلو' || deltaMatch[3] === 'بعد' ? 1 : -1) : 30;
    const subject = extractAfterKw(text, ['جلسه', 'میتینگ', 'برنامه'], ['را', 'رو', 'به', 'بعد', 'قبل', 'جلو', 'عقب']);
    return { type: 'reschedule_meeting', meetingSubjectQuery: subject, timeDeltaMinutes: delta, confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: `آیا جلسه "${subject || 'پیدا شده'}" ${Math.abs(delta)} دقیقه ${delta > 0 ? 'جلو' : 'عقب'} کشیده شود؟` };
  }

  if (/پیام بده|پیام بفرست|ارسال پیام|یک پیام|پیام بزن/.test(lower)) {
    const targetUser = extractNameAfter(text, ['به', 'برای']) || extractAfterKw(text, ['پیام بده به', 'پیام بفرست به']);
    const bodyMatch = text.match(/(?:با\s+موضوع|موضوع|با\s+متن|متن|محتوا|متنش|بنویس)\s+(.+?)(?:\s+با\s+اهمیت|$)/i)
      || text.match(/:\s*(.+?)(?:\s+با\s+اهمیت|$)/)
      || text.match(/«(.+?)»/)
      || text.match(/"(.+?)"/);
    const messageBody = bodyMatch?.[1]?.trim() || '';
    const isUrgent = /اورژانس|فوری/.test(lower);
    return { type: 'chat_send_message', targetUser, messageBody, messageImportance: extractImportance(lower), confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: isUrgent ? '⚠️ پیام اورژانسی است. مطمئن هستید؟' : 'این پیام ارسال شود؟' };
  }

  if (/اقدام|وظیفه|تسک/.test(lower) && /ایجاد|بساز|ثبت|جدید|اضافه/.test(lower)) {
    const titleMatch = text.match(/(?:با\s+عنوان|عنوان)\s+(.+?)(?:\s+(?:برای|سررسید)|$)/i);
    const taskTitle = titleMatch?.[1]?.trim() || extractAfterKw(text, ['با عنوان', 'عنوان'], ['برای', 'سررسید']);
    return { type: 'create_task', taskTitle, taskAssigneeName: extractNameAfter(text, ['برای', 'اقدام کننده', 'مسئول']), taskDueDate: extractJalaliDate(text), priority: extractPriority(lower), confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: `اقدام "${taskTitle}" ثبت شود؟` };
  }

  if (/جلسه|درخواست جلسه|میتینگ/.test(lower) && !/لغو/.test(lower) && !/تغییر/.test(lower)) {
    const subject = extractAfterKw(text, ['موضوع', 'با موضوع'], ['نماینده', 'شماره', 'مکان']);
    const representativeMatch = text.match(/نماینده\s+([\u0600-\u06FF\w][\u0600-\u06FF\w\s]*?)(?:\s+(?:شماره|مکان|تاریخ)|[،,]|$)/i);
    const startTime = extractTime(text);
    return {
      type: 'meeting_request', subject,
      representative: representativeMatch?.[1]?.trim() || extractNameAfter(text, ['نماینده']),
      phone: extractPhone(text),
      location: extractAfterKw(text, ['مکان', 'محل', 'اتاق'], ['ساعت', 'تاریخ', 'شماره']),
      date: extractJalaliDate(text), startTime, endTime: addMins(startTime, 60),
      priority: extractPriority(lower), confidence: 0.85, autoExecute: false,
      requiresConfirmation: true, response: 'فرم جلسه باز شود؟',
    };
  }

  if (/یادداشت/.test(lower) && /ثبت|بنویس|ایجاد|جدید|اضافه/.test(lower)) {
    const noteTitle = extractAfterKw(text, ['با عنوان', 'عنوان'], ['با متن']);
    return { type: 'create_note', noteTitle, noteContent: '', confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: `یادداشت "${noteTitle}" ثبت شود؟` };
  }

  if (/مخاطب/.test(lower) && /ثبت|اضافه|ذخیره|جدید/.test(lower)) {
    const phone = extractPhone(text);
    const nameMatch = text.match(/(?:به\s+نام|اسم|نام)\s+([\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,})?)/i);
    return { type: 'add_contact', contactName: nameMatch?.[1]?.trim() || '', contactPhone: phone, confidence: 0.85, autoExecute: false, requiresConfirmation: true, response: `مخاطب "${nameMatch?.[1]?.trim() || phone}" ثبت شود؟` };
  }

  return {
    type: 'unknown', confidence: 0, autoExecute: false, requiresConfirmation: false,
    response: 'متوجه نشدم. می‌توانید بگویید:\n• «تقویم ماهانه نشون بده»\n• «تقویم روزانه»\n• «یک جلسه بزار با موضوع...»\n• «پیام بده به ... با موضوع ...»\n• «اقدام ایجاد کن با عنوان ...»',
  };
}

export function speak(text: string) {
  if (!window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const doSpeak = () => {
    const utterance = new SpeechSynthesisUtterance(text);
    const voices = window.speechSynthesis.getVoices();
    const persian = voices.find(voice => voice.lang === 'fa-IR') || voices.find(voice => voice.lang.startsWith('fa'));
    if (persian) utterance.voice = persian;
    utterance.lang = 'fa-IR';
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  };
  if (window.speechSynthesis.getVoices().length > 0) doSpeak();
  else {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      doSpeak();
    };
  }
}
