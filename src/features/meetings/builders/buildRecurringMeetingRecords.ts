import moment from 'moment-jalaali';

import type {
  MeetingPersistenceRecord,
  MeetingPersistenceRepeatType,
} from '../types/meetingPersistence';

export type MeetingRepeatMonthlyMode =
  | 'specific'
  | 'first'
  | 'last';

type EnabledRepeatType =
  Exclude<MeetingPersistenceRepeatType, 'none'>;

export type RecurringMeetingBaseRecord =
  MeetingPersistenceRecord & {
    id?: string;
  };

export interface BuildRecurringMeetingRecordsInput {
  baseRecord: RecurringMeetingBaseRecord;

  repeatType: EnabledRepeatType;
  repeatInterval: number;
  repeatEndDate: string;
  repeatWeekday: number;

  repeatMonthlyMode:
    MeetingRepeatMonthlyMode;

  repeatMonthlyWeekday: number;
}

export function buildRecurringMeetingRecords(
  input: BuildRecurringMeetingRecordsInput
): MeetingPersistenceRecord[] {
  const type = input.repeatType;
  const interval = input.repeatInterval;
  const endDate = input.repeatEndDate;

  let endMs: number;
  if (endDate.includes('/') && endDate.split('/').length === 3) {
    const [jy, jm, jd] = endDate.split('/').map(Number);
    const gregDate = moment(`${jy}/${jm}/${jd}`, 'jYYYY/jM/jD').toDate();
    gregDate.setHours(23, 59, 59, 999);
    endMs = gregDate.getTime();
  } else {
    endMs = new Date(endDate).getTime();
  }
  if (isNaN(endMs)) return [];

  const baseDate = new Date(input.baseRecord.request_date);
  const {
    id: ignoredRecordId,
    ...baseWithoutId
  } = input.baseRecord;
  void ignoredRecordId;
  const records: MeetingPersistenceRecord[] = [];

  if (type === 'weekly') {
    const jsDayMap = [6, 0, 1, 2, 3, 4, 5];
    const targetJsDay = jsDayMap[input.repeatWeekday];

    let currentDate = new Date(baseDate);
    currentDate.setDate(currentDate.getDate() + 1);
    const diff = (targetJsDay - currentDate.getDay() + 7) % 7;
    currentDate.setDate(currentDate.getDate() + diff);

    while (currentDate.getTime() <= endMs) {
      const jDate = moment(currentDate).format('jYYYY/jMM/jDD');
      records.push({ ...baseWithoutId, request_date: currentDate.toISOString(), request_jalaali_date: jDate, status: 'open' });
      currentDate = new Date(currentDate.getTime() + 7 * interval * 86400000);
    }
  } else if (type === 'monthly') {
    const jsDayMap = [6, 0, 1, 2, 3, 4, 5];

    if (input.repeatMonthlyMode === 'specific') {
      let y = baseDate.getFullYear();
      let mo = baseDate.getMonth() + interval;
      const day = baseDate.getDate();

      while (true) {
        const d = new Date(y, mo, day);
        if (d.getTime() > endMs) break;
        if (d.getTime() > baseDate.getTime()) {
          const jDate = moment(d).format('jYYYY/jMM/jDD');
          records.push({ ...baseWithoutId, request_date: d.toISOString(), request_jalaali_date: jDate, status: 'open' });
        }
        mo += interval;
        if (mo >= 12) { y += Math.floor(mo / 12); mo = mo % 12; }
      }
    } else {
      const targetJsDay = jsDayMap[input.repeatMonthlyWeekday];
      let y = baseDate.getFullYear();
      let mo = baseDate.getMonth() + interval;

      while (true) {
        if (mo >= 12) { y += Math.floor(mo / 12); mo = mo % 12; }
        let targetDate: Date;
        if (input.repeatMonthlyMode === 'first') {
          targetDate = new Date(y, mo, 1);
          while (targetDate.getDay() !== targetJsDay) targetDate.setDate(targetDate.getDate() + 1);
        } else {
          targetDate = new Date(y, mo + 1, 0);
          while (targetDate.getDay() !== targetJsDay) targetDate.setDate(targetDate.getDate() - 1);
        }
        if (targetDate.getTime() > endMs) break;
        if (targetDate.getTime() > baseDate.getTime()) {
          const jDate = moment(targetDate).format('jYYYY/jMM/jDD');
          records.push({ ...baseWithoutId, request_date: targetDate.toISOString(), request_jalaali_date: jDate, status: 'open' });
        }
        mo += interval;
      }
    }
  }

  return records;
}
