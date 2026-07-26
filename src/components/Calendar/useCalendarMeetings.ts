import { useMemo } from 'react';
import {
  PRIORITY_COLORS, DEFAULT_CALENDAR_COLOR,
  jalaaliToYYYYMMDD, parseRequestDateToDateStr,
} from './utils';
import type { MeetingData, CalendarEntry } from './types';

export interface CalendarMeetingsInput {
  meetings: MeetingData[];
  enabledCalendarIds: Set<string>;
  calendars: CalendarEntry[];
  subscribedCalendars: CalendarEntry[];
  currentUserId: string | null;
  showPastMeetings: boolean;
  showCancelledMeetings: boolean;
  currentJy: number;
  currentJm: number;
}

export function useCalendarMeetings(input: CalendarMeetingsInput) {
  const {
    meetings, enabledCalendarIds, calendars, subscribedCalendars,
    currentUserId, showPastMeetings, showCancelledMeetings,
    currentJy, currentJm,
  } = input;

  const myPublicCalendar = useMemo(() =>
    calendars.find(c => c.is_personal_public && c.type === 'public') ||
    calendars.find(c => c.type === 'public' && !c.is_occasions) ||
    null,
  [calendars]);

  const getMeetingColor = useMemo(() =>
    (m: MeetingData): string => {
      if (currentUserId && m.user_id !== currentUserId &&
        ((m.participant_user_ids || []).includes(currentUserId) ||
         ((m.notify_users || []) as string[]).includes(currentUserId))) {
        if (myPublicCalendar) return myPublicCalendar.color;
      }
      if (m.calendar_id) {
        const cal = [...calendars, ...subscribedCalendars].find(c => c.id === m.calendar_id);
        if (cal) return cal.color;
      }
      return PRIORITY_COLORS[m.priority || 'medium']?.solid || DEFAULT_CALENDAR_COLOR;
    },
  [calendars, subscribedCalendars, currentUserId, myPublicCalendar]);

  const knownCalendarIds = useMemo(() => {
    const s = new Set<string>();
    calendars.forEach(c => s.add(c.id));
    subscribedCalendars.forEach(c => s.add(c.id));
    return s;
  }, [calendars, subscribedCalendars]);

  const subscribedOwnerCalendarIds = useMemo(() => {
    const map = new Map<string, string[]>();
    subscribedCalendars.forEach(c => {
      if (!map.has(c.user_id)) map.set(c.user_id, []);
      map.get(c.user_id)!.push(c.id);
    });
    return map;
  }, [subscribedCalendars]);

  const isAnyParticipantSubscribed = useMemo(() =>
    (participantIds: string[]) =>
      participantIds.some(uid => {
        const calIds = subscribedOwnerCalendarIds.get(uid) || [];
        return calIds.some(cid => enabledCalendarIds.has(cid));
      }),
  [subscribedOwnerCalendarIds, enabledCalendarIds]);

  const visibleMeetings = useMemo(() => {
    const IST_OFFSET_MS = 210 * 60 * 1000;
    const tehranNow = new Date(Date.now() + IST_OFFSET_MS);
    const todayStr = `${tehranNow.getUTCFullYear()}-${String(tehranNow.getUTCMonth()+1).padStart(2,'0')}-${String(tehranNow.getUTCDate()).padStart(2,'0')}`;
    const result = meetings.filter(m => {
      if (m.status_type !== 'scheduled') return false;
      const dateStr = parseRequestDateToDateStr(m.request_date);
      if (dateStr && dateStr < todayStr && !showPastMeetings) return false;
      if (m.status === 'archived' && m.status_type !== 'scheduled' && !showCancelledMeetings) return false;
      return true;
    });
    console.log('[CalendarPage] visibleMeetings: total=' + meetings.length + ' visible=' + result.length + ' show_past=' + showPastMeetings + ' show_cancelled=' + showCancelledMeetings + ' todayStr(Tehran)=' + todayStr);
    return result;
  }, [meetings, showPastMeetings, showCancelledMeetings]);

  const meetingsByDate = useMemo(() => {
    const map: Record<string, MeetingData[]> = {};
    const calendarsLoaded = enabledCalendarIds.size > 0 || calendars.length > 0;
    let hiddenCalId = 0, hiddenNoCalNoSub = 0, hiddenPublicCalOff = 0;
    visibleMeetings.forEach(m => {
      const isCreator = !!currentUserId && m.user_id === currentUserId;
      const isAssigned = !!currentUserId && !isCreator && (
        (m.participant_user_ids || []).includes(currentUserId) ||
        ((m.notify_users || []) as string[]).includes(currentUserId)
      );

      if (!currentUserId || !calendarsLoaded) {
        const s = parseRequestDateToDateStr(m.request_date);
        if (!s) return;
        if (!map[s]) map[s] = [];
        map[s].push(m);
        return;
      }

      if (isAssigned) {
        if (myPublicCalendar && !enabledCalendarIds.has(myPublicCalendar.id)) { hiddenPublicCalOff++; return; }
        const s = parseRequestDateToDateStr(m.request_date);
        if (!s) return;
        if (!map[s]) map[s] = [];
        map[s].push(m);
        return;
      }

      const allParticipants = [m.user_id, ...(m.participant_user_ids || [])];
      const isViaSubscription = isAnyParticipantSubscribed(allParticipants);

      if (m.calendar_id) {
        if (knownCalendarIds.has(m.calendar_id)) {
          if (!enabledCalendarIds.has(m.calendar_id)) { hiddenCalId++; return; }
        } else if (!isViaSubscription) {
          hiddenCalId++; return;
        }
      } else {
        if (isCreator) {
          if (myPublicCalendar && !enabledCalendarIds.has(myPublicCalendar.id)) { hiddenPublicCalOff++; return; }
        } else {
          if (!isViaSubscription) { hiddenNoCalNoSub++; return; }
          if (m.members_only) return;
        }
      }

      const s = parseRequestDateToDateStr(m.request_date);
      if (!s) return;
      if (!map[s]) map[s] = [];
      map[s].push(m);
    });
    const shown = Object.values(map).reduce((a, arr) => a + arr.length, 0);
    const mapKeys = Object.keys(map).slice(0, 5);
    const sampleGridKey1 = jalaaliToYYYYMMDD(currentJy || 1405, currentJm || 4, 1);
    const sampleGridKey2 = jalaaliToYYYYMMDD(currentJy || 1405, currentJm || 4, 15);
    console.log('[CalendarPage] meetingsByDate recomputed: visibleMeetings=' + visibleMeetings.length + ' shown=' + shown + ' hiddenCalId=' + hiddenCalId + ' hiddenNoCalNoSub=' + hiddenNoCalNoSub + ' hiddenPublicCalOff=' + hiddenPublicCalOff + ' currentUserId=' + currentUserId + ' enabledCalendarIds.size=' + enabledCalendarIds.size + ' calendarsLoaded=' + calendarsLoaded + ' myPublicCalendar=' + myPublicCalendar?.id);
    console.log('[CalendarPage] meetingsByDate keys (sample):', mapKeys, '| grid lookup key for day 1:', sampleGridKey1, '| day 15:', sampleGridKey2, '| currentJy/Jm:', currentJy, currentJm);
    return map;
  }, [visibleMeetings, enabledCalendarIds, calendars, currentUserId, isAnyParticipantSubscribed, myPublicCalendar, currentJy, currentJm]);

  const getMeetings = useMemo(() =>
    (jy: number, jm: number, jd: number): MeetingData[] =>
      meetingsByDate[jalaaliToYYYYMMDD(jy, jm, jd)] || [],
  [meetingsByDate]);

  return {
    myPublicCalendar,
    getMeetingColor,
    visibleMeetings,
    meetingsByDate,
    getMeetings,
  };
}
