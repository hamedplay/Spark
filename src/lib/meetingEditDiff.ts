import type { AgendaItem } from '../types';

export type MeetingChangeSet = {
  importantFields: string[];
  minorFields: string[];
  participantChanged: boolean;
  notifyUsersChanged: boolean;
  externalChanged: boolean;
  hasNonParticipantChanges: boolean;
  hasAnyChanges: boolean;
};

export interface ParticipantDiff {
  added: string[];
  retained: string[];
  removed: string[];
}

export interface ObserverDiff {
  added: string[];
  retained: string[];
  removed: string[];
}

export interface ExternalDiff {
  added: string[];
  retained: string[];
  removed: string[];
}

export interface NotificationPlanEvent {
  recipientId: string;
  role: 'participants' | 'observers' | 'external';
  action: 'invite' | 'change' | 'cancel';
  eventKey: string;
  meetingId: string;
}

export interface NotificationPlan {
  events: NotificationPlanEvent[];
  creatorEvent: { recipientId: string; eventKey: string } | null;
}

const IMPORTANT_FIELDS = ['subject', 'request_date', 'start_time', 'end_time', 'location', 'conference_room_id', 'is_online'] as const;
const MINOR_FIELDS = ['phone', 'representative', 'meeting_manager', 'notes', 'priority', 'reminder_minutes', 'calendar_id', 'send_sms', 'members_only', 'repeat_type', 'repeat_interval', 'repeat_end_date', 'repeat_weekday', 'agenda_items'] as const;

export const FIELD_LABELS: Record<string, string> = {
  subject: 'موضوع جلسه',
  request_date: 'تاریخ جلسه',
  start_time: 'ساعت شروع',
  end_time: 'ساعت پایان',
  location: 'محل برگزاری',
  is_online: 'نوع برگزاری',
  conference_room_id: 'اتاق جلسه آنلاین',
  phone: 'شماره تماس',
  representative: 'نماینده',
  meeting_manager: 'مدیر جلسه',
  notes: 'توضیحات',
  priority: 'اولویت',
  reminder_minutes: 'تنظیمات یادآوری',
  calendar_id: 'تقویم انتخابی',
  send_sms: 'تنظیمات ارسال پیامک',
  members_only: 'نمایش فقط برای اعضا',
  repeat_type: 'تنظیمات تکرار',
  agenda: 'دستور جلسه',
  external_participants: 'شرکت‌کنندگان خارجی',
};

