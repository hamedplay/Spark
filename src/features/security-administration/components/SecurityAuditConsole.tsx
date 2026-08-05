import { useState, useCallback, useEffect, useRef } from 'react';
import { Loader as Loader2, ListFilter as Filter, ChevronDown } from 'lucide-react';
import { loadSecurityAuditPage } from '../services/securityAdministrationService';
import {
  labelEventType, labelCategory, labelSeverity, labelResult, labelErrorCode,
} from '../utils/securityAuditLabels';
import type { AuditEvent, AuditPageCursor } from '../types/securityAdministration';
import { SecurityAuditDetails } from './SecurityAuditDetails';

const PAGE_SIZE = 50;

const CATEGORIES = [
  { value: '', label: 'همه دسته‌ها' },
  { value: 'auth', label: 'احراز هویت' },
  { value: 'mfa', label: 'احراز دومرحله‌ای' },
  { value: 'recovery', label: 'بازیابی' },
  { value: 'session', label: 'نشست' },
  { value: 'access', label: 'دسترسی' },
  { value: 'account_lock', label: 'قفل حساب' },
  { value: 'settings_change', label: 'تغییر تنظیمات' },
];

const SEVERITIES = [
  { value: '', label: 'همه سطوح' },
  { value: 'info', label: 'اطلاع' },
  { value: 'warning', label: 'هشدار' },
  { value: 'error', label: 'خطا' },
  { value: 'critical', label: 'بحرانی' },
];

const RESULTS = [
  { value: '', label: 'همه نتایج' },
  { value: 'success', label: 'موفق' },
  { value: 'failure', label: 'ناموفق' },
  { value: 'denied', label: 'رد شد' },
  { value: 'error', label: 'خطا' },
];

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Props {
  refreshVersion: number;
}

