import { useState } from 'react';
import { Repeat, Calendar, ChevronLeft, ChevronRight } from 'lucide-react';
import moment from 'moment-jalaali';

type RepeatType = 'weekly' | 'monthly';
type RepeatMonthlyMode = 'specific' | 'first' | 'last';

const JALAALI_MONTHS = [
  'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
  'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند',
];

const JALAALI_WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'];

const MONTHLY_MODE_OPTIONS: Array<{ value: RepeatMonthlyMode; label: string }> = [
  { value: 'specific', label: 'همان روز ماه' },
  { value: 'first', label: 'اولین' },
  { value: 'last', label: 'آخرین' },
];

export interface RecurrenceFieldsProps {
  enabled: boolean;
  type: RepeatType;
  interval: number;
  endDate: string;
  weekday: number;
  monthlyMode: RepeatMonthlyMode;
  monthlyWeekday: number;

  onEnabledChange: (enabled: boolean) => void;
  onTypeChange: (type: RepeatType) => void;
  onIntervalChange: (interval: number) => void;
  onEndDateChange: (date: string) => void;
  onWeekdayChange: (weekday: number) => void;
  onMonthlyModeChange: (mode: RepeatMonthlyMode) => void;
  onMonthlyWeekdayChange: (weekday: number) => void;
}

export function RecurrenceFields({
  enabled,
  type,
  interval,
  endDate,
  weekday,
  monthlyMode,
  monthlyWeekday,
  onEnabledChange,
  onTypeChange,
  onIntervalChange,
  onEndDateChange,
  onWeekdayChange,
  onMonthlyModeChange,
  onMonthlyWeekdayChange,
}: RecurrenceFieldsProps) {
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  const [endDatePickerJy, setEndDatePickerJy] = useState(() => moment().jYear());
  const [endDatePickerJm, setEndDatePickerJm] = useState(() => moment().jMonth() + 1);

  return (
    <div className="mt-5 p-4 bg-gray-50 dark:bg-gray-700/30 rounded-lg border border-gray-200 dark:border-gray-600">
      <div className="flex items-center gap-2 mb-3">
        <input type="checkbox" id="repeatToggle" checked={enabled} onChange={(e) => onEnabledChange(e.target.checked)} className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500" />
        <label htmlFor="repeatToggle" className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Repeat className="w-4 h-4" /> تکرار جلسه
        </label>
      </div>
      {enabled && (
        <div className="space-y-3 mt-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع تکرار</label>
              <select value={type} onChange={(e) => onTypeChange(e.target.value as RepeatType)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                <option value="weekly">هفتگی</option><option value="monthly">ماهیانه</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">هر چند</label>
              <select value={interval} onChange={(e) => onIntervalChange(Number(e.target.value))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                {[1, 2, 3, 4].map(n => <option key={n} value={n}>هر {n} {type === 'weekly' ? 'هفته' : 'ماه'}</option>)}
              </select>
            </div>
            <div className="relative">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">تا تاریخ (شمسی)</label>
              <div className="flex gap-1">
                <input type="text" value={endDate} onChange={(e) => onEndDateChange(e.target.value)} placeholder="مثال: 1405/06/31"
                  className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
                <button type="button" onClick={() => setShowEndDatePicker(!showEndDatePicker)}
                  className="px-2 py-1 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                  <Calendar className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                </button>
              </div>
              {showEndDatePicker && (
                <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-3 w-64">
                  <div className="flex items-center justify-between mb-2">
                    <button type="button" onClick={() => { if (endDatePickerJm > 1) setEndDatePickerJm(m => m - 1); else { setEndDatePickerJm(12); setEndDatePickerJy(y => y - 1); } }}
                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                      <ChevronRight className="w-4 h-4 dark:text-white" />
                    </button>
                    <span className="text-sm font-semibold dark:text-white">{JALAALI_MONTHS[endDatePickerJm - 1]} {endDatePickerJy}</span>
                    <button type="button" onClick={() => { if (endDatePickerJm < 12) setEndDatePickerJm(m => m + 1); else { setEndDatePickerJm(1); setEndDatePickerJy(y => y + 1); } }}
                      className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                      <ChevronLeft className="w-4 h-4 dark:text-white" />
                    </button>
                  </div>
                  <div className="grid grid-cols-7 gap-0.5">
                    {['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'].map(d => <div key={d} className="text-center text-[10px] text-gray-400 py-0.5">{d}</div>)}
                    {(() => {
                      const daysInMonth = endDatePickerJm <= 6 ? 31 : endDatePickerJm <= 11 ? 30 : 29;
                      const firstDay = moment(`${endDatePickerJy}/${endDatePickerJm}/1`, 'jYYYY/jM/jD').day();
                      const offset = firstDay === 6 ? 0 : firstDay + 1;
                      const cells: React.ReactNode[] = [];
                      for (let i = 0; i < offset; i++) cells.push(<div key={`e${i}`} />);
                      for (let d = 1; d <= daysInMonth; d++) {
                        const jDate = `${endDatePickerJy}/${String(endDatePickerJm).padStart(2, '0')}/${String(d).padStart(2, '0')}`;
                        cells.push(
                          <button key={d} type="button" onClick={() => { onEndDateChange(jDate); setShowEndDatePicker(false); }}
                            className={`text-xs py-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors ${endDate === jDate ? 'bg-blue-500 text-white' : 'dark:text-white'}`}>
                            {d}
                          </button>
                        );
                      }
                      return cells;
                    })()}
                  </div>
                </div>
              )}
            </div>
          </div>

          {type === 'weekly' && (
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">روز هفته</label>
              <div className="flex flex-wrap gap-1.5">
                {JALAALI_WEEKDAYS.map((day, i) => (
                  <button key={i} type="button" onClick={() => onWeekdayChange(i)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${weekday === i ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500'}`}>
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}

          {type === 'monthly' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع تکرار ماهیانه</label>
                <div className="flex gap-2">
                  {MONTHLY_MODE_OPTIONS.map(opt => (
                    <button key={opt.value} type="button" onClick={() => onMonthlyModeChange(opt.value)}
                      className={`flex-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-colors ${monthlyMode === opt.value ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
              {(monthlyMode === 'first' || monthlyMode === 'last') && (
                <div>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">
                    {monthlyMode === 'first' ? 'اولین' : 'آخرین'} روز هفته
                  </label>
                  <div className="flex flex-wrap gap-1.5">
                    {JALAALI_WEEKDAYS.map((day, i) => (
                      <button key={i} type="button" onClick={() => onMonthlyWeekdayChange(i)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${monthlyWeekday === i ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
                        {day}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
