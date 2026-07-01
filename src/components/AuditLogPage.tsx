import { useState, useCallback, useEffect } from 'react';
import { Activity, Search, Download, RefreshCw, X, CircleAlert as AlertCircle, TriangleAlert as AlertTriangle, Info, Globe, FileText, ChevronDown, ChevronUp, Eye } from 'lucide-react';
import { supabase } from '../lib/supabase';
import toast from 'react-hot-toast';
import moment from 'moment-jalaali';
import * as XLSX from 'xlsx';

moment.loadPersian({ dialect: 'persian-modern', usePersianDigits: false });

// ─── Types ────────────────────────────────────────────────────────────────────
interface AuditEntry {
  id: string;
  user_id: string | null;
  user_name: string | null;
  ip_address: string | null;
  user_agent: string | null;
  module: string | null;
  entity_name: string | null;
  entity_id: string | null;
  action: string;
  details: string | null;
  severity: string;
  created_at: string;
  referrer?: string | null;
  url?: string | null;
}

interface Filters {
  year: string;
  month: string;
  timeFrom: string;
  timeTo: string;
  eventTypes: { info: boolean; warning: boolean; error: boolean; critical: boolean };
  module: string;
  entityName: string;
  entityId: string;
  ip: string;
  userName: string;
  browser: string;
  details: string;
}

const MONTHS = [
  '01','02','03','04','05','06','07','08','09','10','11','12'
];
const MONTH_LABELS = ['فروردین','اردیبهشت','خرداد','تیر','مرداد','شهریور','مهر','آبان','آذر','دی','بهمن','اسفند'];

// Current Jalali year
const CURRENT_JYEAR = parseInt(moment().format('jYYYY'));
const CURRENT_JMONTH = moment().format('jMM');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function severityColor(s: string) {
  if (s === 'critical') return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
  if (s === 'error') return 'text-red-500 dark:text-red-300 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800';
  if (s === 'warning') return 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700';
  return 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700';
}

function severityLabel(s: string) {
  if (s === 'critical') return 'بحرانی';
  if (s === 'error') return 'خطا';
  if (s === 'warning') return 'هشدار';
  return 'اطلاع';
}

function SeverityIcon({ severity, size = 'sm' }: { severity: string; size?: 'sm' | 'md' }) {
  const cls = size === 'md' ? 'w-4 h-4' : 'w-3.5 h-3.5';
  if (severity === 'critical' || severity === 'error') return <AlertCircle className={cls} />;
  if (severity === 'warning') return <AlertTriangle className={cls} />;
  return <Info className={cls} />;
}

function parseUA(ua: string | null) {
  if (!ua) return { browser: '—', os: '—' };
  let browser = '—';
  let os = '—';
  if (ua.includes('Chrome') && !ua.includes('Edg')) browser = 'Google Chrome ' + (ua.match(/Chrome\/([\d.]+)/)?.[1] || '');
  else if (ua.includes('Firefox')) browser = 'Firefox ' + (ua.match(/Firefox\/([\d.]+)/)?.[1] || '');
  else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
  else if (ua.includes('Edg')) browser = 'Edge';
  else browser = ua.split(' ')[0];

  if (ua.includes('Windows NT 10')) os = 'Windows 10';
  else if (ua.includes('Windows NT 11')) os = 'Windows 11';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('Mac OS X')) os = 'macOS';
  else if (ua.includes('Linux')) os = 'Linux';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';

  return { browser, os };
}

