import { useState, useEffect } from 'react';
import { ChartBar as BarChart3, TrendingUp, Download, Calendar, Clock, Users, CircleCheck as CheckCircle2, TriangleAlert as AlertTriangle, RefreshCw, Loader as Loader2, ArrowUpRight, ArrowDownRight, Target, Activity, MapPin, UserCheck, Timer, ChartPie as PieChart } from 'lucide-react';
import { supabase } from '../lib/supabase';
import * as XLSX from '../lib/xlsxCompat';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import { usePermissions } from '../context/PermissionsContext';

interface Stats {
  totalMeetings: number;
  openMeetings: number;
  closedMeetings: number;
  totalTasks: number;
  completedTasks: number;
  pendingTasks: number;
  highPriority: number;
  mediumPriority: number;
  lowPriority: number;
  requestedMeetings: number;
  approvedMeetings: number;
  avgDurationMin: number;
  mostActiveLocation: string;
  topRepresentative: string;
  totalParticipants: number;
  avgParticipants: number;
  upcomingMeetings: number;
  completionRate: number;
  taskCompletionRate: number;
  meetingsByMonth: Record<string, number>;
  tasksByMonth: Record<string, number>;
}

type DateRange = '1month' | '3months' | '6months' | '1year';

const REPORT_FIELDS = [
  { key: 'subject', label: 'موضوع جلسه' },
  { key: 'request_date', label: 'تاریخ جلسه' },
  { key: 'duration', label: 'مدت زمان' },
  { key: 'location', label: 'محل برگزاری' },
  { key: 'representative', label: 'نماینده' },
  { key: 'phone', label: 'شماره تماس' },
  { key: 'priority', label: 'اولویت' },
  { key: 'status', label: 'وضعیت' },
  { key: 'status_type', label: 'نوع وضعیت' },
];

function KpiCard({
  title, value, sub, icon: Icon, color, trend,
}: {
  title: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string; trend?: 'up' | 'down' | 'neutral';
}) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400',
    red: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    teal: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-400',
    slate: 'bg-slate-50 dark:bg-slate-900/20 text-slate-600 dark:text-slate-400',
  };
  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{title}</p>
          <p className="text-3xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${colors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
      {trend && (
        <div className={`mt-3 flex items-center gap-1 text-xs font-medium ${trend === 'up' ? 'text-green-600' : trend === 'down' ? 'text-red-500' : 'text-gray-400'}`}>
          {trend === 'up' ? <ArrowUpRight className="w-3.5 h-3.5" /> : trend === 'down' ? <ArrowDownRight className="w-3.5 h-3.5" /> : null}
        </div>
      )}
    </div>
  );
}

const JALAALI_MONTHS_SHORT = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

function formatJalaaliLabel(key: string): string {
  // key format: "1403/06"
  const parts = key.split('/');
  if (parts.length === 2) {
    const month = parseInt(parts[1], 10);
    const monthName = JALAALI_MONTHS_SHORT[month - 1] || parts[1];
    return `${monthName} ${parts[0]}`;
  }
  return key;
}

