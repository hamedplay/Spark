import { useEffect, useState } from 'react';
import { ArrowRight, Printer, Users, SquareCheck as CheckSquare, FileText, Loader as Loader2 } from 'lucide-react';
import {
  MinutesStatusBadge, ConfidentialityBadge, DecisionStatusBadge, DecisionPriorityBadge, ProgressIndicator,
  EmptyState, TableSkeleton,
} from './MinutesShared';
import { supabase } from '../../lib/supabase';
import { getMinuteIdFromUrl, setMinutesPageInUrl } from '../../lib/minutesNavigation';
import type { MinutesStatus, ConfidentialityLevel, DecisionStatus, DecisionPriority } from './types';

interface Props {
  onNavigate: (page: string) => void;
}

interface MinuteRow {
  id: string;
  meeting_title_snapshot: string;
  meeting_date_snapshot: string;
  secretary_name_snapshot: string;
  chair_name_snapshot: string;
  org_unit_name_snapshot: string | null;
  confidentiality: ConfidentialityLevel;
  status: MinutesStatus;
  approval_mode: string | null;
  revision_number: number;
  notes: string | null;
}

interface InternalPartRow {
  id: string;
  user_id: string | null;
  name_snapshot: string;
  position_snapshot: string | null;
  org_unit_name_snapshot: string | null;
  attendance_status: string;
}

interface ExternalPartRow {
  id: string;
  full_name: string;
  organization: string | null;
  attendance_status: string;
}

interface AgendaRow {
  id: string;
  sort_order: number;
  title: string;
  discussion_result: string | null;
  result_type: string;
}

interface DecisionRow {
  id: string;
  title: string;
  status: DecisionStatus;
  priority: DecisionPriority;
  progress_percent: number;
  primary_owner_user_id: string;
  responsible_unit_name_snapshot: string | null;
}

const DECISION_STATUS_LABELS: Record<string, string> = {
  completed: 'تکمیل‌شده',
  in_progress: 'در جریان',
  not_started: 'شروع‌نشده',
  stopped: 'متوقف',
  planned: 'برنامه‌ریزی‌شده',
  waiting_coordination: 'منتظر هماهنگی',
  waiting_approval: 'منتظر تأیید',
};

