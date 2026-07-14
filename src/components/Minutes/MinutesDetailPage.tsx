import { useState } from 'react';
import { ArrowRight, CreditCard as Edit2, Send, Printer, FileDown, Globe, Users, FileText, SquareCheck as CheckSquare, Paperclip, Shield, History, Clock, User } from 'lucide-react';
import {
  MinutesStatusBadge, ConfidentialityBadge, DecisionStatusBadge,
  DecisionPriorityBadge, ProgressIndicator, ApprovalStatusBadge,
} from './MinutesShared';
import {
  MOCK_MINUTES, MOCK_INTERNAL_PARTICIPANTS, MOCK_EXTERNAL_PARTICIPANTS,
  MOCK_AGENDA_ITEMS, MOCK_DECISIONS, MOCK_APPROVALS, MOCK_HISTORY,
} from './mockData';

const TABS = [
  { id: 'summary',      label: 'خلاصه',              icon: FileText },
  { id: 'participants', label: 'شرکت‌کنندگان',        icon: Users },
  { id: 'agenda',       label: 'دستور جلسات',         icon: FileText },
  { id: 'decisions',    label: 'مصوبات',              icon: CheckSquare },
  { id: 'attachments',  label: 'پیوست‌ها',            icon: Paperclip },
  { id: 'approvals',    label: 'تأییدها',             icon: Shield },
  { id: 'history',      label: 'تاریخچه تغییرات',    icon: History },
];

interface Props {
  onNavigate: (page: string) => void;
}

