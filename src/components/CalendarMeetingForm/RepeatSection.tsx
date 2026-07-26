import { Repeat, Calendar, ChevronRight, ChevronLeft } from 'lucide-react';
import moment from 'moment-jalaali';
import { JALAALI_MONTHS, JALAALI_WEEKDAYS } from './constants';

export function RepeatSection(props: {
  repeatEnabled: boolean;
  setRepeatEnabled: (v: boolean) => void;
  repeatType: 'weekly' | 'monthly';
  setRepeatType: (v: 'weekly' | 'monthly') => void;
  repeatInterval: number;
  setRepeatInterval: (v: number) => void;
  repeatEndDate: string;
  setRepeatEndDate: (v: string) => void;
  showEndDatePicker: boolean;
  setShowEndDatePicker: (v: boolean) => void;
  endDatePickerJy: number;
  setEndDatePickerJy: (v: number | ((p: number) => number)) => void;
  endDatePickerJm: number;
  setEndDatePickerJm: (v: number | ((p: number) => number)) => void;
  repeatWeekday: number;
  setRepeatWeekday: (v: number) => void;
  repeatMonthlyMode: 'specific' | 'nth';
  setRepeatMonthlyMode: (v: 'specific' | 'nth') => void;
  repeatMonthlyNth: number;
  setRepeatMonthlyNth: (v: number) => void;
  repeatMonthlyNthWeekday: number;
  setRepeatMonthlyNthWeekday: (v: number) => void;
  scheduleDate: { jy: number; jm: number; jd: number } | null;
}) {
  const {
    repeatEnabled, setRepeatEnabled,
    repeatType, setRepeatType,
    repeatInterval, setRepeatInterval,
    repeatEndDate, setRepeatEndDate,
    showEndDatePicker, setShowEndDatePicker,
    endDatePickerJy, setEndDatePickerJy,
    endDatePickerJm, setEndDatePickerJm,
    repeatWeekday, setRepeatWeekday,
    repeatMonthlyMode, setRepeatMonthlyMode,
    repeatMonthlyNth, setRepeatMonthlyNth,
    repeatMonthlyNthWeekday, setRepeatMonthlyNthWeekday,
    scheduleDate,
  } = props;

  return (
    <div className="p-4 bg-gray-50 dark:bg-gray-700/30 rounded-xl border border-gray-200 dark:border-gray-600">
      <div className="flex items-center gap-2 mb-2">
        <input type="checkbox" id="calRepeat" checked={repeatEnabled} onChange={e => setRepeatEnabled(e.target.checked)} className="w-4 h-4 text-blue-600 rounded" />
        <label htmlFor="calRepeat" className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          <Repeat className="w-4 h-4" />تکرار جلسه
        </label>
      </div>
      {repeatEnabled && (
        <div className="space-y-3 mt-3">
          {/* Type + Interval row */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">نوع تکرار</label>
              <select value={repeatType} onChange={e => setRepeatType(e.target.value as any)}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                <option value="weekly">هفتگی</option><option value="monthly">ماهیانه</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">هر چند</label>
              <select value={repeatInterval} onChange={e => setRepeatInterval(Number(e.target.value))}
                className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm">
                {[1,2,3,4].map(n => <option key={n} value={n}>هر {n} {repeatType==='weekly'?'هفته':'ماه'}</option>)}
              </select>
            </div>
          </div>
          {/* End date */}
          <div className="relative">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">تا تاریخ (شمسی)</label>
            <div className="flex gap-1">
              <input type="text" value={repeatEndDate} onChange={e => setRepeatEndDate(e.target.value)} placeholder="مثال: ۱۴۰۵/۰۶/۳۱"
                className="flex-1 p-2 border border-gray-300 dark:border-gray-600 rounded-lg dark:bg-gray-700 dark:text-white text-sm" />
              <button type="button" onClick={() => setShowEndDatePicker(!showEndDatePicker)}
                className="px-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors">
                <Calendar className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            {showEndDatePicker && (
              <div className="absolute left-0 top-full mt-1 z-50 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-600 p-3 w-64">
                <div className="flex items-center justify-between mb-2">
                  <button type="button" onClick={() => { if(endDatePickerJm>1)setEndDatePickerJm(m=>m-1); else{setEndDatePickerJm(12);setEndDatePickerJy(y=>y-1);} }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronRight className="w-4 h-4 dark:text-white" /></button>
                  <span className="text-sm font-semibold dark:text-white">{JALAALI_MONTHS[endDatePickerJm-1]} {endDatePickerJy}</span>
                  <button type="button" onClick={() => { if(endDatePickerJm<12)setEndDatePickerJm(m=>m+1); else{setEndDatePickerJm(1);setEndDatePickerJy(y=>y+1);} }} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"><ChevronLeft className="w-4 h-4 dark:text-white" /></button>
                </div>
                <div className="grid grid-cols-7 gap-0.5">
                  {['ش','ی','د','س','چ','پ','ج'].map(d => <div key={d} className="text-center text-[10px] text-gray-400 py-0.5">{d}</div>)}
                  {(() => {
                    const dim = endDatePickerJm<=6?31:endDatePickerJm<=11?30:29;
                    const fd = moment(`${endDatePickerJy}/${endDatePickerJm}/1`,'jYYYY/jM/jD').day();
                    const off = fd===6?0:fd+1;
                    const cells: React.ReactNode[] = [];
                    for(let i=0;i<off;i++) cells.push(<div key={`e${i}`}/>);
                    for(let d=1;d<=dim;d++){
                      const jd=`${endDatePickerJy}/${String(endDatePickerJm).padStart(2,'0')}/${String(d).padStart(2,'0')}`;
                      cells.push(<button key={d} type="button" onClick={()=>{setRepeatEndDate(jd);setShowEndDatePicker(false);}} className={`text-xs py-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors ${repeatEndDate===jd?'bg-blue-500 text-white':'dark:text-white'}`}>{d}</button>);
                    }
                    return cells;
                  })()}
                </div>
              </div>
            )}
          </div>
          {/* Weekly: day picker */}
          {repeatType==='weekly' && (
            <div>
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">روز هفته</label>
              <div className="flex flex-wrap gap-1.5">
                {JALAALI_WEEKDAYS.map((day,i)=>(
                  <button key={i} type="button" onClick={()=>setRepeatWeekday(i)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${repeatWeekday===i?'bg-blue-500 text-white':'bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:border-blue-400'}`}>
                    {day}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Monthly: mode picker */}
          {repeatType==='monthly' && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">نوع تکرار ماهیانه</label>
                <div className="flex gap-2">
                  {[
                    {v:'specific',l:scheduleDate?`روز ${scheduleDate.jd} هر ماه`:'همان روز ماه'},
                    {v:'nth',l:(() => {
                      if (!scheduleDate) return 'روز هفته ماه';
                      const jsDay = moment(`${scheduleDate.jy}/${scheduleDate.jm}/${scheduleDate.jd}`,'jYYYY/jM/jD').day();
                      const jsDayMap = [6,0,1,2,3,4,5];
                      const wdIdx = jsDayMap.indexOf(jsDay);
                      const wdName = wdIdx >= 0 ? JALAALI_WEEKDAYS[wdIdx] : '';
                      const nthLabels = ['','اول','دوم','سوم','چهارم'];
                      const nth = Math.ceil(scheduleDate.jd / 7);
                      return wdName ? `${nthLabels[Math.min(nth,4)]} ${wdName} ماه` : 'روز هفته ماه';
                    })()},
                  ].map(opt=>(
                    <button key={opt.v} type="button"
                      onClick={()=>{
                        setRepeatMonthlyMode(opt.v as any);
                        if (opt.v === 'nth' && scheduleDate) {
                          const jsDay = moment(`${scheduleDate.jy}/${scheduleDate.jm}/${scheduleDate.jd}`,'jYYYY/jM/jD').day();
                          const jsDayMapInner = [6,0,1,2,3,4,5];
                          const wdIdx = jsDayMapInner.indexOf(jsDay);
                          if (wdIdx >= 0) setRepeatMonthlyNthWeekday(wdIdx);
                          setRepeatMonthlyNth(Math.min(Math.ceil(scheduleDate.jd / 7), 4));
                        }
                      }}
                      className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${repeatMonthlyMode===opt.v?'bg-blue-500 text-white':'bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 text-gray-600 dark:text-gray-300'}`}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              </div>
              {repeatMonthlyMode==='nth' && (
                <div className="space-y-2">
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">کدام هفته ماه</label>
                    <div className="flex gap-1.5 flex-wrap">
                      {[{v:1,l:'اول'},{v:2,l:'دوم'},{v:3,l:'سوم'},{v:4,l:'چهارم'},{v:-1,l:'آخر'}].map(opt=>(
                        <button key={opt.v} type="button" onClick={()=>setRepeatMonthlyNth(opt.v)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${repeatMonthlyNth===opt.v?'bg-blue-500 text-white':'bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:border-blue-400'}`}>
                          {opt.l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">روز هفته</label>
                    <div className="flex flex-wrap gap-1.5">
                      {JALAALI_WEEKDAYS.map((day,i)=>(
                        <button key={i} type="button" onClick={()=>setRepeatMonthlyNthWeekday(i)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${repeatMonthlyNthWeekday===i?'bg-blue-500 text-white':'bg-white dark:bg-gray-600 border border-gray-200 dark:border-gray-500 text-gray-600 dark:text-gray-300 hover:border-blue-400'}`}>
                          {day}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Summary */}
                  <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-xs text-blue-700 dark:text-blue-300 text-center font-medium">
                    {repeatMonthlyNth === -1 ? 'آخرین' : ['','اول','دوم','سوم','چهارم'][repeatMonthlyNth] || ''} {JALAALI_WEEKDAYS[repeatMonthlyNthWeekday]} هر ماه
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
