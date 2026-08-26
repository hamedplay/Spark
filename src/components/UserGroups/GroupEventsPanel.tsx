import { useState, useEffect, useCallback } from 'react';
import { Activity, Search, RefreshCw, ChevronDown, CircleAlert as AlertCircle, TriangleAlert as AlertTriangle, Check, Info, Zap, Loader as Loader2, ListFilter as Filter } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import type { AuditRow } from './types';

export function GroupEventsPanel() {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [moduleFilter, setModuleFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(500);
    if (severityFilter !== 'all') q = q.eq('severity', severityFilter);
    if (moduleFilter !== 'all') q = q.eq('module', moduleFilter);
    const { data } = await q;
    setLogs((data || []) as AuditRow[]);
    setLoading(false);
  }, [severityFilter, moduleFilter]);

  useEffect(() => { load(); }, [load]);

  const modules = Array.from(new Set(logs.map(l => l.module).filter(Boolean))) as string[];
  const filtered = logs.filter(l => !search || l.action.includes(search) || (l.user_name || '').includes(search) || (l.module || '').includes(search) || (l.details || '').includes(search));

  const sevIcon = (s: string) => {
    if (s === 'critical' || s === 'error') return <AlertCircle className="w-3.5 h-3.5 text-red-500" />;
    if (s === 'warning') return <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />;
    if (s === 'success') return <Check className="w-3.5 h-3.5 text-green-500" />;
    return <Info className="w-3.5 h-3.5 text-blue-400" />;
  };

  const sevBadge = (s: string) => {
    if (s === 'critical' || s === 'error') return 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400';
    if (s === 'warning') return 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400';
    if (s === 'success') return 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400';
    return 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400';
  };

  const sevLabel: Record<string, string> = { info: 'اطلاع', success: 'موفق', warning: 'هشدار', error: 'خطا', critical: 'بحرانی' };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Header + filter bar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h3 className="font-bold text-gray-800 dark:text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-blue-500" />رخدادها
          <span className="text-sm font-normal text-gray-400">({filtered.length})</span>
        </h3>
        <div className="flex gap-2">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="جستجو..."
              className="pr-9 pl-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-44" />
          </div>
          <button onClick={() => setShowFilters(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm transition-colors border ${showFilters ? 'bg-blue-500 text-white border-blue-500' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-blue-400'}`}>
            <Filter className="w-4 h-4" />فیلتر
          </button>
          <button onClick={load} className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 p-4 flex flex-wrap gap-4">
          <div className="flex-1 min-w-48">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1.5">سطح رویداد</label>
            <div className="relative">
              <select value={severityFilter} onChange={e => setSeverityFilter(e.target.value)}
                className="w-full appearance-none pr-3 pl-8 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="all">همه سطوح</option>
                <option value="info">اطلاع</option>
                <option value="success">موفق</option>
                <option value="warning">هشدار</option>
                <option value="error">خطا</option>
                <option value="critical">بحرانی</option>
              </select>
              <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div className="flex-1 min-w-48">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1.5">ماژول</label>
            <div className="relative">
              <select value={moduleFilter} onChange={e => setModuleFilter(e.target.value)}
                className="w-full appearance-none pr-3 pl-8 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="all">همه ماژول‌ها</option>
                {modules.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <ChevronDown className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>
          <div className="flex items-end">
            <button onClick={() => { setSeverityFilter('all'); setModuleFilter('all'); setSearch(''); }}
              className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition">
              پاک کردن فیلترها
            </button>
          </div>
        </div>
      )}

      {/* Summary chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(sevLabel).map(([key, label]) => {
          const count = logs.filter(l => l.severity === key).length;
          if (!count) return null;
          return (
            <button key={key} onClick={() => setSeverityFilter(severityFilter === key ? 'all' : key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium border transition-colors ${severityFilter === key ? 'ring-2 ring-offset-1 ring-blue-400' : ''} ${sevBadge(key)} border-transparent`}>
              {sevIcon(key)}{label}: {count}
            </button>
          );
        })}
      </div>

      {/* Log table */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        {loading && <div className="py-12 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-gray-300" /></div>}
        {!loading && filtered.length === 0 && <div className="py-14 text-center text-gray-400 text-sm">رخدادی یافت نشد</div>}
        <div className="divide-y divide-gray-100 dark:divide-gray-700 max-h-[65vh] overflow-y-auto">
          {filtered.map(log => (
            <div key={log.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
              <div className="mt-0.5 flex-shrink-0">{sevIcon(log.severity)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm font-medium text-gray-800 dark:text-white">{log.action}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">{new Date(log.created_at).toLocaleString('fa-IR')}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 flex-wrap">
                  {log.user_name && (
                    <span className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                      <Zap className="w-3 h-3" />{log.user_name}
                    </span>
                  )}
                  {log.module && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${sevBadge(log.severity)}`}>{log.module}</span>
                  )}
                  {log.ip_address && <span className="text-xs text-gray-400 font-mono">{log.ip_address}</span>}
                  {log.details && <span className="text-xs text-gray-400 truncate max-w-xs">{log.details}</span>}
                </div>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${sevBadge(log.severity)}`}>
                {sevLabel[log.severity] || log.severity}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