export function MinutesDetailPage({ onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState('summary');

  const minute = MOCK_MINUTES[0];

  return (
    <div dir="rtl" className="space-y-4">
      {/* Header card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <MinutesStatusBadge status={minute.status} />
              <ConfidentialityBadge level={minute.confidentiality} />
              <span className="text-xs text-gray-400 dark:text-gray-500">نسخه {minute.version}</span>
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-snug">{minute.meetingTitle}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {minute.meetingDate}
              </span>
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                دبیر: {minute.secretary}
              </span>
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                رئیس: {minute.chair}
              </span>
              <span className="flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                آخرین ویرایش: {minute.lastModified}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => onNavigate('minutes')}
              aria-label="بازگشت"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              بازگشت
            </button>
            <button
              onClick={() => onNavigate('minutes-edit')}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              ویرایش
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 hover:bg-amber-200 transition-colors">
              <Send className="w-4 h-4" />
              ارسال برای تأیید
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
              <Printer className="w-4 h-4" />
              چاپ
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 transition-colors">
              <FileDown className="w-4 h-4" />
              Word
            </button>
            <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 hover:bg-green-100 transition-colors">
              <Globe className="w-4 h-4" />
              انتشار
            </button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {/* Tab bar */}
        <div className="flex overflow-x-auto border-b border-gray-100 dark:border-gray-700">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === t.id
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                {t.label}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        <div className="p-5">
          {activeTab === 'summary' && <TabSummary />}
          {activeTab === 'participants' && <TabParticipants />}
          {activeTab === 'agenda' && <TabAgenda />}
          {activeTab === 'decisions' && <TabDecisions />}
          {activeTab === 'attachments' && <TabAttachments />}
          {activeTab === 'approvals' && <TabApprovals />}
          {activeTab === 'history' && <TabHistory />}
        </div>
      </div>
    </div>
  );
}

// ── Tab: Summary ─────────────────────────────────────────────────────────────

function TabSummary() {
  const m = MOCK_MINUTES[0];
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[
        { label: 'عنوان جلسه', value: m.meetingTitle },
        { label: 'تاریخ جلسه', value: m.meetingDate },
        { label: 'دبیر جلسه', value: m.secretary },
        { label: 'رئیس جلسه', value: m.chair },
        { label: 'واحد سازمانی', value: m.orgUnit || '—' },
        { label: 'تعداد مصوبات', value: String(m.decisionCount) },
      ].map(item => (
        <div key={item.label} className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{item.label}</p>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Participants ─────────────────────────────────────────────────────────

function TabParticipants() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">شرکت‌کنندگان داخلی</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                {['نام','سمت','واحد','وضعیت دعوت','وضعیت حضور'].map(h => (
                  <th key={h} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {MOCK_INTERNAL_PARTICIPANTS.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-gray-200">{p.name}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.position}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.orgUnit}</td>
                  <td className="px-3 py-2.5">
                    <InvitationBadge status={p.invitationStatus} />
                  </td>
                  <td className="px-3 py-2.5">
                    <AttendanceBadge status={p.attendanceStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">شرکت‌کنندگان خارجی</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                {['نام','سازمان','سمت','موبایل','وضعیت حضور'].map(h => (
                  <th key={h} className="px-3 py-2 text-right text-xs font-semibold text-gray-500 dark:text-gray-400">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {MOCK_EXTERNAL_PARTICIPANTS.map(p => (
                <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-gray-200">{p.fullName}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.organization}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.position}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.mobile || '—'}</td>
                  <td className="px-3 py-2.5"><AttendanceBadge status={p.attendanceStatus} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Tab: Agenda ───────────────────────────────────────────────────────────────

function TabAgenda() {
  return (
    <div className="space-y-4">
      {MOCK_AGENDA_ITEMS.map(item => (
        <div key={item.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
              {item.order}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{item.title}</p>
              {item.description && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{item.description}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
                {item.presenter && <span>ارائه‌دهنده: {item.presenter}</span>}
                {item.allocatedTime && <span>زمان: {item.allocatedTime} دقیقه</span>}
              </div>
              {item.discussionResult && (
                <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">نتیجه:</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{item.discussionResult}</p>
                </div>
              )}
            </div>
            <AgendaResultBadge type={item.resultType} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Decisions ────────────────────────────────────────────────────────────

function TabDecisions() {
  return (
    <div className="space-y-4">
      {MOCK_DECISIONS.map(d => (
        <div key={d.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-start justify-between gap-3 mb-3">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{d.title}</p>
            <div className="flex items-center gap-2 flex-shrink-0">
              <DecisionPriorityBadge priority={d.priority} />
              <DecisionStatusBadge status={d.status} />
            </div>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">{d.description}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs text-gray-500 dark:text-gray-400 mb-3">
            <span>مسئول: {d.primaryOwner}</span>
            <span>واحد: {d.responsibleUnit || '—'}</span>
            {d.deadline && <span>مهلت: {d.deadline}</span>}
            {d.startDate && <span>شروع: {d.startDate}</span>}
          </div>
          <ProgressIndicator percent={d.progressPercent} />
        </div>
      ))}
    </div>
  );
}

// ── Tab: Attachments ──────────────────────────────────────────────────────────

function TabAttachments() {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
      <Paperclip className="w-10 h-10 text-gray-300 dark:text-gray-600" />
      <p className="text-sm text-gray-500 dark:text-gray-400">هیچ پیوستی وجود ندارد.</p>
    </div>
  );
}

// ── Tab: Approvals ────────────────────────────────────────────────────────────

function TabApprovals() {
  return (
    <div className="space-y-3">
      {MOCK_APPROVALS.map(a => (
        <div key={a.id} className="flex items-center gap-4 p-3 border border-gray-100 dark:border-gray-700 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
          <span className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
            {a.approvalOrder}
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{a.approverName}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{a.position} · {a.unit}</p>
          </div>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {a.method === 'digital' ? 'سیستمی' : 'حضوری'}
          </span>
          <ApprovalStatusBadge status={a.status} />
        </div>
      ))}
    </div>
  );
}

// ── Tab: History ──────────────────────────────────────────────────────────────

function TabHistory() {
  return (
    <div className="relative pr-6">
      <div className="absolute right-2 top-0 bottom-0 w-0.5 bg-gray-200 dark:bg-gray-700" />
      <div className="space-y-4">
        {MOCK_HISTORY.map(h => (
          <div key={h.id} className="relative">
            <div className="absolute right-[-1.25rem] top-1.5 w-3 h-3 rounded-full bg-blue-500 ring-2 ring-white dark:ring-gray-800" />
            <div className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2 mb-1">
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{h.action}</p>
                <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">{h.timestamp}</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{h.actor}</p>
              {h.notes && <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 italic">{h.notes}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Local status badges
// ─────────────────────────────────────────────────────────────────────────────

const INV_LABELS: Record<string, { label: string; cls: string }> = {
  invited:    { label: 'دعوت‌شده',    cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  accepted:   { label: 'پذیرفته',    cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  declined:   { label: 'ردشده',      cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  no_response:{ label: 'بدون پاسخ',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  delegated:  { label: 'تفویض‌شده',  cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' },
};

function InvitationBadge({ status }: { status: string }) {
  const cfg = INV_LABELS[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>;
}

const ATT_LABELS: Record<string, { label: string; cls: string }> = {
  present:           { label: 'حاضر',         cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  absent:            { label: 'غایب',          cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  online:            { label: 'آنلاین',        cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  late:              { label: 'با تأخیر',      cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  delegate_attended: { label: 'حضور جانشین',  cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
};

function AttendanceBadge({ status }: { status: string }) {
  const cfg = ATT_LABELS[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${cfg.cls}`}>{cfg.label}</span>;
}

const AGENDA_RESULT_LABELS: Record<string, { label: string; cls: string }> = {
  discussion: { label: 'بحث و بررسی',   cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  action:     { label: 'اقدام اجرایی',   cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  resolution: { label: 'مصوبه',         cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  deferred:   { label: 'موکول‌شده',     cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  no_result:  { label: 'بدون نتیجه',    cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
};

function AgendaResultBadge({ type }: { type: string }) {
  const cfg = AGENDA_RESULT_LABELS[type] || { label: type, cls: 'bg-gray-100 text-gray-600' };
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium flex-shrink-0 ${cfg.cls}`}>{cfg.label}</span>;
}
