/**
 * Shared catalog for SMS and notification templates.
 * All categories, event types, audiences, and placeholders are defined here
 * so that both SmsConfigPanel and NotificationsConfigPanel use the same source.
 */

// ─── Categories ──────────────────────────────────────────────────────────────

export interface TemplateCategory {
  key: string;
  label: string;
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  { key: 'meeting',  label: 'جلسات' },
  { key: 'task',     label: 'اقدامات' },
  { key: 'calendar', label: 'تقویم' },
  { key: 'chat',     label: 'چت سازمانی' },
  { key: 'channel',  label: 'کانال‌ها' },
  { key: 'note',     label: 'یادداشت‌ها' },
  { key: 'report',   label: 'گزارشات' },
  { key: 'system',   label: 'سیستم' },
];

export function categoryLabel(key: string): string {
  return TEMPLATE_CATEGORIES.find(c => c.key === key)?.label ?? key;
}

// ─── Event Types ──────────────────────────────────────────────────────────────

export interface TemplateEventType {
  key: string;
  label: string;
}

export const TEMPLATE_EVENT_TYPES: TemplateEventType[] = [
  { key: 'invite',       label: 'دعوت' },
  { key: 'change',        label: 'تغییر' },
  { key: 'cancel',        label: 'لغو' },
  { key: 'reminder',      label: 'یادآور' },
  { key: 'assign',        label: 'تخصیص' },
  { key: 'complete',      label: 'تکمیل' },
  { key: 'event_invite',  label: 'دعوت رویداد' },
  { key: 'mention',       label: 'منشن' },
  { key: 'message',       label: 'پیام' },
  { key: 'share',         label: 'اشتراک' },
  { key: 'alert',         label: 'هشدار' },
  { key: 'report_ready',  label: 'گزارش آماده شد' },
  { key: 'new_message',   label: 'پیام جدید در کانال' },
  { key: 'member_added',  label: 'افزودن عضو' },
  { key: 'custom',        label: 'سفارشی' },
];

export function eventTypeLabel(key: string): string {
  return TEMPLATE_EVENT_TYPES.find(e => e.key === key)?.label ?? key;
}

// ─── Audiences ────────────────────────────────────────────────────────────────

export interface TemplateAudience {
  key: string;
  label: string;
}

export const TEMPLATE_AUDIENCES: TemplateAudience[] = [
  { key: 'all',         label: 'همه' },
  { key: 'participants', label: 'شرکت‌کنندگان' },
  { key: 'observers',    label: 'مطلعین' },
  { key: 'external',     label: 'خارج سازمان' },
];

export function audienceLabel(key: string): string {
  return TEMPLATE_AUDIENCES.find(a => a.key === key)?.label ?? key;
}

// ─── Placeholders ──────────────────────────────────────────────────────────────

export interface TemplatePlaceholder {
  key: string;
  label: string;
  example: string;
}

export const TEMPLATE_PLACEHOLDERS: TemplatePlaceholder[] = [
  { key: 'full_name',        label: 'نام کامل گیرنده',      example: 'علی احمدی' },
  { key: 'meeting_subject',  label: 'موضوع جلسه',            example: 'جلسه هیئت مدیره' },
  { key: 'meeting_date',     label: 'تاریخ جلسه',            example: '۱۴۰۳/۰۳/۱۵' },
  { key: 'start_time',       label: 'ساعت شروع',              example: '۰۹:۰۰' },
  { key: 'end_time',         label: 'ساعت پایان',             example: '۱۰:۰۰' },
  { key: 'meeting_time',     label: 'بازه ساعت جلسه',         example: '۰۹:۰۰-۱۰:۰۰' },
  { key: 'location',         label: 'محل برگزاری',            example: 'سالن اجتماعات' },
  { key: 'location_part',    label: 'بخش محل (با خط فاصله)',  example: ' | سالن اجتماعات' },
  { key: 'join_link',        label: 'لینک ورود',              example: 'https://...' },
  { key: 'organizer_name',   label: 'نام تنظیم‌کننده جلسه',   example: 'سارا رضایی' },
  { key: 'representative',   label: 'نماینده',                example: 'رضا کریمی' },
  { key: 'agenda',           label: 'دستور جلسه',             example: '۱. بررسی گزارش...' },
  { key: 'minutes',          label: 'دقایق مانده',            example: '۳۰' },
  { key: 'task_title',       label: 'عنوان اقدام',            example: 'بررسی گزارش مالی' },
  { key: 'priority',         label: 'اولویت',                 example: 'بالا' },
  { key: 'due_date',         label: 'مهلت',                   example: '۱۴۰۳/۰۴/۰۱' },
  { key: 'event_title',      label: 'عنوان رویداد',           example: 'جشن سالگرد' },
  { key: 'event_date',       label: 'تاریخ رویداد',           example: '۱۴۰۳/۰۵/۱۰' },
  { key: 'sender_name',      label: 'نام فرستنده',            example: 'سارا رضایی' },
  { key: 'note_title',       label: 'عنوان یادداشت',          example: 'یادداشت جلسه' },
  { key: 'message_preview',  label: 'پیش‌نمایش پیام',         example: 'سلام، آیا گزارش آماده شده؟' },
  { key: 'alert_message',   label: 'متن هشدار',              example: 'خرابی موقت در سرویس ایمیل' },
  { key: 'org_name',         label: 'نام سازمان',            example: 'شرکت نمونه' },
  { key: 'report_title',     label: 'عنوان گزارش',            example: 'گزارش عملکرد ماهانه' },
  { key: 'report_link',     label: 'لینک گزارش',             example: 'https://...' },
  { key: 'channel_name',     label: 'نام کانال',              example: 'کانال اطلاع‌رسانی' },
  { key: 'channel_type',     label: 'نوع کانال',              example: 'کانال' },
];

