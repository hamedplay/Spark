import { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import moment from 'moment-jalaali';

const JALAALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'
];

export interface MeetingDateTimeFieldsProps {
  requestJalaaliDate: string;
  onRequestJalaaliDateChange: (value: string) => void;

  startTime: string;
  onStartTimeChange: (value: string) => void;

  endTime: string;
  onEndTimeChange: (value: string) => void;
}

export function MeetingDateTimeFields({
  requestJalaaliDate,
  onRequestJalaaliDateChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
}: MeetingDateTimeFieldsProps) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [datePickerJy, setDatePickerJy] = useState(() => moment().jYear());
  const [datePickerJm, setDatePickerJm] = useState(() => moment().jMonth() + 1);
  const datePickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDatePicker) return;
    const h = (e: MouseEvent) => { if (datePickerRef.current && !datePickerRef.current.contains(e.target as Node)) setShowDatePicker(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [showDatePicker]);

  return (
    <div className="md:col-span-2">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
        <Calendar className="w-4 h-4" />تاریخ و زمان جلسه
      </p>
      <div className="space-y-3">
        {/* Row 1 — Date picker */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">تاریخ (شمسی)</label>
          <div className="relative" ref={datePickerRef}>
            <button
              type="button"
              onClick={() => {
                if (!showDatePicker && requestJalaaliDate) {
                  const parts = requestJalaaliDate.split('/').map(Number);
                  if (parts.length === 3 && parts[0] > 1300) { setDatePickerJy(parts[0]); setDatePickerJm(parts[1]); }
                }
                setShowDatePicker(v => !v);
              }}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-right flex items-center justify-between hover:border-blue-400 transition-colors"
            >
              <span className={requestJalaaliDate ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>
                {requestJalaaliDate || 'انتخاب تاریخ...'}
              </span>
              <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
            </button>
            {showDatePicker && (
              <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-3 w-64">
                <div className="flex items-center justify-between mb-2">
                  <button type="button" onClick={() => { if (datePickerJm > 1) setDatePickerJm(m => m - 1); else { setDatePickerJm(12); setDatePickerJy(y => y - 1); } }}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronRight className="w-4 h-4 dark:text-white" /></button>
                  <span className="text-sm font-semibold dark:text-white">{JALAALI_MONTHS[datePickerJm - 1]} {datePickerJy}</span>
                  <button type="button" onClick={() => { if (datePickerJm < 12) setDatePickerJm(m => m + 1); else { setDatePickerJm(1); setDatePickerJy(y => y + 1); } }}
                    className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronLeft className="w-4 h-4 dark:text-white" /></button>
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map(d => <div key={d} className="text-center text-[10px] text-gray-400 py-0.5">{d}</div>)}
                  {(() => {
                    const daysInMonth = datePickerJm <= 6 ? 31 : datePickerJm <= 11 ? 30 : 29;
                    const firstDay = moment(`${datePickerJy}/${datePickerJm}/1`, 'jYYYY/jM/jD').day();
                    const offset = firstDay === 6 ? 0 : firstDay + 1;
                    const cells: React.ReactNode[] = [];
                    for (let i = 0; i < offset; i++) cells.push(<div key={`e${i}`} />);
                    for (let d = 1; d <= daysInMonth; d++) {
                      const jDate = `${datePickerJy}/${String(datePickerJm).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
                      const isSelected = requestJalaaliDate === jDate;
                      cells.push(
                        <button key={d} type="button" onClick={() => { onRequestJalaaliDateChange(jDate); setShowDatePicker(false); }}
                          className={`text-xs py-1 rounded transition-colors ${isSelected ? 'bg-blue-500 text-white' : 'hover:bg-blue-100 dark:hover:bg-blue-900/30 dark:text-white'}`}>{d}</button>
                      );
                    }
                    return cells;
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
        {/* Row 2 — Start time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ساعت شروع</label>
          <div className="relative">
            <input
              type="time"
              value={startTime}
              onChange={(e) => onStartTimeChange(e.target.value)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
        </div>
        {/* Row 3 — End time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ساعت پایان</label>
          <div className="relative">
            <input
              type="time"
              value={endTime}
              onChange={(e) => onEndTimeChange(e.target.value)}
              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
