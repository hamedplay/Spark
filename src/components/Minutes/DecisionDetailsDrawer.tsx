import { useState, useEffect, useCallback } from 'react';
import { X, ChevronDown, ChevronUp, Clock, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle2, RefreshCw, MessageSquare, Flag, User } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import {
  DecisionStatusBadge, DecisionPriorityBadge, DecisionProgressBar,
} from './MinutesShared';
import type { DecisionRow, DecisionUpdateRow } from './types';
import {
  DECISION_STATUS_LABELS, DECISION_EVENT_TYPE_LABELS,
} from './decisionHelpers';
import { formatJalaliDateForDisplay, formatJalaliTimestamp, toPersianDigits } from '../../lib/minutesDate';

interface DecisionDetailsDrawerProps {
  decision: DecisionRow & { minute_title?: string; meeting_date_snapshot?: string };
  onClose: () => void;
}

type Tab = 'info' | 'history' | 'reports' | 'obstacles' | 'followups';

const FOLLOWUP_METHOD_LABELS: Record<string, string> = {
  phone:  'تلفن',
  letter: 'مکاتبه',
  meeting:'جلسه',
  message:'پیام',
  other:  'سایر',
};

function followupMethodLabel(method: unknown): string {
  if (typeof method !== 'string' || method === '') return '';
  return FOLLOWUP_METHOD_LABELS[method] ?? method;
}

const EVENT_ICON: Record<string, React.ReactNode> = {
  progress:          <RefreshCw className="w-3.5 h-3.5" />,
  status_change:     <ChevronDown className="w-3.5 h-3.5" />,
  report:            <MessageSquare className="w-3.5 h-3.5" />,
  obstacle:          <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />,
  obstacle_resolved: <CheckCircle2 className="w-3.5 h-3.5 text-green-500" />,
  followup:          <Clock className="w-3.5 h-3.5 text-blue-500" />,
  completion:        <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />,
  reopened:          <RefreshCw className="w-3.5 h-3.5 text-amber-500" />,
};

export function DecisionDetailsDrawer({ decision, onClose }: DecisionDetailsDrawerProps) {
  const [tab, setTab] = useState<Tab>('info');
  const [history, setHistory] = useState<DecisionUpdateRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [actorNames, setActorNames] = useState<Record<string, string>>({});

  const fetchHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('minutes_decision_updates')
        .select('*')
        .eq('decision_id', decision.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const rows = (data || []) as DecisionUpdateRow[];
      setHistory(rows);

      const actorIds = [...new Set(rows.map(r => r.created_by_user_id).filter(Boolean))];
      if (actorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles_public')
          .select('user_id, full_name, username')
          .in('user_id', actorIds);
        const nameMap: Record<string, string> = {};
        for (const p of profiles || []) {
          const row = p as { user_id: string; full_name: string | null; username: string | null };
          nameMap[row.user_id] = row.full_name || row.username || row.user_id.slice(0, 8);
        }
        setActorNames(nameMap);
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [decision.id]);

  useEffect(() => {
    if (tab !== 'info') fetchHistory();
  }, [tab, fetchHistory]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const obstacles = history.filter(h => h.event_type === 'obstacle');
  const openObstacles = obstacles.filter(h => !h.resolved_at);
  const reports = history.filter(h => h.event_type === 'report' || (h.event_type === 'progress' && h.update_text));
  const followups = history.filter(h => h.event_type === 'followup');

  const tabs: { id: Tab; label: string }[] = [
    { id: 'info',      label: 'مشخصات' },
    { id: 'history',   label: `تاریخچه (${toPersianDigits(String(history.length))})` },
    { id: 'reports',   label: `گزارش‌ها (${toPersianDigits(String(reports.length))})` },
    { id: 'obstacles', label: `موانع${openObstacles.length > 0 ? ` (${toPersianDigits(String(openObstacles.length))})` : ''}` },
    { id: 'followups', label: `پیگیری‌ها (${toPersianDigits(String(followups.length))})` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" dir="rtl">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl h-full bg-white dark:bg-gray-900 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-bold text-gray-900 dark:text-white line-clamp-2">{decision.title}</h2>
            {decision.minute_title && (
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">{decision.minute_title}</p>
            )}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-colors flex-shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 dark:border-gray-700 px-5 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap ${
                tab === t.id
                  ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {tab === 'info' && <InfoTab decision={decision} />}
          {tab === 'history' && <HistoryTab history={history} loading={historyLoading} actorNames={actorNames} />}
          {tab === 'reports' && <ReportsTab reports={reports} loading={historyLoading} actorNames={actorNames} />}
          {tab === 'obstacles' && <ObstaclesTab obstacles={obstacles} loading={historyLoading} actorNames={actorNames} />}
          {tab === 'followups' && <FollowupsTab followups={followups} loading={historyLoading} actorNames={actorNames} />}
        </div>
      </div>
    </div>
  );
}

// ── InfoTab ───────────────────────────────────────────────────────────────────
function InfoTab({ decision }: { decision: DecisionRow & { minute_title?: string; meeting_date_snapshot?: string } }) {
  const fields = [
    { label: 'عنوان مصوبه', value: decision.title },
    { label: 'شرح', value: decision.description },
    { label: 'جلسه مرتبط', value: decision.minute_title },
    { label: 'تاریخ جلسه', value: decision.meeting_date_snapshot ? formatJalaliDateForDisplay(decision.meeting_date_snapshot) : null },
    { label: 'واحد مسئول', value: decision.responsible_unit_name_snapshot },
    { label: 'تاریخ شروع', value: decision.start_date ? formatJalaliDateForDisplay(decision.start_date) : null },
    { label: 'مهلت انجام', value: decision.due_date ? formatJalaliDateForDisplay(decision.due_date) : null },
    { label: 'تاریخ تکمیل', value: decision.completed_at ? formatJalaliTimestamp(decision.completed_at) : null },
  ];
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <DecisionStatusBadge status={decision.status} />
        <DecisionPriorityBadge priority={decision.priority} />
        {decision.requires_followup && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
            <Flag className="w-3 h-3" /> نیازمند پیگیری
          </span>
        )}
      </div>
      <div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">پیشرفت — {toPersianDigits(String(decision.progress_percent))}٪</p>
        <DecisionProgressBar percent={decision.progress_percent} />
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map(f => f.value ? (
          <div key={f.label} className="space-y-0.5">
            <dt className="text-xs text-gray-400 dark:text-gray-500">{f.label}</dt>
            <dd className="text-sm text-gray-700 dark:text-gray-300">{f.value}</dd>
          </div>
        ) : null)}
      </dl>
      {decision.latest_update && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">آخرین گزارش</p>
          <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{decision.latest_update}</p>
        </div>
      )}
    </div>
  );
}

