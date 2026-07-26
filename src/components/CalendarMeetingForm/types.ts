import type { MeetingChangeSet, ParticipantDiff, ObserverDiff, ExternalDiff, NotificationPlan } from '../../lib/meetingEditDiff';
import type { AgendaItem } from '../../types';

export interface CalendarEntry {
  id: string;
  name: string;
  color: string;
  type: 'private' | 'public' | 'shared';
  user_id?: string;
  is_occasions?: boolean;
  is_personal_public?: boolean;
}

export type CommitSnapshot = {
  operationId: string;
  updateRecord: Record<string, any>;
  baseFields: Record<string, any> | null;
  isFirstSchedule: boolean;
  senderName: string;
  meetingDateStr: string;
  meetingTimeStr: string;
  smsPlaceholders: Record<string, string>;
  agendaSummary: string;
  participantNameMap: Record<string, string>;
  observerIds: string[];
  prevNotifyUserIds: string[];
  previousNotifyUserIdsByMeetingId: Record<string, string[]>;
  changeSetsByMeetingId: Record<string, MeetingChangeSet>;
  prevAgendaByMeetingId: Record<string, AgendaItem[]>;
  joinLink: string;
  gregDate: string;
  selectedParticipantIds: string[];
  selectedExternal: string[];
  sendSms: boolean;
  agendaEnabled: boolean;
  agendaItems: AgendaItem[];
  prevExternalByMeetingId: Record<string, string[]>;
  isOnline: boolean;
  wasOnline: boolean;
  prevRoomId: string | null;
  prevParticipantIds: string[];
  prevObserverIds: string[];
};

export interface CalendarMeetingFormProps {
  onSuccess: (subject?: string, isUpdate?: boolean) => void;
  onCancel: () => void;
  calendars?: CalendarEntry[];
  prefillData?: {
    subject?: string;
    location?: string;
    representative?: string;
    phone?: string;
    notes?: string;
    priority?: string;
    meetingId?: string;
    startTime?: string;
    endTime?: string;
    dateJy?: number;
    dateJm?: number;
    dateJd?: number;
    calendarId?: string;
    membersOnly?: boolean;
    participantUserIds?: string[];
    repeatEnabled?: boolean;
    repeatType?: 'weekly' | 'monthly';
    repeatInterval?: number;
    repeatEndDate?: string;
    repeatWeekday?: number;
    editAllIds?: string[];
  } | null;
}

export const JALAALI_MONTHS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];
export const JALAALI_WEEKDAYS = ['شنبه','یکشنبه','دوشنبه','سه‌شنبه','چهارشنبه','پنج‌شنبه','جمعه'];
