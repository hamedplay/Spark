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
  { key: 'auth',     label: 'احراز هویت' },
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
  { key: 'meeting_created',                  label: 'ثبت جلسه' },
  { key: 'meeting_confirmed',                label: 'تأیید جلسه' },
  { key: 'meeting_declined',                 label: 'رد جلسه' },
  { key: 'meeting_representative_assigned',  label: 'انتخاب به‌عنوان جانشین' },
  { key: 'login_otp',     label: 'کد ورود' },
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
  { key: 'full_name',           label: 'نام کامل گیرنده',      example: 'علی احمدی' },
  { key: 'recipient_greeting',  label: 'احوال‌پرسی گیرنده',     example: 'علی احمدی گرامی' },
  { key: 'meeting_subject',  label: 'موضوع جلسه',            example: 'جلسه هیئت مدیره' },
  { key: 'meeting_date',     label: 'تاریخ جلسه',            example: '۱۴۰۳/۰۳/۱۵' },
  { key: 'start_time',       label: 'ساعت شروع',              example: '۰۹:۰۰' },
  { key: 'end_time',         label: 'ساعت پایان',             example: '۱۰:۰۰' },
  { key: 'meeting_time',     label: 'بازه ساعت جلسه',         example: '۰۹:۰۰-۱۰:۰۰' },
  { key: 'location',         label: 'محل برگزاری',            example: 'سالن اجتماعات' },
  { key: 'location_part',    label: 'بخش محل (با خط فاصله)',  example: ' | سالن اجتماعات' },
  { key: 'join_link',        label: 'لینک ورود',              example: 'https://...' },
  { key: 'organizer_name',   label: 'نام تنظیم‌کننده جلسه',   example: 'سارا رضایی' },
  { key: 'representative',           label: 'نماینده',                example: 'رضا کریمی' },
  { key: 'represented_person_name',  label: 'نام فرد جانشین‌شده',      example: 'محمد رضایی' },
  { key: 'participant_name',         label: 'نام شرکت‌کننده',          example: 'علی احمدی' },
  { key: 'agenda',                   label: 'دستور جلسه',             example: '۱. بررسی گزارش...' },
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
  { key: 'otp',              label: 'کد یک‌بارمصرف',           example: '123456' },
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

export interface RenderTemplateResult {
  text: string;
  missingPlaceholders: string[];
  unresolvedPlaceholders: string[];
}

/**
 * Replaces `{{placeholder}}` tokens in a template string with values from `vars`.
 *
 * - Missing/empty values are replaced with '' and collected in `missingPlaceholders`.
 * - Any `{{...}}` tokens that survive the replace (e.g. malformed) are collected
 *   in `unresolvedPlaceholders`.
 * - The rendered text never contains `undefined` or `null`.
 *
 * In development, missing required placeholders are logged via console.warn.
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
): RenderTemplateResult {
  const missingPlaceholders: string[] = [];

  const text = template.replace(
    /{{\s*([a-zA-Z0-9_]+)\s*}}/g,
    (_match, key: string) => {
      const value = vars[key];
      if (value === undefined || value === null || String(value).trim() === '') {
        missingPlaceholders.push(key);
        return '';
      }
      return String(value);
    },
  );

  const unresolvedPlaceholders = Array.from(
    text.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g),
    (m: RegExpMatchArray) => m[1],
  );

  if (import.meta.env?.DEV && missingPlaceholders.length > 0) {
    console.warn('[notification-template] missing placeholder(s):',
      missingPlaceholders.join(', '));
  }

  return {
    text,
    missingPlaceholders: [...new Set(missingPlaceholders)],
    unresolvedPlaceholders: [...new Set(unresolvedPlaceholders)],
  };
}

/**
 * Backward-compatible wrapper: returns `{ rendered, leftover }`.
 * `leftover` combines both missing and unresolved placeholders.
 */
export function renderTemplateLegacy(
  template: string,
  vars: Record<string, string>,
): { rendered: string; leftover: string[] } {
  const result = renderTemplate(template, vars);
  return {
    rendered: result.text,
    leftover: [...result.missingPlaceholders, ...result.unresolvedPlaceholders],
  };
}

// ─── Meeting recipient role & template key ────────────────────────────────────

export type MeetingRecipientRole = 'creator' | 'organizer' | 'participant' | 'representative' | 'observer';

