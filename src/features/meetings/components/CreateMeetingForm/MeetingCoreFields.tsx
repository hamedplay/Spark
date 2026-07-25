import { Calendar, Clock } from 'lucide-react';
import { MeetingDateTimeFields } from './MeetingDateTimeFields';

export interface MeetingCalendarOption {
  id: string;
  name: string;
  color: string;
  type: 'private' | 'public' | 'shared';
}

export interface MeetingScheduleDate {
  jy: number;
  jm: number;
  jd: number;
}

const JALAALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

export interface MeetingCoreFieldsProps {
  subject: string;
  onSubjectChange: (value: string) => void;

  calendars: MeetingCalendarOption[];
  selectedCalendarId: string;
  onSelectedCalendarIdChange: (value: string) => void;

  prefillMeetingId: string | null;
  isSchedulingFromCalendar: boolean;
  scheduleDate: MeetingScheduleDate | null;

  startTime: string;
  onStartTimeChange: (value: string) => void;

  endTime: string;
  onEndTimeChange: (value: string) => void;

  requestJalaaliDate: string;
  onRequestJalaaliDateChange: (value: string) => void;

  requestDuration: string;
  onRequestDurationChange: (value: string) => void;

  location: string;
  onLocationChange: (value: string) => void;
}

export function MeetingCoreFields({
  subject,
  onSubjectChange,
  calendars,
  selectedCalendarId,
  onSelectedCalendarIdChange,
  prefillMeetingId,
  isSchedulingFromCalendar,
  scheduleDate,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  requestJalaaliDate,
  onRequestJalaaliDateChange,
  requestDuration,
  onRequestDurationChange,
  location,
  onLocationChange,
}: MeetingCoreFieldsProps) {
  return (
    <>
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">موضوع جلسه</label>
        <input required type="text" value={subject} onChange={(e) => onSubjectChange(e.target.value)}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
      </div>

      {calendars.length > 0 && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تقویم جلسه</label>
          <div className="relative">
            <select value={selectedCalendarId} onChange={(e) => onSelectedCalendarIdChange(e.target.value)}
              className="w-full p-2 pr-8 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white appearance-none">
              <option value="">بدون تقویم</option>
              {calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {selectedCalendarId && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 rounded-full" style={{ backgroundColor: calendars.find(c => c.id === selectedCalendarId)?.color || '#3b82f6' }} />
            )}
          </div>
        </div>
      )}

      {isSchedulingFromCalendar && scheduleDate && startTime && endTime ? (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ جلسه</label>
            <div className="p-2 border border-teal-300 dark:border-teal-600 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-800 dark:text-teal-300 font-medium text-sm">
              {scheduleDate.jd} {JALAALI_MONTHS[scheduleDate.jm - 1]} {scheduleDate.jy}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">زمان جلسه</label>
            <div className="flex items-center gap-2 p-2 border border-teal-300 dark:border-teal-600 rounded-lg bg-teal-50 dark:bg-teal-900/20 text-teal-800 dark:text-teal-300 font-medium text-sm">
              <Clock className="w-4 h-4 shrink-0" />
              <span>{startTime}</span><span className="text-teal-500">تا</span><span>{endTime}</span>
            </div>
          </div>
        </>
      ) : prefillMeetingId ? (
        <MeetingDateTimeFields
          requestJalaaliDate={requestJalaaliDate}
          onRequestJalaaliDateChange={onRequestJalaaliDateChange}
          startTime={startTime}
          onStartTimeChange={onStartTimeChange}
          endTime={endTime}
          onEndTimeChange={onEndTimeChange}
        />
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ درخواست (شمسی)</label>
            <div className="relative">
              <input type="text" value={requestJalaaliDate} onChange={(e) => onRequestJalaaliDateChange(e.target.value)}
                placeholder="1405/03/01" className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white"
                disabled={isSchedulingFromCalendar} />
              <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-4 h-4" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">مدت زمان درخواستی</label>
            <select value={requestDuration} onChange={(e) => onRequestDurationChange(e.target.value)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white">
              <option value="30 دقیقه">30 دقیقه</option>
              <option value="45 دقیقه">45 دقیقه</option>
              <option value="1 ساعت">1 ساعت</option>
              <option value="1.5 ساعت">1.5 ساعت</option>
              <option value="2 ساعت">2 ساعت</option>
              <option value="3 ساعت">3 ساعت</option>
              <option value="نیم روز">نیم روز</option>
              <option value="یک روز">یک روز</option>
            </select>
          </div>
        </>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">محل برگزاری</label>
        <input required type="text" value={location} onChange={(e) => onLocationChange(e.target.value)}
          className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white" />
      </div>
    </>
  );
}