// ── HistoryTab ────────────────────────────────────────────────────────────────
function HistoryTab({ history, loading, actorNames }: {
  history: DecisionUpdateRow[];
  loading: boolean;
  actorNames: Record<string, string>;
}) {
  if (loading) return <div className="text-sm text-gray-400 text-center py-8">در حال بارگذاری...</div>;
  if (history.length === 0) return <div className="text-sm text-gray-400 text-center py-8">هیچ رویدادی ثبت نشده است.</div>;

  return (
    <div className="relative">
      <div className="absolute right-4 top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-700" />
      <div className="space-y-4">
        {history.map(h => (
          <div key={h.id} className="flex gap-3 relative">
            <div className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 flex items-center justify-center text-gray-500 dark:text-gray-400">
              {EVENT_ICON[h.event_type] ?? <RefreshCw className="w-3.5 h-3.5" />}
            </div>
            <div className="flex-1 bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  {DECISION_EVENT_TYPE_LABELS[h.event_type] ?? h.event_type}
                </span>
                {h.event_title && (
                  <span className="text-xs text-gray-500">— {h.event_title}</span>
                )}
                <span className="text-xs text-gray-400 dark:text-gray-500 mr-auto">
                  {formatJalaliTimestamp(h.created_at)}
                </span>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <User className="w-3 h-3 text-gray-400" />
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {actorNames[h.created_by_user_id] ?? h.created_by_user_id.slice(0, 8)}
                </span>
              </div>
              {(h.previous_status !== h.new_status) && (
                <div className="flex items-center gap-2 mt-1.5 text-xs">
                  <DecisionStatusBadge status={h.previous_status ?? h.new_status} />
                  <span className="text-gray-400">←</span>
                  <DecisionStatusBadge status={h.new_status} />
                </div>
              )}
              {(h.previous_progress_percent !== null && h.previous_progress_percent !== h.new_progress_percent) && (
                <p className="text-xs text-gray-500 mt-1">
                  پیشرفت: {toPersianDigits(String(h.previous_progress_percent ?? 0))}٪ → {toPersianDigits(String(h.new_progress_percent))}٪
                </p>
              )}
              {h.update_text && (
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 whitespace-pre-wrap">{h.update_text}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ReportsTab ─────────────────────────────────────────────────────────────────
function ReportsTab({ reports, loading, actorNames }: {
  reports: DecisionUpdateRow[];
  loading: boolean;
  actorNames: Record<string, string>;
}) {
  if (loading) return <div className="text-sm text-gray-400 text-center py-8">در حال بارگذاری...</div>;
  if (reports.length === 0) return <div className="text-sm text-gray-400 text-center py-8">هیچ گزارشی ثبت نشده است.</div>;

  return (
    <div className="space-y-3">
      {reports.map(r => (
        <div key={r.id} className="bg-gray-50 dark:bg-gray-800/50 rounded-xl p-3">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
              {DECISION_EVENT_TYPE_LABELS[r.event_type] ?? r.event_type}
            </span>
            <span className="text-xs text-gray-400 dark:text-gray-500 mr-auto">{formatJalaliTimestamp(r.created_at)}</span>
          </div>
          <div className="flex items-center gap-1 mb-1.5">
            <User className="w-3 h-3 text-gray-400" />
            <span className="text-xs text-gray-500">{actorNames[r.created_by_user_id] ?? r.created_by_user_id.slice(0, 8)}</span>
          </div>
          {r.update_text && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{r.update_text}</p>}
          {(r.previous_progress_percent !== null && r.previous_progress_percent !== r.new_progress_percent) && (
            <p className="text-xs text-gray-500 mt-1">پیشرفت: {toPersianDigits(String(r.previous_progress_percent ?? 0))}٪ → {toPersianDigits(String(r.new_progress_percent))}٪</p>
          )}
        </div>
      ))}
    </div>
  );
}

// ── ObstaclesTab ──────────────────────────────────────────────────────────────
function ObstaclesTab({ obstacles, loading, actorNames }: {
  obstacles: DecisionUpdateRow[];
  loading: boolean;
  actorNames: Record<string, string>;
}) {
  const [showResolved, setShowResolved] = useState(false);
  if (loading) return <div className="text-sm text-gray-400 text-center py-8">در حال بارگذاری...</div>;

  const open   = obstacles.filter(o => !o.resolved_at);
  const closed = obstacles.filter(o =>  o.resolved_at);

  if (obstacles.length === 0) return <div className="text-sm text-gray-400 text-center py-8">هیچ مانعی ثبت نشده است.</div>;

  const renderObstacle = (o: DecisionUpdateRow) => (
    <div key={o.id} className={`rounded-xl p-3 border ${o.resolved_at ? 'border-green-100 bg-green-50 dark:border-green-900/30 dark:bg-green-900/10' : 'border-orange-200 bg-orange-50 dark:border-orange-900/30 dark:bg-orange-900/10'}`}>
      <div className="flex items-start gap-2">
        <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${o.resolved_at ? 'text-green-500' : 'text-orange-500'}`} />
        <div className="flex-1 min-w-0">
          {o.event_title && <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{o.event_title}</p>}
          {o.update_text  && <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">{o.update_text}</p>}
          <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <User className="w-3 h-3" />
              {actorNames[o.created_by_user_id] ?? o.created_by_user_id.slice(0, 8)}
            </span>
            <span>{formatJalaliTimestamp(o.created_at)}</span>
          </div>
          {o.resolved_at && (
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">
              رفع شده: {formatJalaliTimestamp(o.resolved_at)}
            </p>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      {open.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-orange-500" />
            موانع باز ({toPersianDigits(String(open.length))})
          </h3>
          <div className="space-y-2">{open.map(renderObstacle)}</div>
        </div>
      )}
      {closed.length > 0 && (
        <div>
          <button onClick={() => setShowResolved(s => !s)} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 flex items-center gap-1 mb-2">
            {showResolved ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            موانع رفع‌شده ({toPersianDigits(String(closed.length))})
          </button>
          {showResolved && <div className="space-y-2">{closed.map(renderObstacle)}</div>}
        </div>
      )}
    </div>
  );
}

// ── FollowupsTab ──────────────────────────────────────────────────────────────
function FollowupsTab({ followups, loading, actorNames }: {
  followups: DecisionUpdateRow[];
  loading: boolean;
  actorNames: Record<string, string>;
}) {
  if (loading) return <div className="text-sm text-gray-400 text-center py-8">در حال بارگذاری...</div>;
  if (followups.length === 0) return <div className="text-sm text-gray-400 text-center py-8">هیچ پیگیری‌ای ثبت نشده است.</div>;

  const meta = (m: unknown): Record<string, unknown> => {
    if (m && typeof m === 'object') return m as Record<string, unknown>;
    return {};
  };

  return (
    <div className="space-y-3">
      {followups.map(f => {
        const m = meta(f.event_metadata);
        return (
          <div key={f.id} className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1">
              <Clock className="w-3.5 h-3.5 text-blue-500" />
              <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">پیگیری</span>
              <span className="text-xs text-gray-400 dark:text-gray-500 mr-auto">{formatJalaliTimestamp(f.created_at)}</span>
            </div>
            <div className="flex items-center gap-1 mb-1.5">
              <User className="w-3 h-3 text-gray-400" />
              <span className="text-xs text-gray-500">{actorNames[f.created_by_user_id] ?? f.created_by_user_id.slice(0, 8)}</span>
            </div>
            {f.update_text && <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{f.update_text}</p>}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 text-xs">
              {m.method && (
                <div><dt className="text-gray-400 inline">روش پیگیری: </dt><dd className="text-gray-600 dark:text-gray-400 inline">{followupMethodLabel(m.method)}</dd></div>
              )}
              {m.result && (
                <div><dt className="text-gray-400 inline">نتیجه: </dt><dd className="text-gray-600 dark:text-gray-400 inline">{String(m.result)}</dd></div>
              )}
              {m.next_followup_date && (
                <div><dt className="text-gray-400 inline">تاریخ پیگیری بعدی: </dt><dd className="text-gray-600 dark:text-gray-400 inline">{formatJalaliDateForDisplay(String(m.next_followup_date))}</dd></div>
              )}
            </dl>
          </div>
        );
      })}
    </div>
  );
}