function toJalali(d: string | null) {
  if (!d) return '—';
  return moment(d).format('jYYYY/jMM/jDD HH:mm');
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────
function EventDetailModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const [tab, setTab] = useState<'spec' | 'detail'>('spec');
  const { browser, os } = parseUA(entry.user_agent);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50" dir="rtl">
      <div className="w-full max-w-2xl bg-white dark:bg-gray-800 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-bold text-gray-800 dark:text-white text-lg flex items-center gap-2">
            <Eye className="w-5 h-5 text-blue-500" />
            نمایش رویداد
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-700">
          <button onClick={() => setTab('spec')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === 'spec' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            مشخصات رویداد
          </button>
          <button onClick={() => setTab('detail')}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${tab === 'detail' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-500' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}>
            جزئیات رویداد
          </button>
        </div>

        <div className="p-5 max-h-[70vh] overflow-y-auto">
          {tab === 'spec' && (
            <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700">
              {[
                { label: 'نوع رویداد', value: <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${severityColor(entry.severity)}`}><SeverityIcon severity={entry.severity} />{entry.action}</span> },
                { label: 'ماژول', value: entry.module || 'عمومی' },
                { label: 'شناسه موجودیت', value: entry.entity_id || '—' },
                { label: 'نام موجودیت', value: entry.entity_name || '—' },
                { label: 'تاریخ', value: toJalali(entry.created_at) },
                { label: 'کاربر', value: entry.user_name || '—' },
                { label: 'مرورگر', value: browser },
                { label: 'سیستم عامل', value: os },
                { label: 'IP', value: entry.ip_address ? (
                  <span className="flex items-center gap-1.5 font-mono text-sm">
                    <Globe className="w-3.5 h-3.5 text-blue-400" />{entry.ip_address}
                  </span>
                ) : '—' },
              ].map(({ label, value }) => (
                <div key={label} className="flex items-start justify-between py-3 gap-4">
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400 shrink-0 w-36 text-left">{label}</span>
                  <span className="text-sm text-gray-800 dark:text-white text-right flex-1">{value}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'detail' && (
            <div className="space-y-4">
              {entry.referrer && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">مراجعه شده از</p>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-700 dark:text-gray-300 font-mono break-all">{entry.referrer}</div>
                </div>
              )}
              {entry.url && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">آدرس URL</p>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-700 dark:text-gray-300 font-mono break-all">{entry.url}</div>
                </div>
              )}
              {entry.details && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">توضیحات</p>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap break-all">{entry.details}</div>
                </div>
              )}
              {entry.user_agent && (
                <div>
                  <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">User Agent</p>
                  <div className="p-3 rounded-xl bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 font-mono break-all">{entry.user_agent}</div>
                </div>
              )}
              {!entry.referrer && !entry.url && !entry.details && !entry.user_agent && (
                <div className="text-center py-10 text-gray-400 text-sm">جزئیاتی برای این رویداد ثبت نشده است</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main AuditLogPage ────────────────────────────────────────────────────────
export function AuditLogPage() {
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);

  const [filters, setFilters] = useState<Filters>({
    year: String(CURRENT_JYEAR),
    month: CURRENT_JMONTH,
    timeFrom: '',
    timeTo: '',
    eventTypes: { info: true, warning: true, error: true, critical: true },
    module: '',
    entityName: '',
    entityId: '',
    ip: '',
    userName: '',
    browser: '',
    details: '',
  });

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 transition-colors';

  const search = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);

      // Jalali year/month → Gregorian date range
      if (filters.year) {
        const jy = parseInt(filters.year);
        const jm = parseInt(filters.month) || 1;
        // Start of Jalali month → Gregorian
        const startGreg = moment(`${jy}/${jm}/01`, 'jYYYY/jMM/jDD').startOf('day');
        // End of Jalali month: add 1 month in Jalali, subtract 1 day
        const endGreg = moment(`${jy}/${jm}/01`, 'jYYYY/jMM/jDD')
          .add(1, 'jMonth').subtract(1, 'day').endOf('day');
        // If no month selected, use entire year
        const startDate = filters.month
          ? startGreg.toISOString()
          : moment(`${jy}/01/01`, 'jYYYY/jMM/jDD').startOf('day').toISOString();
        const endDate = filters.month
          ? endGreg.toISOString()
          : moment(`${jy}/12/29`, 'jYYYY/jMM/jDD').endOf('day').toISOString();
        q = q.gte('created_at', startDate).lte('created_at', endDate);
      }

      // Time range within day
      if (filters.timeFrom || filters.timeTo) {
        // Will filter client-side after fetch
      }

      // Severity
      const selectedSeverities = Object.entries(filters.eventTypes).filter(([, v]) => v).map(([k]) => k);
      if (selectedSeverities.length > 0 && selectedSeverities.length < 4) {
        q = q.in('severity', selectedSeverities);
      }

      if (filters.module.trim()) q = q.ilike('module', `%${filters.module.trim()}%`);
      if (filters.entityName.trim()) q = q.ilike('entity_name', `%${filters.entityName.trim()}%`);
      if (filters.entityId.trim()) q = q.ilike('entity_id', `%${filters.entityId.trim()}%`);
      if (filters.ip.trim()) q = q.ilike('ip_address', `%${filters.ip.trim()}%`);
      if (filters.userName.trim()) q = q.ilike('user_name', `%${filters.userName.trim()}%`);
      if (filters.details.trim()) q = q.ilike('details', `%${filters.details.trim()}%`);
      if (filters.browser.trim()) q = q.ilike('user_agent', `%${filters.browser.trim()}%`);

      const { data, error } = await q;
      if (error) { toast.error('خطا در بارگذاری رخدادها: ' + error.message); return; }

      let rows = (data || []) as AuditEntry[];

      // Client-side time range filter
      if (filters.timeFrom || filters.timeTo) {
        rows = rows.filter(r => {
          const time = new Date(r.created_at).toTimeString().slice(0, 5);
          if (filters.timeFrom && time < filters.timeFrom) return false;
          if (filters.timeTo && time > filters.timeTo) return false;
          return true;
        });
      }

      setLogs(rows);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { search(); }, []);

  const exportExcel = () => {
    const rows = logs.map((a, i) => ({
      ردیف: i + 1,
      'نوع رویداد': a.action,
      ماژول: a.module || '',
      'نام موجودیت': a.entity_name || '',
      'شناسه موجودیت': a.entity_id || '',
      'نام کاربر': a.user_name || '',
      'آدرس IP': a.ip_address || '',
      'User Agent': a.user_agent || '',
      'سطح رویداد': severityLabel(a.severity),
      'جزئیات': a.details || '',
      'تاریخ': toJalali(a.created_at),
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'رخدادها');
    XLSX.writeFile(wb, `audit_log_${filters.year}_${filters.month}.xlsx`);
    toast.success(`${logs.length} رخداد خروجی گرفته شد`);
  };

  const setFilter = (k: keyof Filters, v: any) => setFilters(f => ({ ...f, [k]: v }));
  const setEventType = (k: keyof Filters['eventTypes'], v: boolean) =>
    setFilters(f => ({ ...f, eventTypes: { ...f.eventTypes, [k]: v } }));

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />
          رویدادها و رخدادها
          <span className="text-sm font-normal text-gray-400">({logs.length} رخداد)</span>
        </h3>
        <div className="flex gap-2">
          <button onClick={() => setFiltersOpen(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-600 dark:text-gray-300 rounded-xl text-sm transition-colors">
            {filtersOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            فیلترها
          </button>
          <button onClick={search} disabled={loading}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            بارگذاری
          </button>
        </div>
      </div>

      {/* Filters Panel */}
      {filtersOpen && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
          {/* Row 1: year, month, time from, time to */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">سال</label>
              <select value={filters.year} onChange={e => setFilter('year', e.target.value)} className={inp}>
                {Array.from({ length: 5 }, (_, i) => CURRENT_JYEAR - i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">ماه</label>
              <select value={filters.month} onChange={e => setFilter('month', e.target.value)} className={inp}>
                <option value="">همه ماه‌ها</option>
                {MONTHS.map((m, i) => (
                  <option key={m} value={m}>{MONTH_LABELS[i]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">ساعت از</label>
              <div className="relative">
                <input type="time" value={filters.timeFrom} onChange={e => setFilter('timeFrom', e.target.value)} className={inp} />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">ساعت تا</label>
              <div className="relative">
                <input type="time" value={filters.timeTo} onChange={e => setFilter('timeTo', e.target.value)} className={inp} />
              </div>
            </div>
          </div>

          {/* Row 2: module, entity name, entity id, ip */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">ماژول</label>
              <select value={filters.module} onChange={e => setFilter('module', e.target.value)} className={inp}>
                <option value="">همه</option>
                <option value="meetings">جلسات</option>
                <option value="tasks">اقدامات</option>
                <option value="chat">چت</option>
                <option value="calendar">تقویم</option>
                <option value="notes">یادداشت</option>
                <option value="contacts">مخاطبین</option>
                <option value="system_config">تنظیمات سیستم</option>
                <option value="profiles">کاربران</option>
                <option value="spark">اسپارک</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">نام موجودیت</label>
              <input value={filters.entityName} onChange={e => setFilter('entityName', e.target.value)} placeholder="نام موجودیت..." className={inp} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">شناسه موجودیت</label>
              <input value={filters.entityId} onChange={e => setFilter('entityId', e.target.value)} placeholder="شناسه..." className={inp} dir="ltr" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">آدرس IP</label>
              <input value={filters.ip} onChange={e => setFilter('ip', e.target.value)} placeholder="192.168..." className={inp} dir="ltr" />
            </div>
          </div>

          {/* Row 3: user name, browser, details */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">نام کاربر</label>
              <input value={filters.userName} onChange={e => setFilter('userName', e.target.value)} placeholder="نام کاربر..." className={inp} />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">مرورگر</label>
              <input value={filters.browser} onChange={e => setFilter('browser', e.target.value)} placeholder="Chrome, Firefox..." className={inp} dir="ltr" />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">جزئیات رویداد</label>
              <input value={filters.details} onChange={e => setFilter('details', e.target.value)} placeholder="جستجو در جزئیات..." className={inp} />
            </div>
          </div>

          {/* Row 4: severity checkboxes */}
          <div>
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2 block">سطح رویداد</label>
            <div className="flex flex-wrap gap-4">
              {([
                { key: 'critical' as const, label: 'بحرانی', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
                { key: 'error' as const, label: 'خطا', color: 'text-red-500', bg: 'bg-red-50 dark:bg-red-900/20' },
                { key: 'warning' as const, label: 'هشدار', color: 'text-amber-600', bg: 'bg-amber-50 dark:bg-amber-900/20' },
                { key: 'info' as const, label: 'اطلاع', color: 'text-blue-600', bg: 'bg-blue-50 dark:bg-blue-900/20' },
              ]).map(({ key, label, color }) => (
                <label key={key} className="flex items-center gap-2 cursor-pointer select-none group">
                  <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${filters.eventTypes[key] ? 'bg-blue-500 border-blue-500' : 'border-gray-300 dark:border-gray-600'}`}
                    onClick={() => setEventType(key, !filters.eventTypes[key])}>
                    {filters.eventTypes[key] && <span className="text-white text-xs font-bold">✓</span>}
                  </div>
                  <span className={`text-sm font-medium ${color}`}>{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-1">
            <button onClick={search} disabled={loading}
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-sm font-medium transition-colors">
              <Search className="w-3.5 h-3.5" />جستجو
            </button>
            <button onClick={exportExcel}
              className="flex items-center gap-2 px-5 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition-colors">
              <Download className="w-3.5 h-3.5" />ارسال تمام موارد
            </button>
            <button onClick={() => setFilters({
              year: String(CURRENT_JYEAR), month: CURRENT_JMONTH,
              timeFrom: '', timeTo: '', eventTypes: { info: true, warning: true, error: true, critical: true },
              module: '', entityName: '', entityId: '', ip: '', userName: '', browser: '', details: '',
            })} className="px-4 py-2.5 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 text-sm transition-colors">
              پاک کردن فیلترها
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 text-right border-b border-gray-100 dark:border-gray-700">
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 w-12">ردیف</th>
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">نوع رویداد</th>
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">ماژول</th>
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">نام موجودیت</th>
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">نام کاربر</th>
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">آدرس IP</th>
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400">تاریخ</th>
                <th className="px-3 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 text-center w-16">مشاهده</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {loading && (
                <tr>
                  <td colSpan={8} className="text-center py-14 text-gray-400">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                    در حال بارگذاری...
                  </td>
                </tr>
              )}
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-14">
                    <Activity className="w-10 h-10 mx-auto mb-3 text-gray-200 dark:text-gray-700" />
                    <p className="text-gray-400 text-sm">هیچ رخدادی با فیلترهای انتخابی یافت نشد</p>
                  </td>
                </tr>
              )}
              {!loading && logs.map((a, i) => {
                return (
                  <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-3 py-2.5 text-gray-400 text-xs font-mono">{i + 1}</td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${severityColor(a.severity)}`}>
                        <SeverityIcon severity={a.severity} />
                        {a.action}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">{a.module || 'عمومی'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400 max-w-[120px] truncate">{a.entity_name || '—'}</td>
                    <td className="px-3 py-2.5 text-xs font-medium text-gray-700 dark:text-gray-300">{a.user_name || '—'}</td>
                    <td className="px-3 py-2.5">
                      {a.ip_address ? (
                        <span className="flex items-center gap-1 text-xs font-mono text-gray-500 dark:text-gray-400">
                          {a.ip_address}
                          <Globe className="w-3 h-3 text-blue-400" />
                        </span>
                      ) : <span className="text-xs text-gray-300 dark:text-gray-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">{toJalali(a.created_at)}</td>
                    <td className="px-3 py-2.5 text-center">
                      <button onClick={() => setSelected(a)}
                        className="p-1.5 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-400 hover:text-blue-500 transition-colors"
                        title="مشاهده جزئیات">
                        <FileText className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {logs.length > 0 && (
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400 flex items-center justify-between">
            <span>{logs.length} رخداد نمایش داده شده</span>
            <button onClick={exportExcel} className="flex items-center gap-1.5 text-gray-500 hover:text-blue-500 transition-colors">
              <Download className="w-3.5 h-3.5" />خروجی اکسل
            </button>
          </div>
        )}
      </div>

      {selected && <EventDetailModal entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
