import { useState, useEffect, useCallback } from 'react';
import { ChartBar as BarChart2, CircleCheck as CheckCircle, Circle as XCircle, CircleMinus as MinusCircle, Clock, ChevronDown, RefreshCw, Loader as Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import toast from 'react-hot-toast';
import {
  TEMPLATE_CATEGORIES as SMS_CATEGORIES,
} from '../../config/templateCatalog';
import { JalaliDateFilter } from '../NotificationsConfig/JalaliDateFilter';
import { jalaliToUtcRange } from '../NotificationsConfig/jalaliDateFilter';
import type { DispatchLog } from './types';
import { CATEGORY_COLORS, STATUS_CONFIG, DELIVERY_STATUS_UI, CATEGORY_LABEL, EVENT_LABEL } from './types';

export function ReportsTab() {
  const [logs, setLogs] = useState<DispatchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterDate, setFilterDate] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const PAGE_SIZE = 25;

  const [stats, setStats] = useState({ sent: 0, failed: 0, skipped: 0, total: 0 });
  const [checkingDeliveryId, setCheckingDeliveryId] = useState<string | null>(null);

  const checkDeliveryStatus = async (log: DispatchLog): Promise<void> => {
    if (checkingDeliveryId === log.id) return;
    setCheckingDeliveryId(log.id);
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${supabaseUrl}/functions/v1/send-sms`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || anonKey}`,
          'Apikey': anonKey,
        },
        body: JSON.stringify({ mode: 'rahyab_rest_delivery_lookup', logId: log.id }),
      });
      const result = await res.json();
      if (result.status === 'delivered') {
        toast.success('پیامک به گوشی تحویل شده است');
      } else if (result.status === 'pending') {
        toast('وضعیت تحویل هنوز مشخص نیست — دقایقی دیگر دوباره بررسی کنید', { icon: '⏳' });
      } else if (result.error || !result.ok) {
        toast.error(result.message || result.error || 'خطا در استعلام وضعیت تحویل');
      } else {
        toast.error(result.message || 'وضعیت تحویل نامشخص');
      }
      if (result.deliveryStatus) {
        setLogs(current => current.map(item =>
          item.id === log.id
            ? { ...item, delivery_status: result.deliveryStatus, delivery_code: result.deliveryCode ?? null, delivery_checked_at: result.deliveryCheckedAt ?? null }
            : item
        ));
      }
    } catch (e: any) {
      toast.error(`خطا: ${e.message}`);
    } finally {
      setCheckingDeliveryId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from('sms_dispatch_logs')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (filterStatus !== 'all') q = q.eq('status', filterStatus);
    if (filterCategory !== 'all') q = q.eq('category', filterCategory);
    if (filterDate) {
      const range = jalaliToUtcRange(filterDate);
      if (range) {
        q = q.gte('created_at', range.start).lte('created_at', range.end);
      }
    }

    const { data, count, error } = await q;
    if (error) {
      toast.error('خطا در بارگذاری گزارش‌ها');
      setLogs([]);
      setTotalCount(0);
    } else {
      setLogs((data || []) as DispatchLog[]);
      setTotalCount(count ?? 0);
    }
    setLoading(false);
  }, [filterStatus, filterCategory, filterDate, page]);

  const loadStats = useCallback(async () => {
    let q = supabase
      .from('sms_dispatch_logs')
      .select('status');
    if (filterCategory !== 'all') q = q.eq('category', filterCategory);
    if (filterDate) {
      const range = jalaliToUtcRange(filterDate);
      if (range) {
        q = q.gte('created_at', range.start).lte('created_at', range.end);
      }
    }
    const { data, error } = await q;
    if (error || !data) return;
    const s = { sent: 0, failed: 0, skipped: 0, total: data.length };
    for (const r of data) {
      if (r.status === 'sent') s.sent++;
      else if (r.status === 'failed') s.failed++;
      else if (r.status === 'skipped') s.skipped++;
    }
    setStats(s);
  }, [filterCategory, filterDate]);

  useEffect(() => { load(); loadStats(); }, [load, loadStats]);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('fa-IR', { year: 'numeric', month: 'short', day: 'numeric' }) +
      '  ' + d.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="space-y-4" dir="rtl">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'کل درخواست‌ها',  value: stats.total,   cls: 'bg-gray-50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-200', icon: <BarChart2 className="w-5 h-5 text-gray-400" /> },
          { label: 'ارسال شده',       value: stats.sent,    cls: 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300', icon: <CheckCircle className="w-5 h-5 text-green-500" /> },
          { label: 'خطا',             value: stats.failed,  cls: 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300', icon: <XCircle className="w-5 h-5 text-red-500" /> },
          { label: 'رد شده',          value: stats.skipped, cls: 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300', icon: <MinusCircle className="w-5 h-5 text-amber-500" /> },
        ].map(s => (
          <div key={s.label} className={`rounded-2xl p-4 flex items-center gap-3 ${s.cls}`}>
            {s.icon}
            <div>
              <p className="text-2xl font-bold">{s.value}</p>
              <p className="text-xs opacity-70">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <select value={filterStatus} onChange={e => { setFilterStatus(e.target.value); setPage(0); }}
              className="appearance-none text-sm pr-3 pl-7 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="all">همه وضعیت‌ها</option>
              <option value="sent">ارسال شده</option>
              <option value="failed">خطا</option>
              <option value="skipped">رد شده</option>
              <option value="pending">در انتظار</option>
            </select>
            <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <div className="relative">
            <select value={filterCategory} onChange={e => { setFilterCategory(e.target.value); setPage(0); }}
              className="appearance-none text-sm pr-3 pl-7 py-2 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500">
              <option value="all">همه دسته‌ها</option>
              {SMS_CATEGORIES.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <ChevronDown className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
          </div>
          <div className="min-w-36">
            <JalaliDateFilter value={filterDate} onChange={(v) => { setFilterDate(v); setPage(0); }} />
          </div>
        </div>
        <button onClick={() => { load(); loadStats(); }}
          className="p-2 rounded-xl bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-500 transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {loading ? (
        <div className="py-12 text-center"><Loader2 className="w-5 h-5 animate-spin mx-auto text-gray-300" /></div>
      ) : logs.length === 0 ? (
        <div className="py-16 text-center bg-white dark:bg-gray-800 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <BarChart2 className="w-10 h-10 text-gray-200 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">هیچ رکوردی یافت نشد</p>
          <p className="text-gray-300 dark:text-gray-600 text-xs mt-1">پس از ارسال اعلان، گزارش‌ها اینجا نمایش داده می‌شوند</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="hidden sm:grid grid-cols-[1fr_auto_auto_auto_auto] gap-3 px-4 py-2.5 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 text-xs font-semibold text-gray-500 dark:text-gray-400">
            <span>جزئیات</span>
            <span className="text-center">دسته</span>
            <span className="text-center">شماره</span>
            <span className="text-center">وضعیت</span>
            <span className="text-center">تاریخ</span>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {logs.map(log => {
              const st = STATUS_CONFIG[log.status] ?? STATUS_CONFIG['pending'];
              const isOpen = expanded === log.id;
              return (
                <div key={log.id}>
                  <button
                    onClick={() => setExpanded(isOpen ? null : log.id)}
                    className="w-full text-right hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                  >
                    <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto_auto_auto] gap-2 sm:gap-3 px-4 py-3 items-center">
                      <div className="flex flex-col gap-0.5 min-w-0">
                        <p className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                          {log.message ? log.message.slice(0, 80) + (log.message.length > 80 ? '...' : '') : '—'}
                        </p>
                        {log.error_text && (
                          <p className="text-xs text-red-500 truncate">{log.error_text}</p>
                        )}
                        {log.provider_name && (
                          <p className="text-xs text-gray-400">سرویس‌دهنده: {log.provider_name}</p>
                        )}
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium self-center ${CATEGORY_COLORS[log.category] || 'bg-gray-100 text-gray-500'}`}>
                        {CATEGORY_LABEL[log.category] || log.category} / {EVENT_LABEL[log.event_type] || log.event_type}
                      </span>
                      <span className="text-xs font-mono text-gray-600 dark:text-gray-300 self-center text-center" dir="ltr">
                        {log.target_phone || '—'}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium self-center ${st.cls}`}>
                        {st.icon}{st.label}
                      </span>
                      <span className="text-xs text-gray-400 self-center text-center whitespace-nowrap">
                        {formatDate(log.created_at)}
                      </span>
                    </div>
                  </button>

                  {isOpen && (
                    <div className="px-4 pb-4 pt-1 bg-gray-50 dark:bg-gray-700/20 border-t border-gray-100 dark:border-gray-700 space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                          <p className="text-gray-400 mb-0.5">وضعیت ارسال</p>
                          <p className="font-medium text-gray-700 dark:text-gray-200">{st.label}</p>
                        </div>
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                          <p className="text-gray-400 mb-0.5">وضعیت تحویل</p>
                          {log.delivery_status
                            ? <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${DELIVERY_STATUS_UI[log.delivery_status]?.className || 'bg-gray-100 text-gray-600'}`}>
                                {DELIVERY_STATUS_UI[log.delivery_status]?.label || log.delivery_status}
                              </span>
                            : <p className="font-medium text-gray-400">بررسی نشده</p>
                          }
                        </div>
                        {[
                          { label: 'دسته', value: `${CATEGORY_LABEL[log.category] || log.category} / ${EVENT_LABEL[log.event_type] || log.event_type}` },
                          { label: 'مخاطب', value: log.audience },
                          { label: 'شماره', value: log.target_phone || '—', mono: true },
                          { label: 'سرویس‌دهنده', value: log.provider_name || 'پیش‌فرض' },
                          { label: 'شناسه سرویس‌دهنده', value: log.provider_message_id || '—', mono: true },
                          { label: 'Pack ID', value: log.pack_id || '—', mono: true },
                          { label: 'کد تحویل', value: log.delivery_code || '—', mono: true },
                          { label: 'هزینه', value: log.cost != null ? String(log.cost) : '—' },
                          { label: 'آخرین استعلام', value: log.delivery_checked_at ? formatDate(log.delivery_checked_at) : '—' },
                          { label: 'تاریخ ارسال', value: formatDate(log.created_at) },
                        ].map(item => (
                          <div key={item.label} className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                            <p className="text-gray-400 mb-0.5">{item.label}</p>
                            <p className={`font-medium text-gray-700 dark:text-gray-200 break-all ${item.mono ? 'font-mono' : ''}`}>{item.value}</p>
                          </div>
                        ))}
                      </div>
                      {log.provider_message_id && log.provider_id && (
                        <div className="flex items-center gap-3">
                          <button
                            onClick={e => { e.stopPropagation(); checkDeliveryStatus(log); }}
                            disabled={checkingDeliveryId === log.id}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded-xl text-xs font-medium transition"
                          >
                            {checkingDeliveryId === log.id
                              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> در حال استعلام...</>
                              : <><RefreshCw className="w-3.5 h-3.5" /> بررسی وضعیت تحویل</>
                            }
                          </button>
                          {log.delivery_checked_at && (
                            <span className="text-xs text-gray-400">آخرین بررسی: {formatDate(log.delivery_checked_at)}</span>
                          )}
                        </div>
                      )}
                      {log.message && (
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-3 border border-gray-100 dark:border-gray-700">
                          <p className="text-xs text-gray-400 mb-1">متن پیامک</p>
                          <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{log.message}</p>
                        </div>
                      )}
                      {log.error_text && (
                        <div className="bg-red-50 dark:bg-red-900/10 rounded-xl p-3 border border-red-100 dark:border-red-800">
                          <p className="text-xs text-red-500 font-semibold mb-1">جزئیات خطا</p>
                          <p className="text-xs text-red-600 dark:text-red-400">{log.error_text}</p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && (totalCount > 0 || page > 0) && (
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0}
            className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 disabled:opacity-40 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            قبلی
          </button>
          <span className="text-sm text-gray-500 dark:text-gray-400">صفحه {page + 1} از {Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}</span>
          <button
            onClick={() => setPage(p => p + 1)}
            disabled={logs.length < PAGE_SIZE}
            className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-gray-700 disabled:opacity-40 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            بعدی
          </button>
        </div>
      )}
    </div>
  );
}