export type MeetingAction = 'created' | 'invite' | 'change' | 'cancel' | 'reminder' | 'confirmed' | 'declined';

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
  if (action === 'confirmed') {
    return 'meeting_confirmed';
  }
  if (action === 'declined') {
    return 'meeting_declined';
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
  const fullName = params.recipientName || '';
  const greeting = fullName ? `${fullName} گرامی` : 'همکار گرامی';
  return {
    full_name: fullName,
    recipient_greeting: greeting,
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

/**
 * Resolves a recipient's display name from multiple possible fields.
 * Returns empty string if none are available.
 */
export function resolveRecipientFullName(recipient: {
  full_name?: string | null;
  display_name?: string | null;
  name?: string | null;
}): string {
  return (
    recipient.full_name?.trim() ||
    recipient.display_name?.trim() ||
    recipient.name?.trim() ||
    ''
  );
}

/**
 * Required placeholders for meeting invite templates.
 * `location` is optional — it may appear in the template but is not required.
 */
export const REQUIRED_MEETING_INVITE_PLACEHOLDERS = [
  'full_name',
  'meeting_subject',
  'meeting_date',
  'start_time',
  'end_time',
  'organizer_name',
];

// ─── Event Definition Catalog ─────────────────────────────────────────────────

export interface TemplateEventDefinition {
  key: string;
  category: string;
  label: string;
  supportedChannels: Array<'notification' | 'sms'>;
  audiences: string[];
  requiredPlaceholders: string[];
  optionalPlaceholders: string[];
}

export const TEMPLATE_EVENTS: TemplateEventDefinition[] = [
  // Meeting events
  {
    key: 'meeting_created',
    category: 'meeting',
    label: 'ثبت جلسه',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['meeting_subject', 'meeting_date', 'start_time', 'end_time'],
    optionalPlaceholders: ['location', 'organizer_name', 'join_link', 'recipient_greeting', 'full_name', 'location_part'],
  },
  {
    key: 'invite',
    category: 'meeting',
    label: 'دعوت به جلسه',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all', 'participants', 'observers', 'external'],
    requiredPlaceholders: ['meeting_subject', 'meeting_date', 'start_time', 'end_time'],
    optionalPlaceholders: ['location', 'organizer_name', 'join_link', 'recipient_greeting', 'full_name', 'location_part', 'meeting_time'],
  },
  {
    key: 'meeting_confirmed',
    category: 'meeting',
    label: 'تأیید جلسه',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all', 'organizer'],
    requiredPlaceholders: ['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'participant_name'],
    optionalPlaceholders: ['location', 'organizer_name', 'join_link', 'recipient_greeting', 'full_name'],
  },
  {
    key: 'meeting_declined',
    category: 'meeting',
    label: 'رد جلسه',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all', 'organizer'],
    requiredPlaceholders: ['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'participant_name'],
    optionalPlaceholders: ['location', 'organizer_name', 'recipient_greeting', 'full_name'],
  },
  {
    key: 'change',
    category: 'meeting',
    label: 'تغییر جلسه',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all', 'participants', 'observers', 'external'],
    requiredPlaceholders: ['meeting_subject', 'meeting_date', 'start_time', 'end_time'],
    optionalPlaceholders: ['location', 'organizer_name', 'join_link', 'recipient_greeting', 'full_name', 'location_part', 'meeting_time'],
  },
  {
    key: 'cancel',
    category: 'meeting',
    label: 'لغو جلسه',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all', 'participants', 'observers'],
    requiredPlaceholders: ['meeting_subject', 'meeting_date'],
    optionalPlaceholders: ['start_time', 'end_time', 'location', 'organizer_name', 'recipient_greeting', 'full_name', 'location_part', 'meeting_time'],
  },
  {
    key: 'reminder',
    category: 'meeting',
    label: 'یادآوری جلسه',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all', 'participants', 'observers'],
    requiredPlaceholders: ['meeting_subject', 'minutes'],
    optionalPlaceholders: ['meeting_date', 'start_time', 'end_time', 'location', 'recipient_greeting', 'full_name', 'location_part'],
  },
  {
    key: 'meeting_representative_assigned',
    category: 'meeting',
    label: 'انتخاب به‌عنوان جانشین',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all', 'representative'],
    requiredPlaceholders: ['meeting_subject', 'meeting_date', 'start_time', 'end_time', 'represented_person_name'],
    optionalPlaceholders: ['location', 'organizer_name', 'join_link', 'recipient_greeting', 'full_name', 'location_part', 'meeting_time'],
  },
  // Task events
  {
    key: 'assign',
    category: 'task',
    label: 'تخصیص اقدام',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['task_title'],
    optionalPlaceholders: ['priority', 'due_date', 'sender_name', 'recipient_greeting', 'full_name'],
  },
  {
    key: 'complete',
    category: 'task',
    label: 'تکمیل اقدام',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['task_title'],
    optionalPlaceholders: ['sender_name'],
  },
  {
    key: 'reminder',
    category: 'task',
    label: 'یادآوری اقدام',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['task_title'],
    optionalPlaceholders: ['due_date'],
  },
  // Chat events
  {
    key: 'message',
    category: 'chat',
    label: 'پیام چت',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['sender_name', 'message_preview'],
    optionalPlaceholders: ['recipient_greeting', 'full_name'],
  },
  {
    key: 'mention',
    category: 'chat',
    label: 'منشن در چت',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['sender_name', 'message_preview'],
    optionalPlaceholders: ['recipient_greeting', 'full_name'],
  },
  // Channel events
  {
    key: 'new_message',
    category: 'channel',
    label: 'پیام جدید در کانال',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['sender_name', 'message_preview'],
    optionalPlaceholders: ['channel_name', 'channel_type'],
  },
  {
    key: 'mention',
    category: 'channel',
    label: 'منشن در کانال',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['sender_name', 'message_preview'],
    optionalPlaceholders: ['channel_name', 'channel_type'],
  },
  {
    key: 'member_added',
    category: 'channel',
    label: 'افزودن عضو',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['channel_name', 'channel_type'],
    optionalPlaceholders: [],
  },
  // Note events
  {
    key: 'share',
    category: 'note',
    label: 'اشتراک یادداشت',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['note_title', 'sender_name'],
    optionalPlaceholders: ['recipient_greeting', 'full_name'],
  },
  // Report events
  {
    key: 'report_ready',
    category: 'report',
    label: 'گزارش آماده شد',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['report_title'],
    optionalPlaceholders: ['report_link', 'recipient_greeting', 'full_name'],
  },
  // System events
  {
    key: 'alert',
    category: 'system',
    label: 'هشدار سیستم',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['alert_message'],
    optionalPlaceholders: [],
  },
  // Auth events
  {
    key: 'login_otp',
    category: 'auth',
    label: 'کد ورود موبایلی',
    supportedChannels: ['sms'],
    audiences: ['all'],
    requiredPlaceholders: ['otp'],
    optionalPlaceholders: [],
  },
  // Calendar events
  {
    key: 'event_invite',
    category: 'calendar',
    label: 'دعوت رویداد',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['event_title', 'event_date'],
    optionalPlaceholders: ['recipient_greeting', 'full_name'],
  },
  {
    key: 'reminder',
    category: 'calendar',
    label: 'یادآوری رویداد',
    supportedChannels: ['notification', 'sms'],
    audiences: ['all'],
    requiredPlaceholders: ['event_title', 'event_date'],
    optionalPlaceholders: ['recipient_greeting', 'full_name'],
  },
];

// ─── Template Validation ─────────────────────────────────────────────────────

export interface TemplateValidationResult {
  valid: boolean;
  missingRequiredPlaceholders: string[];
  unknownPlaceholders: string[];
  unusedPayloadPlaceholders: string[];
}

export function validateTemplateForEvent(
  body: string,
  event: TemplateEventDefinition,
  knownPlaceholders: string[],
): TemplateValidationResult {
  const used = extractPlaceholders(body);

  const missingRequiredPlaceholders = event.requiredPlaceholders.filter(
    key => !used.includes(key),
  );

  const unknownPlaceholders = used.filter(
    key => !knownPlaceholders.includes(key),
  );

  const allowed = [
    ...event.requiredPlaceholders,
    ...event.optionalPlaceholders,
  ];

  const unusedPayloadPlaceholders = allowed.filter(
    key => !used.includes(key),
  );

  return {
    valid:
      missingRequiredPlaceholders.length === 0 &&
      unknownPlaceholders.length === 0,
    missingRequiredPlaceholders,
    unknownPlaceholders,
    unusedPayloadPlaceholders,
  };
}

// ─── Payload Validation ───────────────────────────────────────────────────────

export interface PayloadValidationResult {
  valid: boolean;
  missingRequiredValues: string[];
  emptyRequiredValues: string[];
}

export function validatePayloadForEvent(
  eventType: string,
  payload: Record<string, string>,
): PayloadValidationResult {
  const eventDef = TEMPLATE_EVENTS.find(e => e.key === eventType);
  if (!eventDef) {
    return { valid: true, missingRequiredValues: [], emptyRequiredValues: [] };
  }

  const missingRequiredValues = eventDef.requiredPlaceholders.filter(
    key => !(key in payload),
  );

  const emptyRequiredValues = eventDef.requiredPlaceholders.filter(
    key => key in payload && (!payload[key] || String(payload[key]).trim() === ''),
  );

  return {
    valid: missingRequiredValues.length === 0 && emptyRequiredValues.length === 0,
    missingRequiredValues,
    emptyRequiredValues,
  };
}