function BarChartBlock({ data, color = 'bg-blue-500' }: { data: Record<string, number>; color?: string }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b)).slice(-8);
  const max = Math.max(...entries.map(([, v]) => v), 1);
  return (
    <div className="space-y-2.5">
      {entries.map(([label, value]) => (
        <div key={label}>
          <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
            <span>{formatJalaaliLabel(label)}</span><span>{value}</span>
          </div>
          <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${(value / max) * 100}%` }} />
          </div>
        </div>
      ))}
      {entries.length === 0 && <p className="text-sm text-gray-400 text-center py-4">داده‌ای موجود نیست</p>}
    </div>
  );
}

function DonutSegment({ pct, color }: { pct: number; color: string }) {
  const r = 36; const circ = 2 * Math.PI * r;
  return (
    <circle r={r} cx="50" cy="50" fill="none" strokeWidth="10"
      stroke={color} strokeDasharray={`${pct / 100 * circ} ${circ}`}
      strokeLinecap="round" transform="rotate(-90 50 50)" />
  );
}

export function ReportsPage() {
  const { hasPermission } = usePermissions();
  const canExport = hasPermission('reports_export');
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<DateRange>('3months');
  const [showExportModal, setShowExportModal] = useState(false);
  const [selectedFields, setSelectedFields] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportData, setExportData] = useState<any[] | null>(null);

  useEffect(() => { fetchStats(); }, [range]);

  const fetchStats = async () => {
    setLoading(true);
    try {
      const monthsBack = range === '1month' ? 1 : range === '3months' ? 3 : range === '6months' ? 6 : 12;
      const since = moment().subtract(monthsBack, 'months').toISOString();

      const [{ data: meetings }, { data: tasks }] = await Promise.all([
        supabase.from('meetings').select('*, participants(id), actions(id,status)').gte('request_date', since),
        supabase.from('tasks').select('*').gte('created_at', since),
      ]);

      const m = meetings || [];
      const t = tasks || [];
      const now = new Date();

      const meetingsByMonth: Record<string, number> = {};
      const tasksByMonth: Record<string, number> = {};

      let totalPart = 0;
      const locationCount: Record<string, number> = {};
      const repCount: Record<string, number> = {};
      let totalDur = 0;
      let durCount = 0;

      m.forEach(mtg => {
        const mk = moment(mtg.request_date).format('jYYYY/jMM');
        meetingsByMonth[mk] = (meetingsByMonth[mk] || 0) + 1;
        totalPart += mtg.participants?.length || 0;
        locationCount[mtg.location] = (locationCount[mtg.location] || 0) + 1;
        repCount[mtg.representative] = (repCount[mtg.representative] || 0) + 1;
        const d = parseInt(mtg.duration);
        if (!isNaN(d)) { totalDur += d; durCount++; }
      });

      t.forEach(task => {
        const tk = moment(task.created_at).format('jYYYY/jMM');
        tasksByMonth[tk] = (tasksByMonth[tk] || 0) + 1;
      });

      const mostActiveLocation = Object.entries(locationCount).sort(([, a], [, b]) => b - a)[0]?.[0] || '—';
      const topRepresentative = Object.entries(repCount).sort(([, a], [, b]) => b - a)[0]?.[0] || '—';

      const completedTasks = t.filter(t => t.status === 'completed').length;
      const pendingTasks = t.filter(t => t.status !== 'completed').length;

      setStats({
        totalMeetings: m.length,
        openMeetings: m.filter(x => x.status === 'open').length,
        closedMeetings: m.filter(x => x.status === 'closed').length,
        totalTasks: t.length,
        completedTasks,
        pendingTasks,
        highPriority: m.filter(x => x.priority === 'high').length,
        mediumPriority: m.filter(x => x.priority === 'medium').length,
        lowPriority: m.filter(x => x.priority === 'low').length,
        requestedMeetings: m.filter(x => x.status_type === 'requested').length,
        approvedMeetings: m.filter(x => x.status_type === 'approved').length,
        avgDurationMin: durCount ? Math.round(totalDur / durCount) : 0,
        mostActiveLocation,
        topRepresentative,
        totalParticipants: totalPart,
        avgParticipants: m.length ? Math.round(totalPart / m.length) : 0,
        upcomingMeetings: m.filter(x => new Date(x.request_date) > now).length,
        completionRate: m.length ? Math.round(m.filter(x => x.status === 'closed').length / m.length * 100) : 0,
        taskCompletionRate: t.length ? Math.round(completedTasks / t.length * 100) : 0,
        meetingsByMonth,
        tasksByMonth,
      });
    } catch {
      toast.error('خطا در دریافت آمار');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!selectedFields.length) { toast.error('حداقل یک فیلد انتخاب کنید'); return; }
    setExporting(true);
    try {
      const { data } = await supabase.from('meetings').select('*');
      const rows = (data || []).map(mtg => {
        const row: Record<string, string> = {};
        selectedFields.forEach(f => {
          if (f === 'request_date') row['تاریخ جلسه'] = moment((mtg as Record<string, unknown>)[f]).format('jYYYY/jMM/jDD HH:mm');
          else if (f === 'priority') row['اولویت'] = (mtg as Record<string, unknown>)[f] === 'high' ? 'بالا' : (mtg as Record<string, unknown>)[f] === 'medium' ? 'متوسط' : 'پایین';
          else if (f === 'status') row['وضعیت'] = (mtg as Record<string, unknown>)[f] === 'open' ? 'باز' : 'بسته';
          else if (f === 'status_type') row['نوع وضعیت'] = (mtg as Record<string, unknown>)[f] === 'requested' ? 'درخواست شده' : 'تایید شده';
          else row[REPORT_FIELDS.find(r => r.key === f)?.label || f] = (mtg as Record<string, unknown>)[f] ?? '';
        });
        return row;
      });
      setExportData(rows);
    } catch { toast.error('خطا در تهیه گزارش'); }
    finally { setExporting(false); }
  };

  const downloadExcel = async () => {
    if (!exportData?.length) return;
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Report');
    await XLSX.writeFile(wb, `report-${moment().format('jYYYY-jMM-jDD')}.xlsx`);
    toast.success('فایل دانلود شد');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-80">
        <Loader2 className="w-10 h-10 animate-spin text-blue-500" />
      </div>
    );
  }

  if (!stats) return null;

  const approvalPct = stats.totalMeetings ? Math.round(stats.approvedMeetings / stats.totalMeetings * 100) : 0;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">داشبورد گزارشات</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">خلاصه آمار و عملکرد سیستم</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={range}
            onChange={e => setRange(e.target.value as DateRange)}
            className="px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="1month">ماه جاری</option>
            <option value="3months">۳ ماه اخیر</option>
            <option value="6months">۶ ماه اخیر</option>
            <option value="1year">یک سال اخیر</option>
          </select>
          <button
            onClick={() => fetchStats()}
            className="p-2 rounded-lg border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 transition"
            title="بروزرسانی"
          >
            <RefreshCw className="w-4 h-4 text-gray-500" />
          </button>
          {canExport && (
            <button
              onClick={() => setShowExportModal(true)}
              className="flex items-center gap-2 bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              <Download className="w-4 h-4" />
              صادر کردن Excel
            </button>
          )}
        </div>
      </div>

      {/* KPIs row 1 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="کل جلسات" value={stats.totalMeetings} sub={`${stats.openMeetings} باز · ${stats.closedMeetings} بسته`} icon={Calendar} color="blue" />
        <KpiCard title="جلسات آینده" value={stats.upcomingMeetings} icon={Activity} color="teal" />
        <KpiCard title="نرخ تکمیل جلسات" value={`${stats.completionRate}%`} icon={Target} color="green" />
        <KpiCard title="کل اقدامات" value={stats.totalTasks} sub={`${stats.completedTasks} تکمیل شده`} icon={CheckCircle2} color="orange" />
      </div>

      {/* KPIs row 2 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="میانگین شرکت‌کنندگان" value={stats.avgParticipants} icon={Users} color="slate" />
        <KpiCard title="میانگین مدت جلسه" value={`${stats.avgDurationMin} دقیقه`} icon={Timer} color="blue" />
        <KpiCard title="درخواست‌های در انتظار" value={stats.requestedMeetings} icon={AlertTriangle} color="orange" />
        <KpiCard title="درخواست‌های تایید شده" value={stats.approvedMeetings} icon={UserCheck} color="green" />
      </div>

      {/* Charts row */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Meetings by month */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <div className="flex items-center gap-2 mb-5">
            <BarChart3 className="w-5 h-5 text-blue-500" />
            <h3 className="font-semibold text-gray-800 dark:text-white">روند ماهانه جلسات</h3>
          </div>
          <BarChartBlock data={stats.meetingsByMonth} color="bg-blue-500" />
        </div>

        {/* Tasks by month */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <div className="flex items-center gap-2 mb-5">
            <TrendingUp className="w-5 h-5 text-teal-500" />
            <h3 className="font-semibold text-gray-800 dark:text-white">روند ماهانه اقدامات</h3>
          </div>
          <BarChartBlock data={stats.tasksByMonth} color="bg-teal-500" />
        </div>
      </div>

      {/* Priority + Status */}
      <div className="grid md:grid-cols-3 gap-6">
        {/* Priority donut */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <div className="flex items-center gap-2 mb-5">
            <PieChart className="w-5 h-5 text-rose-500" />
            <h3 className="font-semibold text-gray-800 dark:text-white">توزیع اولویت جلسات</h3>
          </div>
          {stats.totalMeetings > 0 ? (
            <div className="flex flex-col items-center gap-4">
              <svg viewBox="0 0 100 100" className="w-32 h-32">
                <circle r="36" cx="50" cy="50" fill="none" strokeWidth="10" stroke="#f3f4f6" />
                {/* Approximate multi-color segments using stacked circles (simplified) */}
                <DonutSegment pct={Math.round(stats.highPriority / stats.totalMeetings * 100)} color="#ef4444" />
              </svg>
              <div className="w-full space-y-2">
                {[
                  { label: 'اولویت بالا', count: stats.highPriority, color: 'bg-red-500' },
                  { label: 'اولویت متوسط', count: stats.mediumPriority, color: 'bg-yellow-500' },
                  { label: 'اولویت پایین', count: stats.lowPriority, color: 'bg-green-500' },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${row.color}`} />
                      <span className="text-gray-600 dark:text-gray-300">{row.label}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-20 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                        <div className={`h-full ${row.color} rounded-full`} style={{ width: `${stats.totalMeetings ? row.count / stats.totalMeetings * 100 : 0}%` }} />
                      </div>
                      <span className="font-medium text-gray-800 dark:text-white w-5 text-right">{row.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : <p className="text-sm text-gray-400 text-center py-8">داده‌ای موجود نیست</p>}
        </div>

        {/* Approval rate */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <div className="flex items-center gap-2 mb-5">
            <CheckCircle2 className="w-5 h-5 text-green-500" />
            <h3 className="font-semibold text-gray-800 dark:text-white">نرخ تأیید درخواست‌ها</h3>
          </div>
          <div className="flex flex-col items-center justify-center h-40 gap-3">
            <div className="relative w-28 h-28">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                <circle r="40" cx="50" cy="50" fill="none" strokeWidth="12" stroke="#f3f4f6" />
                <circle r="40" cx="50" cy="50" fill="none" strokeWidth="12" stroke="#22c55e"
                  strokeDasharray={`${approvalPct / 100 * 2 * Math.PI * 40} ${2 * Math.PI * 40}`}
                  strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-bold text-gray-900 dark:text-white">{approvalPct}%</span>
              </div>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {stats.approvedMeetings} از {stats.totalMeetings} جلسه
            </p>
          </div>
          <div className="space-y-2 mt-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">درخواست شده</span>
              <span className="font-medium text-yellow-600">{stats.requestedMeetings}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">تایید شده</span>
              <span className="font-medium text-green-600">{stats.approvedMeetings}</span>
            </div>
          </div>
        </div>

        {/* Task completion */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <div className="flex items-center gap-2 mb-5">
            <Activity className="w-5 h-5 text-orange-500" />
            <h3 className="font-semibold text-gray-800 dark:text-white">وضعیت اقدامات</h3>
          </div>
          <div className="space-y-4">
            {[
              { label: 'تکمیل شده', value: stats.completedTasks, total: stats.totalTasks, color: 'bg-green-500' },
              { label: 'در انتظار / جاری', value: stats.pendingTasks, total: stats.totalTasks, color: 'bg-orange-400' },
            ].map(row => (
              <div key={row.label}>
                <div className="flex justify-between text-sm mb-1.5">
                  <span className="text-gray-600 dark:text-gray-300">{row.label}</span>
                  <span className="font-medium text-gray-800 dark:text-white">{row.value}</span>
                </div>
                <div className="h-2.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                  <div className={`h-full ${row.color} rounded-full transition-all duration-700`}
                    style={{ width: `${row.total ? row.value / row.total * 100 : 0}%` }} />
                </div>
              </div>
            ))}
            <div className="pt-3 border-t border-gray-100 dark:border-gray-700 text-center">
              <span className="text-2xl font-bold text-gray-900 dark:text-white">{stats.taskCompletionRate}%</span>
              <p className="text-xs text-gray-400 mt-0.5">نرخ تکمیل اقدامات</p>
            </div>
          </div>
        </div>
      </div>

      {/* Insights */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
        <h3 className="font-semibold text-gray-800 dark:text-white mb-5">اطلاعات تکمیلی</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          {[
            { label: 'پرتکرارترین محل', value: stats.mostActiveLocation, icon: MapPin, color: 'text-teal-500' },
            { label: 'فعال‌ترین نماینده', value: stats.topRepresentative, icon: UserCheck, color: 'text-blue-500' },
            { label: 'کل شرکت‌کنندگان', value: `${stats.totalParticipants} نفر`, icon: Users, color: 'text-green-500' },
            { label: 'میانگین مدت', value: `${stats.avgDurationMin} دقیقه`, icon: Clock, color: 'text-orange-500' },
          ].map(item => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="flex items-start gap-3">
                <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${item.color}`} />
                <div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{item.label}</p>
                  <p className="font-semibold text-gray-800 dark:text-white text-sm mt-0.5">{item.value || '—'}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Export modal */}
      {showExportModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b border-gray-100 dark:border-gray-700">
              <h3 className="font-semibold text-gray-900 dark:text-white">صادر کردن گزارش Excel</h3>
              <button onClick={() => { setShowExportModal(false); setExportData(null); }}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl leading-none">&times;</button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">فیلدهایی که می‌خواهید در گزارش باشند را انتخاب کنید:</p>
              <div className="grid grid-cols-2 gap-2.5">
                {REPORT_FIELDS.map(f => (
                  <label key={f.key} className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={selectedFields.includes(f.key)}
                      onChange={e => setSelectedFields(prev => e.target.checked ? [...prev, f.key] : prev.filter(x => x !== f.key))}
                      className="w-4 h-4 rounded text-blue-500 focus:ring-blue-500" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{f.label}</span>
                  </label>
                ))}
              </div>

              {exportData && (
                <div className="p-3 bg-green-50 dark:bg-green-900/20 rounded-lg text-sm text-green-700 dark:text-green-400">
                  {exportData.length} ردیف آماده دانلود است
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button onClick={handleExport} disabled={exporting || !selectedFields.length}
                  className="flex-1 flex items-center justify-center gap-2 bg-blue-500 hover:bg-blue-600 text-white py-2.5 rounded-xl text-sm font-medium disabled:opacity-50 transition">
                  {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  تهیه گزارش
                </button>
                {exportData && (
                  <button onClick={downloadExcel}
                    className="flex-1 flex items-center justify-center gap-2 bg-green-500 hover:bg-green-600 text-white py-2.5 rounded-xl text-sm font-medium transition">
                    <Download className="w-4 h-4" />
                    دانلود Excel
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
