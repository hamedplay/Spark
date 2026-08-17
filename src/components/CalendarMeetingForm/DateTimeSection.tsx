import { Clock, CreditCard as Edit2 } from 'lucide-react';
import moment from 'moment-jalaali';
import { JALAALI_MONTHS } from './constants';

export function DateTimeSection(props: {
  scheduleDate: { jy: number; jm: number; jd: number } | null;
  showManualDateTime: boolean;
  setShowManualDateTime: React.Dispatch<React.SetStateAction<boolean>>;
  manualDateStr: string;
  setManualDateStr: React.Dispatch<React.SetStateAction<string>>;
  manualStartTime: string;
  setManualStartTime: React.Dispatch<React.SetStateAction<string>>;
  manualEndTime: string;
  setManualEndTime: React.Dispatch<React.SetStateAction<string>>;
  startTime: string;
  setStartTime: React.Dispatch<React.SetStateAction<string>>;
  endTime: string;
  setEndTime: React.Dispatch<React.SetStateAction<string>>;
  setScheduleDate: React.Dispatch<React.SetStateAction<{ jy: number; jm: number; jd: number } | null>>;
}) {
  const {
    scheduleDate,
    showManualDateTime, setShowManualDateTime,
    manualDateStr, setManualDateStr,
    manualStartTime, setManualStartTime,
    manualEndTime, setManualEndTime,
    startTime, setStartTime,
    endTime, setEndTime,
    setScheduleDate,
  } = props;

  if (!scheduleDate) return null;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 border border-blue-200 dark:border-blue-700 rounded-xl bg-blue-50 dark:bg-blue-900/20">
          <p className="text-xs text-blue-500 mb-0.5">تاریخ جلسه</p>
          <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
            {showManualDateTime && manualDateStr ? manualDateStr : `${scheduleDate.jd} ${JALAALI_MONTHS[scheduleDate.jm-1]} ${scheduleDate.jy}`}
          </p>
        </div>
        <div className="p-3 border border-blue-200 dark:border-blue-700 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center gap-2">
          <Clock className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-blue-500 mb-0.5">زمان جلسه</p>
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">
              {showManualDateTime && manualStartTime ? `${manualStartTime} — ${manualEndTime}` : `${startTime} — ${endTime}`}
            </p>
          </div>
        </div>
      </div>
      {/* Manual date/time override toggle */}
      <button type="button" onClick={() => { setShowManualDateTime(v => !v); if (!manualDateStr && scheduleDate) setManualDateStr(`${scheduleDate.jy}/${String(scheduleDate.jm).padStart(2,'0')}/${String(scheduleDate.jd).padStart(2,'0')}`); if (!manualStartTime) setManualStartTime(startTime); if (!manualEndTime) setManualEndTime(endTime); }}
        className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400 hover:underline">
        <Edit2 className="w-3 h-3" />{showManualDateTime ? 'بستن ویرایش دستی' : 'تغییر دستی تاریخ و ساعت'}
      </button>
      {showManualDateTime && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-700">
          <div>
            <label className="block text-xs text-blue-600 dark:text-blue-400 mb-1">تاریخ (شمسی)</label>
            <input type="text" value={manualDateStr} onChange={e => {
              setManualDateStr(e.target.value);
              const parts = e.target.value.split('/').map(Number);
              if (parts.length === 3 && parts[0] > 1300 && parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1) {
                const gd = moment(`${parts[0]}/${parts[1]}/${parts[2]}`, 'jYYYY/jM/jD').toDate();
                if (!isNaN(gd.getTime())) setScheduleDate({ jy: parts[0], jm: parts[1], jd: parts[2] });
              }
            }}
              placeholder="1405/03/15"
              className="w-full p-2 border border-blue-300 dark:border-blue-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
          </div>
          <div>
            <label className="block text-xs text-blue-600 dark:text-blue-400 mb-1">ساعت شروع</label>
            <input type="time" value={manualStartTime} onChange={e => { setManualStartTime(e.target.value); setStartTime(e.target.value); }}
              className="w-full p-2 border border-blue-300 dark:border-blue-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
          </div>
          <div>
            <label className="block text-xs text-blue-600 dark:text-blue-400 mb-1">ساعت پایان</label>
            <input type="time" value={manualEndTime} onChange={e => { setManualEndTime(e.target.value); setEndTime(e.target.value); }}
              className="w-full p-2 border border-blue-300 dark:border-blue-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
          </div>
        </div>
      )}
    </div>
  );
}