export function MinutesMeetingReportPage({ onNavigate }: Props) {
  const [minute, setMinute] = useState<MinuteRow | null>(null);
  const [internal, setInternal] = useState<InternalPartRow[]>([]);
  const [external, setExternal] = useState<ExternalPartRow[]>([]);
  const [agenda, setAgenda] = useState<AgendaRow[]>([]);
  const [decisions, setDecisions] = useState<DecisionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const id = getMinuteIdFromUrl();
    if (!id) { setError('صورت‌جلسه‌ای انتخاب نشده است.'); setLoading(false); return; }
    (async () => {
      setLoading(true); setError(null);
      try {
        const [mRes, iRes, eRes, aRes, dRes] = await Promise.all([
          supabase.from('minutes').select('id,meeting_title_snapshot,meeting_date_snapshot,secretary_name_snapshot,chair_name_snapshot,org_unit_name_snapshot,confidentiality,status,approval_mode,revision_number,notes').eq('id', id).maybeSingle(),
          supabase.from('minutes_participants').select('id,user_id,name_snapshot,position_snapshot,org_unit_name_snapshot,attendance_status').eq('minute_id', id).order('created_at'),
          supabase.from('minutes_external_participants').select('id,full_name,organization,attendance_status').eq('minute_id', id).order('created_at'),
          supabase.from('minutes_agenda_results').select('id,sort_order,title,discussion_result,result_type').eq('minute_id', id).order('sort_order'),
          supabase.from('minutes_decisions').select('id,title,status,priority,progress_percent,primary_owner_user_id,responsible_unit_name_snapshot').eq('minute_id', id).order('created_at'),
        ]);
        if (mRes.error) throw mRes.error;
        if (!mRes.data) { setError('صورت‌جلسه یافت نشد.'); setLoading(false); return; }
        if (cancelled) return;
        setMinute(mRes.data as MinuteRow);
        setInternal((iRes.data || []) as InternalPartRow[]);
        setExternal((eRes.data || []) as ExternalPartRow[]);
        setAgenda((aRes.data || []) as AgendaRow[]);
        setDecisions((dRes.data || []) as DecisionRow[]);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'بارگذاری گزارش ناموفق بود.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handlePrint = () => window.print();

  const goBack = () => {
    setMinutesPageInUrl('minutes-detail');
    onNavigate('minutes-detail');
  };

  if (loading) return <div dir="rtl" className="space-y-5"><h1 className="text-2xl font-bold text-gray-900 dark:text-white">گزارش جلسه</h1><TableSkeleton rows={5} /></div>;
  if (error) return <div dir="rtl" className="space-y-5"><h1 className="text-2xl font-bold text-gray-900 dark:text-white">گزارش جلسه</h1><div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-sm text-red-600 dark:text-red-400">{error}</div></div>;
  if (!minute) return null;

  const totalParticipants = internal.length + external.length;
  const presentCount = internal.filter(p => p.attendance_status === 'present' || p.attendance_status === 'online').length;
  const absentCount = internal.filter(p => p.attendance_status === 'absent').length;

  const decisionsByStatus: Record<string, number> = {};
  for (const d of decisions) {
    decisionsByStatus[d.status] = (decisionsByStatus[d.status] || 0) + 1;
  }

  const statusCards = [
    { label: 'تکمیل‌شده', key: 'completed', color: 'bg-green-500' },
    { label: 'در جریان', key: 'in_progress', color: 'bg-blue-500' },
    { label: 'شروع‌نشده', key: 'not_started', color: 'bg-gray-400' },
    { label: 'متوقف', key: 'stopped', color: 'bg-red-400' },
  ];

  const maxCount = Math.max(1, ...Object.values(decisionsByStatus));

  return (
    <div dir="rtl" className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">گزارش جلسه</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{minute.meeting_title_snapshot}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={goBack} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
            <ArrowRight className="w-4 h-4" /> بازگشت
          </button>
          <button onClick={handlePrint} className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 transition-colors">
            <Printer className="w-4 h-4" /> چاپ
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><FileText className="w-5 h-5 text-blue-500" /> اطلاعات جلسه</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: 'عنوان', value: minute.meeting_title_snapshot },
            { label: 'تاریخ', value: minute.meeting_date_snapshot },
            { label: 'دبیر', value: minute.secretary_name_snapshot },
            { label: 'رئیس جلسه', value: minute.chair_name_snapshot },
            { label: 'واحد', value: minute.org_unit_name_snapshot || '—' },
            { label: 'وضعیت', value: <MinutesStatusBadge status={minute.status} /> },
            { label: 'محرمانگی', value: <ConfidentialityBadge level={minute.confidentiality} /> },
            { label: 'تعداد مصوبات', value: String(decisions.length) },
          ].map(item => (
            <div key={item.label} className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{item.label}</p>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><Users className="w-5 h-5 text-green-500" /> آمار شرکت‌کنندگان</h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl">
            <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">{totalParticipants}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">کل دعوت‌شدگان</p>
          </div>
          <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-xl">
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">{presentCount}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">حاضر</p>
          </div>
          <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-xl">
            <p className="text-3xl font-bold text-red-600 dark:text-red-400">{absentCount}</p>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">غایب</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><FileText className="w-5 h-5 text-amber-500" /> دستور جلسات</h2>
        {agenda.length === 0 ? (
          <EmptyState icon={<FileText className="w-8 h-8" />} title="دستور جلسه‌ای ثبت نشده" />
        ) : (
          <div className="space-y-3">
            {agenda.map(item => (
              <div key={item.id} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
                <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold flex items-center justify-center flex-shrink-0">{item.sort_order}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.title}</p>
                  {item.discussion_result && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.discussion_result}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2"><CheckSquare className="w-5 h-5 text-purple-500" /> وضعیت اجرای مصوبات</h2>
        {decisions.length === 0 ? (
          <EmptyState icon={<CheckSquare className="w-8 h-8" />} title="مصوبه‌ای ثبت نشده" />
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
              {statusCards.map(item => (
                <div key={item.key} className="text-center">
                  <div className="w-16 h-16 mx-auto rounded-full border-4 border-gray-100 dark:border-gray-700 flex items-center justify-center">
                    <span className="text-xl font-bold text-gray-800 dark:text-gray-200">{decisionsByStatus[item.key] || 0}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.label}</p>
                  <div className={`w-3 h-3 rounded-full mx-auto mt-1 ${item.color}`} />
                </div>
              ))}
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-4">
              <div className="flex items-end justify-center gap-3 h-24">
                {statusCards.map(item => {
                  const count = decisionsByStatus[item.key] || 0;
                  const pct = maxCount > 0 ? Math.round((count / maxCount) * 100) : 0;
                  return (
                    <div key={item.label} className="flex flex-col items-center gap-1 w-12">
                      <div className={`w-full rounded-t-lg ${item.color}`} style={{ height: `${Math.max(pct, count > 0 ? 8 : 0)}%` }} />
                      <span className="text-xs text-gray-500 dark:text-gray-400">{item.label}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">مصوبات</h2>
        {decisions.length === 0 ? (
          <EmptyState icon={<CheckSquare className="w-8 h-8" />} title="مصوبه‌ای ثبت نشده" />
        ) : (
          <div className="space-y-3">
            {decisions.map(d => (
              <div key={d.id} className="p-3 border border-gray-100 dark:border-gray-700 rounded-xl">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{d.title}</p>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <DecisionPriorityBadge priority={d.priority} />
                    <DecisionStatusBadge status={d.status} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-gray-500 dark:text-gray-400">{d.responsible_unit_name_snapshot || '—'}</span>
                  <ProgressIndicator percent={d.progress_percent} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
