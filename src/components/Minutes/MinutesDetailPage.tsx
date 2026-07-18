import { useEffect, useState } from 'react';
import { ArrowRight, CreditCard as Edit2, Send, Printer, FileDown, Globe, Users, FileText, SquareCheck as CheckSquare, Paperclip, Shield, History, Clock, User, CircleAlert as AlertCircle } from 'lucide-react';
import {
  MinutesStatusBadge, ConfidentialityBadge,
  EmptyState, TableSkeleton,
} from './MinutesShared';
import { supabase } from '../../lib/supabase';
import { getMinuteIdFromUrl, setMinuteIdInUrl, setMinutesPageInUrl } from '../../lib/minutesNavigation';
import type { MinutesStatus, ConfidentialityLevel } from './types';

const TABS = [
  { id: 'summary',      label: 'خلاصه',              icon: FileText },
  { id: 'participants', label: 'شرکت‌کنندگان',        icon: Users },
  { id: 'agenda',       label: 'دستور جلسات',         icon: FileText },
  { id: 'decisions',    label: 'مصوبات',              icon: CheckSquare },
  { id: 'attachments',  label: 'پیوست‌ها',            icon: Paperclip },
  { id: 'approvals',    label: 'تأییدها',             icon: Shield },
  { id: 'history',      label: 'تاریخچه تغییرات',    icon: History },
];

interface MinuteDetail {
  id: string;
  meeting_title_snapshot: string;
  meeting_date_snapshot: string;
  meeting_start_time_snapshot: string | null;
  meeting_end_time_snapshot: string | null;
  meeting_location_snapshot: string | null;
  meeting_type: string | null;
  org_unit_name_snapshot: string | null;
  secretary_name_snapshot: string;
  chair_name_snapshot: string;
  notes: string | null;
  confidentiality: string;
  status: string;
  created_at: string;
  updated_at: string;
}

interface InternalParticipantRow {
  id: string;
  name_snapshot: string;
  position_snapshot: string | null;
  org_unit_name_snapshot: string | null;
  invitation_status: string;
  attendance_status: string | null;
}

interface ExternalParticipantRow {
  id: string;
  full_name: string;
  organization: string | null;
  position: string | null;
  mobile: string | null;
  email: string | null;
  attendance_status: string | null;
}

interface AgendaResultRow {
  id: string;
  sort_order_snapshot: number;
  agenda_title_snapshot: string;
  agenda_description_snapshot: string | null;
  presenter_snapshot: string | null;
  allocated_minutes_snapshot: number | null;
  discussion_result: string | null;
  result_type: string;
  additional_notes: string | null;
}

interface Props {
  onNavigate: (page: string) => void;
  minuteId?: string;
}