export const PLACEHOLDER_KEYS: string[] = TEMPLATE_PLACEHOLDERS.map(p => p.key);

// ─── Placeholder extraction & validation ──────────────────────────────────────

/**
 * Extracts all `{{placeholder}}` tokens from a template string.
 * Returns a de-duplicated array of placeholder names (without braces).
 */
export function extractPlaceholders(template: string): string[] {
  const matches = template.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g);
  return [...new Set(Array.from(matches, m => m[1]))];
}

/**
 * Returns placeholders found in the template that are not in the known list.
 */
export function findUnknownPlaceholders(template: string): string[] {
  const found = extractPlaceholders(template);
  return found.filter(k => !PLACEHOLDER_KEYS.includes(k));
}

// ─── Safe template rendering ───────────────────────────────────────────────────

/**
 * Replaces `{{placeholder}}` tokens in a template string with values from `vars`.
 * Missing values are replaced with empty string (never `undefined` or `null`).
 * Remaining unreplaced placeholders are collected and returned for logging.
 */
export function renderTemplate(
  text: string,
  vars: Record<string, string>,
): { rendered: string; leftover: string[] } {
  const leftover: string[] = [];
  const rendered = text.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, key: string) => {
    const val = vars[key];
    if (val !== undefined && val !== null && val !== '') return val;
    leftover.push(key);
    return '';
  });
  return { rendered, leftover };
}

// ─── Meeting recipient role & template key ────────────────────────────────────

export type MeetingRecipientRole = 'creator' | 'organizer' | 'participant' | 'representative' | 'observer';

export type MeetingAction = 'created' | 'invite' | 'change' | 'cancel' | 'reminder';

/**
 * Determines which template event_type to use for a meeting notification
 * based on the recipient's role relative to the meeting and the action.
 *
 * - Creator/organizer of a newly created meeting gets 'meeting_created'
 *   (not 'invite' — they created it, they weren't invited).
 * - Representative gets 'meeting_representative_assigned'.
 * - Everyone else gets the action itself ('invite', 'change', 'cancel', 'reminder').
 */
export function getMeetingTemplateKey(
  role: MeetingRecipientRole,
  action: MeetingAction,
): string {
  if (action === 'created' && (role === 'creator' || role === 'organizer')) {
    return 'meeting_created';
  }
  if (role === 'representative') {
    return 'meeting_representative_assigned';
  }
  return action;
}

// ─── Meeting payload ───────────────────────────────────────────────────────────

export interface MeetingTemplatePayload {
  full_name: string;
  meeting_subject: string;
  meeting_date: string;
  start_time: string;
  end_time: string;
  meeting_time: string;
  location?: string;
  location_part?: string;
  join_link?: string;
  organizer_name?: string;
  representative?: string;
  agenda?: string;
}

/**
 * Builds a standardised meeting payload from raw meeting data.
 * All optional fields that are empty produce empty strings (not undefined),
 * so the caller can safely spread the result into template vars.
 */
export function buildMeetingPayload(params: {
  recipientName: string;
  subject: string;
  dateStr: string;
  startTime: string;
  endTime: string;
  location?: string;
  joinLink?: string;
  organizerName?: string;
  representative?: string;
  agenda?: string;
}): Record<string, string> {
  const meetingTime = params.startTime && params.endTime
    ? `${params.startTime}-${params.endTime}`
    : params.startTime || '';
  const location = params.location || '';
  return {
    full_name: params.recipientName,
    meeting_subject: params.subject,
    meeting_date: params.dateStr,
    start_time: params.startTime,
    end_time: params.endTime,
    meeting_time: meetingTime,
    location,
    location_part: location ? ` | ${location}` : '',
    join_link: params.joinLink || '',
    organizer_name: params.organizerName || '',
    representative: params.representative || '',
    agenda: params.agenda || '',
  };
}
