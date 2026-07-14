import { useState } from 'react';
import { Search, FileDown, Printer, Play, X, Settings2 } from 'lucide-react';
import { PageHeader, TableSkeleton } from './MinutesShared';

type ReportType =
  | 'minutes'
  | 'decisions'
  | 'unit_performance'
  | 'owner_performance'
  | 'overdue'
  | 'obstacles'
  | 'approvals';

interface Props {
  onNavigate: (page: string) => void;
}

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'minutes',          label: 'گزارش صورت‌جلسات' },
  { value: 'decisions',        label: 'گزارش مصوبات' },
  { value: 'unit_performance', label: 'گزارش عملکرد واحدها' },
  { value: 'owner_performance',label: 'گزارش عملکرد مسئولان' },
  { value: 'overdue',          label: 'گزارش مصوبات عقب‌افتاده' },
  { value: 'obstacles',        label: 'گزارش موانع' },
  { value: 'approvals',        label: 'گزارش تأییدها' },
];

const AVAILABLE_COLUMNS: Record<ReportType, string[]> = {
  minutes:          ['عنوان جلسه','تاریخ','دبیر','رئیس','وضعیت','محرمانگی','تعداد مصوبات'],
  decisions:        ['عنوان مصوبه','جلسه','مسئول','واحد','اولویت','وضعیت','پیشرفت','مهلت'],
  unit_performance: ['واحد','تعداد مصوبات','تکمیل‌شده','در جریان','عقب‌افتاده','درصد تحقق'],
  owner_performance:['مسئول','تعداد مصوبات','تکمیل‌شده','در جریان','درصد تحقق'],
  overdue:          ['عنوان مصوبه','مسئول','مهلت','تأخیر (روز)','وضعیت'],
  obstacles:        ['عنوان مانع','مصوبه مرتبط','مسئول','تاریخ ثبت','وضعیت مانع'],
  approvals:        ['صورت‌جلسه','تأییدکننده','مرحله','وضعیت','تاریخ تأیید'],
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function MinutesReportsPage(_props: Props) {
  const [reportType, setReportType] = useState<ReportType>('decisions');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('');
  const [selectedOwner, setSelectedOwner] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('');
  const [selectedConfidentiality, setSelectedConfidentiality] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [hasResult, setHasResult] = useState(false);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(
    () => new Set(AVAILABLE_COLUMNS[reportType])
  );
  const [showColumnPicker, setShowColumnPicker] = useState(false);

  const handleChangeReportType = (t: ReportType) => {
    setReportType(t);
    setSelectedColumns(new Set(AVAILABLE_COLUMNS[t]));
    setHasResult(false);
  };

  const runReport = () => {
    setIsRunning(true);
    setTimeout(() => {
      setIsRunning(false);
      setHasResult(true);
    }, 800);
  };

  const clearFilters = () => {
    setDateFrom('');
    setDateTo('');
    setSelectedUnit('');
    setSelectedOwner('');
    setSelectedStatus('');
    setSelectedPriority('');
    setSelectedConfidentiality('');
    setHasResult(false);
  };

  const toggleColumn = (col: string) => {
    setSelectedColumns(s => {
      const next = new Set(s);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader title="گزارش‌ها" description="ساخت گزارش‌های سفارشی از صورت‌جلسات و مصوبات" />

      {/* Filters card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-200">انتخاب نوع گزارش و فیلترها</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {/* Report type */}
          <div className="sm:col-span-2">
            <label htmlFor="report-type" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              نوع گزارش <span className="text-red-500">*</span>
            </label>
            <select
              id="report-type"
              value={reportType}
              onChange={e => handleChangeReportType(e.target.value as ReportType)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              {REPORT_TYPES.map(r => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div>
            <label htmlFor="date-from" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">از تاریخ</label>
            <input
              id="date-from"
              type="text"
              placeholder="۱۴۰۳/۰۱/۰۱"
              value={dateFrom}
              onChange={e => setDateFrom(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label htmlFor="date-to" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">تا تاریخ</label>
            <input
              id="date-to"
              type="text"
              placeholder="۱۴۰۳/۱۲/۲۹"
              value={dateTo}
              onChange={e => setDateTo(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Unit */}
          <div>
            <label htmlFor="filter-unit" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">واحد سازمانی</label>
            <input
              id="filter-unit"
              type="text"
              placeholder="نام واحد..."
              value={selectedUnit}
              onChange={e => setSelectedUnit(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Owner */}
          <div>
            <label htmlFor="filter-owner" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">مسئول</label>
            <input
              id="filter-owner"
              type="text"
              placeholder="نام مسئول..."
              value={selectedOwner}
              onChange={e => setSelectedOwner(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            />
          </div>

          {/* Status */}
          <div>
            <label htmlFor="filter-status" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">وضعیت</label>
            <select
              id="filter-status"
              value={selectedStatus}
              onChange={e => setSelectedStatus(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="">همه وضعیت‌ها</option>
              <option value="draft">پیش‌نویس</option>
              <option value="approved">تأیید‌شده</option>
              <option value="in_progress">در حال انجام</option>
              <option value="completed">تکمیل‌شده</option>
            </select>
          </div>

          {/* Priority */}
          <div>
            <label htmlFor="filter-priority" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">اولویت</label>
            <select
              id="filter-priority"
              value={selectedPriority}
              onChange={e => setSelectedPriority(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="">همه اولویت‌ها</option>
              <option value="urgent">فوری</option>
              <option value="important">مهم</option>
              <option value="normal">عادی</option>
              <option value="low">کم</option>
            </select>
          </div>

          {/* Confidentiality */}
          <div>
            <label htmlFor="filter-conf" className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">سطح محرمانگی</label>
            <select
              id="filter-conf"
              value={selectedConfidentiality}
              onChange={e => setSelectedConfidentiality(e.target.value)}
              className="w-full px-3 py-2.5 text-sm border border-gray-200 dark:border-gray-600 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/40 dark:bg-gray-700 dark:text-white"
            >
              <option value="">همه سطوح</option>
              <option value="public">عمومی</option>
              <option value="organizational">سازمانی</option>
              <option value="restricted">محدود</option>
              <option value="confidential">محرمانه</option>
            </select>
          </div>
        </div>

        {/* Column picker */}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          <button
            onClick={() => setShowColumnPicker(v => !v)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <Settings2 className="w-3.5 h-3.5" />
            انتخاب ستون‌ها ({selectedColumns.size})
          </button>
        </div>

        {showColumnPicker && (
          <div className="flex flex-wrap gap-2 pt-1">
            {AVAILABLE_COLUMNS[reportType].map(col => (
              <label key={col} className="flex items-center gap-1.5 cursor-pointer select-none text-xs bg-gray-50 dark:bg-gray-700/30 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600">
                <input
                  type="checkbox"
                  checked={selectedColumns.has(col)}
                  onChange={() => toggleColumn(col)}
                  className="w-3.5 h-3.5 accent-blue-600"
                />
                {col}
              </label>
            ))}
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-3 flex-wrap pt-1 border-t border-gray-100 dark:border-gray-700">
          <button
            onClick={runReport}
            disabled={isRunning}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-60"
          >
            <Play className="w-4 h-4" />
            {isRunning ? 'در حال اجرا...' : 'اجرای گزارش'}
          </button>
          <button
            onClick={clearFilters}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
            پاک‌کردن فیلترها
          </button>
          {hasResult && (
            <>
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 transition-colors">
                <FileDown className="w-4 h-4" />
                خروجی Excel
              </button>
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors">
                <FileDown className="w-4 h-4" />
                خروجی Word
              </button>
              <button className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 transition-colors">
                <Printer className="w-4 h-4" />
                چاپ
              </button>
            </>
          )}
        </div>
      </div>

      {/* Results */}
      {isRunning && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <TableSkeleton rows={6} />
        </div>
      )}

      {hasResult && !isRunning && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
              {REPORT_TYPES.find(r => r.value === reportType)?.label}
            </h3>
            <span className="text-xs text-gray-500 dark:text-gray-400">۵ نتیجه (Mock)</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  {Array.from(selectedColumns).map(col => (
                    <th key={col} className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {[1, 2, 3, 4, 5].map(i => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    {Array.from(selectedColumns).map(col => (
                      <td key={col} className="px-4 py-2.5 text-gray-600 dark:text-gray-400 text-xs">
                        <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-20 animate-none" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span>نمایش ۵ از ۵ نتیجه</span>
            <div className="flex items-center gap-1">
              <button className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">قبلی</button>
              <span className="px-2.5 py-1 rounded-lg bg-blue-600 text-white">۱</span>
              <button className="px-2.5 py-1 rounded-lg bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">بعدی</button>
            </div>
          </div>
        </div>
      )}

      {!hasResult && !isRunning && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 py-16 text-center">
          <Search className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            فیلترها را تنظیم کرده و «اجرای گزارش» را بزنید.
          </p>
        </div>
      )}
    </div>
  );
}