export function SecurityAuditConsole({ refreshVersion }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<AuditPageCursor | null>(null);
  const [category, setCategory] = useState('');
  const [severity, setSeverity] = useState('');
  const [result, setResult] = useState('');
  const [eventType, setEventType] = useState('');
  const [actorUserId, setActorUserId] = useState('');
  const [targetUserId, setTargetUserId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [actorError, setActorError] = useState<string | null>(null);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const generationRef = useRef(0);

  const buildParams = useCallback(() => {
    const actor = actorUserId.trim();
    const target = targetUserId.trim();
    let actorUuid: string | null = null;
    let targetUuid: string | null = null;

    if (actor) {
      if (!UUID_REGEX.test(actor)) {
        setActorError('UUID نامعتبر است.');
        return null;
      }
      actorUuid = actor;
      setActorError(null);
    } else {
      setActorError(null);
    }

    if (target) {
      if (!UUID_REGEX.test(target)) {
        setTargetError('UUID نامعتبر است.');
        return null;
      }
      targetUuid = target;
      setTargetError(null);
    } else {
      setTargetError(null);
    }

    let fromIso: string | null = null;
    let toIso: string | null = null;
    if (fromDate) fromIso = new Date(fromDate).toISOString();
    if (toDate) {
      const d = new Date(toDate);
      d.setHours(23, 59, 59, 999);
      toIso = d.toISOString();
    }

    return {
      category: category || null,
      severity: severity || null,
      result: result || null,
      eventType: eventType || null,
      actorUserId: actorUuid,
      targetUserId: targetUuid,
      from: fromIso,
      to: toIso,
      limit: PAGE_SIZE,
    };
  }, [category, severity, result, eventType, actorUserId, targetUserId, fromDate, toDate]);

  const loadInitial = useCallback(async () => {
    const gen = ++generationRef.current;
    const params = buildParams();
    if (!params) return;

    setLoading(true);
    setEvents([]);
    setHasMore(false);
    setCursor(null);
    setSelectedEvent(null);

    try {
      const res = await loadSecurityAuditPage(params);
      if (gen !== generationRef.current) return;
      if (res.ok) {
        setEvents(res.events);
        setHasMore(res.has_more);
        setCursor(res.next_cursor);
      } else {
        setEvents([]);
      }
    } finally {
      if (gen === generationRef.current) setLoading(false);
    }
  }, [buildParams]);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial, refreshVersion]);

  const handleLoadMore = useCallback(async () => {
    if (!hasMore || !cursor || loadingMore) return;
    const gen = generationRef.current;
    setLoadingMore(true);
    try {
      const res = await loadSecurityAuditPage({
        ...buildParams(),
        beforeCreatedAt: cursor.before_created_at,
        beforeId: cursor.before_id,
      });
      if (gen !== generationRef.current) return;
      if (res.ok) {
        setEvents((prev) => {
          const existingIds = new Set(prev.map((e) => e.id));
          const newEvents = res.events.filter((e) => !existingIds.has(e.id));
          return [...prev, ...newEvents];
        });
        setHasMore(res.has_more);
        setCursor(res.next_cursor);
      }
    } finally {
      if (gen === generationRef.current) setLoadingMore(false);
    }
  }, [hasMore, cursor, loadingMore, buildParams]);

  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-wrap gap-3 items-center">
        <Filter className="w-4 h-4 text-gray-400" />
        <Select value={category} onChange={setCategory} options={CATEGORIES} />
        <Select value={severity} onChange={setSeverity} options={SEVERITIES} />
        <Select value={result} onChange={setResult} options={RESULTS} />
        <input
          type="text"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          placeholder="نوع رویداد..."
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <input
          type="text"
          value={actorUserId}
          onChange={(e) => setActorUserId(e.target.value)}
          placeholder="Actor UUID..."
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          dir="ltr"
        />
        <input
          type="text"
          value={targetUserId}
          onChange={(e) => setTargetUserId(e.target.value)}
          placeholder="Target UUID..."
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
          dir="ltr"
        />
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {actorError && <p className="text-xs text-red-500">{actorError}</p>}
      {targetError && <p className="text-xs text-red-500">{targetError}</p>}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">رویدادی یافت نشد.</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-2xl border border-gray-100 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr className="text-right text-xs text-gray-500 dark:text-gray-400">
                  <th className="px-3 py-3 font-medium">زمان</th>
                  <th className="px-3 py-3 font-medium">نوع رویداد</th>
                  <th className="px-3 py-3 font-medium">دسته</th>
                  <th className="px-3 py-3 font-medium">Severity</th>
                  <th className="px-3 py-3 font-medium">Result</th>
                  <th className="px-3 py-3 font-medium">Actor</th>
                  <th className="px-3 py-3 font-medium">Target</th>
                  <th className="px-3 py-3 font-medium">Error Code</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {events.map((event) => (
                  <tr
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    className="hover:bg-gray-50 dark:hover:bg-gray-700/30 cursor-pointer"
                  >
                    <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">
                      {new Date(event.created_at).toLocaleString('fa-IR')}
                    </td>
                    <td className="px-3 py-2.5 text-gray-800 dark:text-white">{labelEventType(event.event_type)}</td>
                    <td className="px-3 py-2.5"><CategoryBadge category={event.event_category} /></td>
                    <td className="px-3 py-2.5"><SeverityBadge severity={event.severity} /></td>
                    <td className="px-3 py-2.5"><ResultBadge result={event.result} /></td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">{event.actor?.display_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">{event.target?.display_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-400">{event.error_code ? labelErrorCode(event.error_code) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <button
              type="button"
              onClick={handleLoadMore}
              disabled={loadingMore}
              className="flex items-center gap-2 mx-auto px-5 py-2.5 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-xl transition disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
              بارگذاری بیشتر
            </button>
          )}
        </>
      )}

      {selectedEvent && (
        <SecurityAuditDetails event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </div>
  );
}

function Select({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

function CategoryBadge({ category }: { category: string }) {
  return <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400">{labelCategory(category)}</span>;
}

function SeverityBadge({ severity }: { severity: string }) {
  const colors: Record<string, string> = {
    info: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    warning: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    critical: 'bg-red-200 text-red-800 dark:bg-red-900/50 dark:text-red-200',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[severity] ?? colors.info}`}>{labelSeverity(severity)}</span>;
}

function ResultBadge({ result }: { result: string | null }) {
  if (!result) return <span className="text-gray-300">—</span>;
  const colors: Record<string, string> = {
    success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    failure: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    denied: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    error: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[result] ?? colors.success}`}>{labelResult(result)}</span>;
}