export function MinutesDetailPage({ onNavigate, minuteId }: Props) {
  const [activeTab, setActiveTab] = useState('summary');
  const [minute, setMinute] = useState<MinuteDetail | null>(null);
  const [internalParts, setInternalParts] = useState<InternalParticipantRow[]>([]);
  const [externalParts, setExternalParts] = useState<ExternalParticipantRow[]>([]);
  const [agendaResults, setAgendaResults] = useState<AgendaResultRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const fetchDetail = async () => {
      setIsLoading(true);
      setError(null);
      setNotFound(false);

      const targetId = minuteId || getMinuteIdFromUrl();

      if (!targetId) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      const { data: minData, error: minErr } = await supabase
        .from('minutes')
        .select('id, meeting_title_snapshot, meeting_date_snapshot, meeting_start_time_snapshot, meeting_end_time_snapshot, meeting_location_snapshot, meeting_type, org_unit_name_snapshot, secretary_name_snapshot, chair_name_snapshot, notes, confidentiality, status, created_at, updated_at')
        .eq('id', targetId)
        .maybeSingle();

      if (minErr) {
        setError(minErr.message);
        setIsLoading(false);
        return;
      }
      if (!minData) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      setMinute(minData as MinuteDetail);

      const [partsRes, extRes, agendaRes] = await Promise.all([
        supabase
          .from('minutes_participants')
          .select('id, name_snapshot, position_snapshot, org_unit_name_snapshot, invitation_status, attendance_status')
          .eq('minute_id', targetId)
          .order('created_at', { ascending: true }),
        supabase
          .from('minutes_external_participants')
          .select('id, full_name, organization, position, mobile, email, attendance_status')
          .eq('minute_id', targetId)
          .order('created_at', { ascending: true }),
        supabase
          .from('minutes_agenda_results')
          .select('id, sort_order_snapshot, agenda_title_snapshot, agenda_description_snapshot, presenter_snapshot, allocated_minutes_snapshot, discussion_result, result_type, additional_notes')
          .eq('minute_id', targetId)
          .order('sort_order_snapshot', { ascending: true }),
      ]);

      setInternalParts((partsRes.data || []) as InternalParticipantRow[]);
      setExternalParts((extRes.data || []) as ExternalParticipantRow[]);
      setAgendaResults((agendaRes.data || []) as AgendaResultRow[]);
      setIsLoading(false);
    };

    fetchDetail();
  }, [minuteId]);

  const goEdit = () => {
    if (minute) {
      setMinuteIdInUrl(minute.id);
      setMinutesPageInUrl('minutes-edit');
    }
    onNavigate('minutes-edit');
  };

  if (isLoading) {
    return (
      <div dir="rtl" className="space-y-4">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <TableSkeleton rows={3} />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
          <TableSkeleton rows={5} />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div dir="rtl" className="space-y-4">
        <EmptyState
          icon={<AlertCircle className="w-8 h-8" />}
          title="خطا در بارگذاری صورت‌جلسه"
          description={error}
        />
      </div>
    );
  }

  if (notFound || !minute) {
    return (
      <div dir="rtl" className="space-y-4">
        <EmptyState
          icon={<FileText className="w-8 h-8" />}
          title="صورت‌جلسه‌ای یافت نشد"
          description="این صورت‌جلسه وجود ندارد، حذف شده است، یا شما دسترسی مشاهده آن را ندارید."
          action={
            <button
              onClick={() => onNavigate('minutes')}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors"
            >
              <ArrowRight className="w-4 h-4" />
              بازگشت به لیست
            </button>
          }
        />
      </div>
    );
  }

  const lastModified = minute.updated_at
    ? new Date(minute.updated_at).toLocaleDateString('fa-IR')
    : '';

  return (
    <div dir="rtl" className="space-y-4">
      {/* Header card */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              <MinutesStatusBadge status={minute.status as MinutesStatus} />
              <ConfidentialityBadge level={minute.confidentiality as ConfidentialityLevel} />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white leading-snug">{minute.meeting_title_snapshot}</h1>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
              <span className="flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                {minute.meeting_date_snapshot}
              </span>
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                دبیر: {minute.secretary_name_snapshot}
              </span>
              <span className="flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                رئیس: {minute.chair_name_snapshot}
              </span>
              <span className="flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" />
                آخرین ویرایش: {lastModified}
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
            {(minute.status === 'draft' || minute.status === 'rejected') && (
              <button
                onClick={goEdit}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <Edit2 className="w-4 h-4" />
                ویرایش
              </button>
            )}
            <button
              disabled
              title="ارسال برای تأیید (به‌زودی)"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed"
            >
              <Send className="w-4 h-4" />
              ارسال برای تأیید
            </button>
            <button
              disabled
              title="چاپ (به‌زودی)"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed"
            >
              <Printer className="w-4 h-4" />
              چاپ
            </button>
            <button
              disabled
              title="خروجی Word (به‌زودی)"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed"
            >
              <FileDown className="w-4 h-4" />
              Word
            </button>
            <button
              disabled
              title="انتشار (به‌زودی)"
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-600 cursor-not-allowed"
            >
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
          {activeTab === 'summary' && <TabSummary minute={minute} />}
          {activeTab === 'participants' && <TabParticipants internal={internalParts} external={externalParts} />}
          {activeTab === 'agenda' && <TabAgenda items={agendaResults} />}
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

function TabSummary({ minute }: { minute: MinuteDetail }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {[
        { label: 'عنوان جلسه', value: minute.meeting_title_snapshot },
        { label: 'تاریخ جلسه', value: minute.meeting_date_snapshot },
        { label: 'دبیر جلسه', value: minute.secretary_name_snapshot },
        { label: 'رئیس جلسه', value: minute.chair_name_snapshot },
        { label: 'واحد سازمانی', value: minute.org_unit_name_snapshot || '—' },
        { label: 'موقعیت', value: minute.meeting_location_snapshot || '—' },
        { label: 'نوع جلسه', value: minute.meeting_type || '—' },
        { label: 'ساعت شروع', value: minute.meeting_start_time_snapshot || '—' },
        { label: 'ساعت پایان', value: minute.meeting_end_time_snapshot || '—' },
      ].map(item => (
        <div key={item.label} className="bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{item.label}</p>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{item.value}</p>
        </div>
      ))}
      {minute.notes && (
        <div className="col-span-1 sm:col-span-2 lg:col-span-3 bg-gray-50 dark:bg-gray-700/30 rounded-xl p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">یادداشت</p>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{minute.notes}</p>
        </div>
      )}
    </div>
  );
}

// ── Tab: Participants ─────────────────────────────────────────────────────────

function TabParticipants({ internal, external }: { internal: InternalParticipantRow[]; external: ExternalParticipantRow[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">شرکت‌کنندگان داخلی</h3>
        {internal.length === 0 ? (
          <EmptyState title="هنوز ثبت نشده" description="شرکت‌کننده داخلی ثبت نشده است." />
        ) : (
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
                {internal.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-gray-200">{p.name_snapshot}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.position_snapshot || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.org_unit_name_snapshot || '—'}</td>
                    <td className="px-3 py-2.5">
                      <InvitationBadge status={p.invitation_status} />
                    </td>
                    <td className="px-3 py-2.5">
                      {p.attendance_status ? <AttendanceBadge status={p.attendance_status} /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">شرکت‌کنندگان خارجی</h3>
        {external.length === 0 ? (
          <EmptyState title="هنوز ثبت نشده" description="شرکت‌کننده خارجی ثبت نشده است." />
        ) : (
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
                {external.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-3 py-2.5 font-medium text-gray-800 dark:text-gray-200">{p.full_name}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.organization || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.position || '—'}</td>
                    <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400">{p.mobile || '—'}</td>
                    <td className="px-3 py-2.5">{p.attendance_status ? <AttendanceBadge status={p.attendance_status} /> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Agenda ───────────────────────────────────────────────────────────────

function TabAgenda({ items }: { items: AgendaResultRow[] }) {
  if (items.length === 0) {
    return <EmptyState title="هنوز ثبت نشده" description="دستور جلسه‌ای ثبت نشده است." />;
  }
  return (
    <div className="space-y-4">
      {items.map(item => (
        <div key={item.id} className="border border-gray-100 dark:border-gray-700 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <span className="w-7 h-7 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 text-sm font-bold flex items-center justify-center flex-shrink-0">
              {item.sort_order_snapshot}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">{item.agenda_title_snapshot}</p>
              {item.agenda_description_snapshot && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{item.agenda_description_snapshot}</p>}
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
                {item.presenter_snapshot && <span>ارائه‌دهنده: {item.presenter_snapshot}</span>}
                {item.allocated_minutes_snapshot != null && <span>زمان: {item.allocated_minutes_snapshot} دقیقه</span>}
              </div>
              {item.discussion_result && (
                <div className="mt-2 p-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                  <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-0.5">نتیجه:</p>
                  <p className="text-sm text-gray-700 dark:text-gray-300">{item.discussion_result}</p>
                </div>
              )}
            </div>
            <AgendaResultBadge type={item.result_type} />
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab: Decisions ────────────────────────────────────────────────────────────

function TabDecisions() {
  return (
    <EmptyState title="هنوز ثبت نشده" description="مصوباتی برای این صورت‌جلسه ثبت نشده است." />
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
    <EmptyState title="هنوز ثبت نشده" description="تأییدی برای این صورت‌جلسه ثبت نشده است." />
  );
}

// ── Tab: History ──────────────────────────────────────────────────────────────

function TabHistory() {
  return (
    <EmptyState title="هنوز ثبت نشده" description="تاریخچه‌ای برای این صورت‌جلسه ثبت نشده است." />
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