function normalizeStr(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

export const normalizeExternalName = (value: string): string =>
  (value || '').trim().replace(/\s+/g, ' ').toLowerCase();

function externalArraysEqual(a: string[], b: string[]): boolean {
  const sa = new Set(a.map(normalizeExternalName).filter((x: string) => !!x));
  const sb = new Set(b.map(normalizeExternalName).filter((x: string) => !!x));
  if (sa.size !== sb.size) return false;
  for (const v of sa) if (!sb.has(v)) return false;
  return true;
}

function agendaItemsEqual(a: AgendaItem[] | null | undefined, b: AgendaItem[] | null | undefined): boolean {
  const norm = (items: AgendaItem[]) => items.map(i =>
    `${(i.title || '').trim()}|${(i.presenter || '').trim()}|${i.duration_minutes ?? ''}`
  ).join('\n');
  return norm(a || []) === norm(b || []);
}

export function computeMeetingChangeSet(existing: Record<string, any>, next: Record<string, any>): MeetingChangeSet {
  const importantFields: string[] = [];
  const minorFields: string[] = [];

  for (const f of IMPORTANT_FIELDS) {
    if (normalizeStr(existing[f]) !== normalizeStr(next[f])) {
      importantFields.push(f);
    }
  }

  for (const f of MINOR_FIELDS) {
    if (f === 'agenda_items') {
      if (!agendaItemsEqual(existing.agenda_items, next.agenda_items)) minorFields.push('agenda');
      continue;
    }
    if (normalizeStr(existing[f]) !== normalizeStr(next[f])) {
      minorFields.push(f);
    }
  }

  const externalChanged = !externalArraysEqual(existing.external_participants || [], next.external_participants || []);

  const prevParticipants = new Set<string>((existing.participant_user_ids || []).filter((x: string) => x));
  const nextParticipants = new Set<string>((next.participant_user_ids || []).filter((x: string) => x));
  const participantChanged =
    prevParticipants.size !== nextParticipants.size ||
    [...nextParticipants].some(id => !prevParticipants.has(id));

  const prevNotify = new Set<string>((existing.notify_users || []).filter((x: string) => x));
  const nextNotify = new Set<string>((next.notify_users || []).filter((x: string) => x));
  const notifyUsersChanged =
    prevNotify.size !== nextNotify.size ||
    [...nextNotify].some(id => !prevNotify.has(id));

  const hasNonParticipantChanges = importantFields.length > 0 || minorFields.length > 0;
  const hasAnyChanges = hasNonParticipantChanges || participantChanged || notifyUsersChanged || externalChanged;

  return { importantFields, minorFields, participantChanged, notifyUsersChanged, externalChanged, hasNonParticipantChanges, hasAnyChanges };
}

export function computeParticipantDiff(prevIds: string[], nextIds: string[]): ParticipantDiff {
  const prev = new Set(prevIds.filter(x => !!x));
  const next = new Set(nextIds.filter(x => !!x));
  return {
    added: [...next].filter(id => !prev.has(id)),
    retained: [...next].filter(id => prev.has(id)),
    removed: [...prev].filter(id => !next.has(id)),
  };
}

export function computeObserverDiff(prevIds: string[], nextIds: string[]): ObserverDiff {
  const prev = new Set(prevIds.filter(x => !!x));
  const next = new Set(nextIds.filter(x => !!x));
  return {
    added: [...next].filter(id => !prev.has(id)),
    retained: [...next].filter(id => prev.has(id)),
    removed: [...prev].filter(id => !next.has(id)),
  };
}

export function computeExternalDiff(prevNames: string[], nextNames: string[]): ExternalDiff {
  const prevSet = new Set(prevNames.map(normalizeExternalName).filter(x => !!x));
  const seen = new Set<string>();
  const next: string[] = [];
  for (const raw of nextNames) {
    const key = normalizeExternalName(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    next.push(raw);
  }
  const nextSet = new Set(next.map(normalizeExternalName));
  return {
    added: next.filter(n => !prevSet.has(normalizeExternalName(n))),
    retained: next.filter(n => prevSet.has(normalizeExternalName(n))),
    removed: prevNames.filter(n => {
      const key = normalizeExternalName(n);
      return !!key && !nextSet.has(key);
    }),
  };
}

export function buildMeetingNotificationPlan(params: {
  operationId: string;
  meetingId: string;
  participantDiff: ParticipantDiff;
  observerDiff: ObserverDiff;
  externalDiff: ExternalDiff;
  changeSet: MeetingChangeSet;
  isFirstSchedule: boolean;
  notifyExistingParticipants: boolean;
  creatorId: string;
}): NotificationPlan {
  const { operationId, meetingId, participantDiff, observerDiff, externalDiff, changeSet, isFirstSchedule, notifyExistingParticipants, creatorId } = params;

  if (!notifyExistingParticipants) {
    return { events: [], creatorEvent: null };
  }

  const events: NotificationPlanEvent[] = [];
  const hasImportantChanges = changeSet.importantFields.length > 0;

  let creatorEvent: { recipientId: string; eventKey: string } | null = null;
  if (isFirstSchedule) {
    creatorEvent = {
      recipientId: creatorId,
      eventKey: `${operationId}:${meetingId}:${creatorId}:creator:created`,
    };
  }

  for (const uid of participantDiff.added) {
    events.push({ recipientId: uid, role: 'participants', action: 'invite', eventKey: `${operationId}:${meetingId}:${uid}:participants:invite`, meetingId });
  }
  for (const uid of participantDiff.removed) {
    events.push({ recipientId: uid, role: 'participants', action: 'cancel', eventKey: `${operationId}:${meetingId}:${uid}:participants:cancel`, meetingId });
  }
  if (!isFirstSchedule && hasImportantChanges) {
    for (const uid of participantDiff.retained) {
      events.push({ recipientId: uid, role: 'participants', action: 'change', eventKey: `${operationId}:${meetingId}:${uid}:participants:change`, meetingId });
    }
  }

  for (const uid of observerDiff.added) {
    events.push({ recipientId: uid, role: 'observers', action: 'invite', eventKey: `${operationId}:${meetingId}:${uid}:observers:invite`, meetingId });
  }
  for (const uid of observerDiff.removed) {
    events.push({ recipientId: uid, role: 'observers', action: 'cancel', eventKey: `${operationId}:${meetingId}:${uid}:observers:cancel`, meetingId });
  }
  if (!isFirstSchedule && hasImportantChanges) {
    for (const uid of observerDiff.retained) {
      events.push({ recipientId: uid, role: 'observers', action: 'change', eventKey: `${operationId}:${meetingId}:${uid}:observers:change`, meetingId });
    }
  }

  for (const name of externalDiff.added) {
    events.push({ recipientId: name, role: 'external', action: 'invite', eventKey: `${operationId}:${meetingId}:${name}:external:invite`, meetingId });
  }
  for (const name of externalDiff.removed) {
    events.push({ recipientId: name, role: 'external', action: 'cancel', eventKey: `${operationId}:${meetingId}:${name}:external:cancel`, meetingId });
  }
  if (!isFirstSchedule && hasImportantChanges) {
    for (const name of externalDiff.retained) {
      events.push({ recipientId: name, role: 'external', action: 'change', eventKey: `${operationId}:${meetingId}:${name}:external:change`, meetingId });
    }
  }

  return { events, creatorEvent };
}
