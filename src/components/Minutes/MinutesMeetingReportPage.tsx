import { ArrowRight, Printer, FileDown, Users, SquareCheck as CheckSquare, FileText } from 'lucide-react';
import {
  MinutesStatusBadge, ConfidentialityBadge, DecisionStatusBadge, DecisionPriorityBadge, ProgressIndicator,
} from './MinutesShared';
import { MOCK_MINUTES, MOCK_DECISIONS, MOCK_INTERNAL_PARTICIPANTS, MOCK_EXTERNAL_PARTICIPANTS, MOCK_AGENDA_ITEMS } from './mockData';

interface Props {
  onNavigate: (page: string) => void;
}

export function MinutesMeetingReportPage({ onNavigate }: Props) {
  const minute = MOCK_MINUTES[0];

  const totalParticipants = MOCK_INTERNAL_PARTICIPANTS.length + MOCK_EXTERNAL_PARTICIPANTS.length;
  const presentCount = MOCK_INTERNAL_PARTICIPANTS.filter(p => p.attendanceStatus === 'present' || p.attendanceStatus === 'online').length;
  const absentCount = MOCK_INTERNAL_PARTICIPANTS.filter(p => p.attendanceStatus === 'absent').length;

  const decisionsByStatus = {
    completed: MOCK_DECISIONS.filter(d => d.status === 'completed').length,
    in_progress: MOCK_DECISIONS.filter(d => d.status === 'in_progress').length,
    not_started: MOCK_DECISIONS.filter(d => d.status === 'not_started').length,
    stopped: MOCK_DECISIONS.filter(d => d.status === 'stopped').length,
  };

  return (
    <div dir="rtl" className="space-y-5">
      {/* Page Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">گزارش جلسه</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{minute.meetingTitle}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onNavigate('minutes-detail')}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
            بازگشت
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 transition-colors">
            <Printer className="w-4 h-4" />
            چاپ
          </button>
          <button className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors">
            <FileDown className="w-4 h-4" />
            خروجی Word
          </button>
        </div>
      </div>

      {/* Meeting Info */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-500" />
          اطلاعات جلسه
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {[
            { label: 'عنوان', value: minute.meetingTitle },
            { label: 'تاریخ', value: minute.meetingDate },
            { label: 'دبیر', value: minute.secretary },
            { label: 'رئیس جلسه', value: minute.chair },
            { label: 'واحد', value: minute.orgUnit || '—' },
            { label: 'وضعیت', value: <MinutesStatusBadge status={minute.status} /> },
            { label: 'محرمانگی', value: <ConfidentialityBadge level={minute.confidentiality} /> },
            { label: 'تعداد مصوبات', value: String(minute.decisionCount) },
          ].map(item => (
            <div key={item.label} className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{item.label}</p>
              <div className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Participant stats */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <Users className="w-5 h-5 text-green-500" />
          آمار شرکت‌کنندگان
        </h2>
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

      {/* Agenda items */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <FileText className="w-5 h-5 text-amber-500" />
          دستور جلسات
        </h2>
        <div className="space-y-3">
          {MOCK_AGENDA_ITEMS.map(item => (
            <div key={item.id} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl">
              <span className="w-6 h-6 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-xs font-bold flex items-center justify-center flex-shrink-0">
                {item.order}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.title}</p>
                {item.discussionResult && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{item.discussionResult}</p>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Decision execution status */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <CheckSquare className="w-5 h-5 text-purple-500" />
          وضعیت اجرای مصوبات
        </h2>

        {/* Mock chart area */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {[
            { label: 'تکمیل‌شده',  count: decisionsByStatus.completed,   color: 'bg-green-500' },
            { label: 'در جریان',   count: decisionsByStatus.in_progress,  color: 'bg-blue-500' },
            { label: 'شروع‌نشده',  count: decisionsByStatus.not_started,  color: 'bg-gray-400' },
            { label: 'متوقف',      count: decisionsByStatus.stopped,      color: 'bg-red-400' },
          ].map(item => (
            <div key={item.label} className="text-center">
              <div className="w-16 h-16 mx-auto rounded-full border-4 border-gray-100 dark:border-gray-700 flex items-center justify-center" style={{ borderColor: item.color.replace('bg-', '') }}>
                <span className="text-xl font-bold text-gray-800 dark:text-gray-200">{item.count}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{item.label}</p>
              <div className={`w-3 h-3 rounded-full mx-auto mt-1 ${item.color}`} />
            </div>
          ))}
        </div>

        {/* Bar chart mock */}
        <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-4 text-center">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">نمودار وضعیت (Mock)</p>
          <div className="flex items-end justify-center gap-3 h-24">
            {[
              { label: 'تکمیل', pct: 80, color: 'bg-green-500' },
              { label: 'جریان', pct: 60, color: 'bg-blue-500' },
              { label: 'شروع', pct: 20, color: 'bg-gray-400' },
              { label: 'متوقف', pct: 10, color: 'bg-red-400' },
            ].map(b => (
              <div key={b.label} className="flex flex-col items-center gap-1 w-12">
                <div className={`w-full rounded-t-lg ${b.color}`} style={{ height: `${b.pct}%` }} />
                <span className="text-xs text-gray-500 dark:text-gray-400">{b.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Decision list */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <h2 className="text-base font-bold text-gray-900 dark:text-white mb-4">مصوبات</h2>
        <div className="space-y-3">
          {MOCK_DECISIONS.map(d => (
            <div key={d.id} className="p-3 border border-gray-100 dark:border-gray-700 rounded-xl">
              <div className="flex items-start justify-between gap-2 mb-2">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{d.title}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <DecisionPriorityBadge priority={d.priority} />
                  <DecisionStatusBadge status={d.status} />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-gray-500 dark:text-gray-400">{d.primaryOwner}</span>
                <ProgressIndicator percent={d.progressPercent} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
