import { useEffect, useState } from 'react';
import { ArrowRight, CreditCard as Edit2, Send, Printer, FileDown, Globe, Users, FileText, SquareCheck as CheckSquare, Paperclip, Shield, History, Clock, User, CircleAlert as AlertCircle, CircleCheck as CheckCircle2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import {
  MinutesStatusBadge, ConfidentialityBadge, ApprovalStatusBadge, ApprovalModeBadge,
  EmptyState, TableSkeleton,
} from './MinutesShared';
import { supabase } from '../../lib/supabase';
import { getMinuteIdFromUrl, setMinuteIdInUrl, setMinutesPageInUrl } from '../../lib/minutesNavigation';
import type { MinutesStatus, ConfidentialityLevel, ApprovalMode, ApprovalStatus } from './types';

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
  secretary_user_id: string | null;
  chair_user_id: string | null;
  created_by_user_id: string;
  notes: string | null;
  confidentiality: string;
  status: string;
  approval_mode: string | null;
  revision_number: number;
  submitted_at: string | null;
  secretary_confirmed_at: string | null;
  chair_confirmed_at: string | null;
  published_at: string | null;
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

interface ApprovalRow {
  id: string;
  approver_user_id: string;
  status: ApprovalStatus;
  approved_at: string | null;
  changes_requested_at: string | null;
  approver_name: string;
}

interface ApprovalCommentRow {
  id: string;
  agenda_result_id: string | null;
  reason: string;
  suggested_correction: string | null;
  created_by_user_id: string;
  created_by_name: string;
  created_at: string;
}

interface Props {
  onNavigate: (page: string) => void;
  minuteId?: string;
  currentUserId?: string;
  isAdmin?: boolean;
}

export function MinutesDetailPage({ onNavigate, minuteId, currentUserId, isAdmin }: Props) {
  const [activeTab, setActiveTab] = useState('summary');
  const [minute, setMinute] = useState<MinuteDetail | null>(null);
  const [internalParts, setInternalParts] = useState<InternalParticipantRow[]>([]);
  const [externalParts, setExternalParts] = useState<ExternalParticipantRow[]>([]);
  const [agendaResults, setAgendaResults] = useState<AgendaResultRow[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [approvalComments, setApprovalComments] = useState<ApprovalCommentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [showRequestChanges, setShowRequestChanges] = useState(false);
  const [acting, setActing] = useState(false);

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
        .select('id, meeting_title_snapshot, meeting_date_snapshot, meeting_start_time_snapshot, meeting_end_time_snapshot, meeting_location_snapshot, meeting_type, org_unit_name_snapshot, secretary_name_snapshot, chair_name_snapshot, secretary_user_id, chair_user_id, created_by_user_id, notes, confidentiality, status, approval_mode, revision_number, submitted_at, secretary_confirmed_at, chair_confirmed_at, published_at, created_at, updated_at')
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

      const [partsRes, extRes, agendaRes, approvalsRes] = await Promise.all([
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
        supabase
          .from('minutes_approvals')
          .select('id, approver_user_id, status, approved_at, changes_requested_at')
          .eq('minute_id', targetId)
          .eq('revision_number', (minData as MinuteDetail).revision_number)
          .order('created_at', { ascending: true }),
      ]);

      setInternalParts((partsRes.data || []) as InternalParticipantRow[]);
      setExternalParts((extRes.data || []) as ExternalParticipantRow[]);
      setAgendaResults((agendaRes.data || []) as AgendaResultRow[]);

      // Fetch approver names from profiles
      const approvalRows = (approvalsRes.data || []) as Array<{ id: string; approver_user_id: string; status: ApprovalStatus; approved_at: string | null; changes_requested_at: string | null }>;
      if (approvalRows.length > 0) {
        const userIds = approvalRows.map(a => a.approver_user_id);
        const { data: profiles } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', userIds);
        const nameMap = new Map((profiles || []).map((p: { user_id: string; full_name: string }) => [p.user_id, p.full_name || 'کاربر']));
        setApprovals(approvalRows.map(a => ({
          id: a.id,
          approver_user_id: a.approver_user_id,
          status: a.status,
          approved_at: a.approved_at,
          changes_requested_at: a.changes_requested_at,
          approver_name: nameMap.get(a.approver_user_id) || 'کاربر',
        })));
      } else {
        setApprovals([]);
      }

      // Fetch approval comments
      const { data: commentsData } = await supabase
        .from('minutes_approval_comments')
        .select('id, agenda_result_id, reason, suggested_correction, created_by_user_id, created_at')
        .eq('minute_id', targetId)
        .eq('revision_number', (minData as MinuteDetail).revision_number)
        .order('created_at', { ascending: true });
      if (commentsData && commentsData.length > 0) {
        const creatorIds = [...new Set(commentsData.map((c: { created_by_user_id: string }) => c.created_by_user_id))];
        const { data: creatorProfiles } = await supabase
          .from('profiles')
          .select('user_id, full_name')
          .in('user_id', creatorIds);
        const creatorNameMap = new Map((creatorProfiles || []).map((p: { user_id: string; full_name: string }) => [p.user_id, p.full_name || 'کاربر']));
        setApprovalComments(commentsData.map((c: { id: string; agenda_result_id: string | null; reason: string; suggested_correction: string | null; created_by_user_id: string; created_at: string }) => ({
          id: c.id,
          agenda_result_id: c.agenda_result_id,
          reason: c.reason,
          suggested_correction: c.suggested_correction,
          created_by_user_id: c.created_by_user_id,
          created_by_name: creatorNameMap.get(c.created_by_user_id) || 'کاربر',
          created_at: c.created_at,
        })));
      } else {
        setApprovalComments([]);
      }

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

  // ── Role helpers ──
  const isSecretary = !!(currentUserId && minute?.secretary_user_id === currentUserId);
  const isChair = !!(currentUserId && minute?.chair_user_id === currentUserId);
  const isCreator = !!(currentUserId && minute?.created_by_user_id === currentUserId);
  const canManage = isAdmin || isSecretary || isCreator;
  const myApproval = approvals.find(a => a.approver_user_id === currentUserId && a.status === 'pending');
  const allApprovalsApproved = approvals.length > 0 && approvals.every(a => a.status === 'approved');

  const refresh = () => {
    // Re-fetch by reloading via state reset
    setIsLoading(true);
    setMinute(null);
    setTimeout(() => {
      const targetId = minuteId || getMinuteIdFromUrl();
      if (targetId) {
        // trigger effect by toggling loading — simplest: navigate to same page
        window.dispatchEvent(new CustomEvent('minutes-refresh'));
      }
    }, 0);
  };

  useEffect(() => {
    const handler = () => {
      const targetId = minuteId || getMinuteIdFromUrl();
      if (targetId) {
        // Re-run the fetch effect by toggling a state
        setNotFound(false);
        setError(null);
        setIsLoading(true);
      }
    };
    window.addEventListener('minutes-refresh', handler);
    return () => window.removeEventListener('minutes-refresh', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minuteId]);

  const handleApprove = async () => {
    if (acting || !minute || !myApproval) return;
    setActing(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('approve_minute_revision', {
        p_minute_id: minute.id,
        p_revision_number: minute.revision_number,
      });
      if (rpcError) { toast.error('تأیید ناموفق بود.'); return; }
      if (data?.success === false) {
        const msgs: Record<string, string> = {
          NOT_AN_APPROVER: 'شما تأییدکننده این صورت‌جلسه نیستید.',
          MINUTE_NOT_PENDING: 'صورت‌جلسه در وضعیت تأیید نیست.',
          REVISION_NOT_CURRENT: 'این نسخه دیگر معتبر نیست.',
          APPROVAL_NOT_PENDING: 'تأیید شما قبلاً ثبت شده یا باطل شده است.',
          APPROVAL_NOT_SYSTEM_MODE: 'این صورت‌جلسه از نوع سیستمی نیست.',
        };
        toast.error(msgs[data.error_code] || 'تأیید ناموفق بود.');
        return;
      }
      toast.success(data.message || 'تأیید شما ثبت شد.');
      refresh();
    } finally { setActing(false); }
  };

  const handleSecretaryConfirm = async () => {
    if (acting || !minute) return;
    setActing(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('confirm_minutes_by_secretary', {
        p_minute_id: minute.id,
        p_expected_updated_at: minute.updated_at,
      });
      if (rpcError) { toast.error('تأیید دبیر ناموفق بود.'); return; }
      if (data?.success === false) {
        const msgs: Record<string, string> = {
          MINUTES_NO_PERMISSION: 'شما دبیر این صورت‌جلسه نیستید.',
          MINUTE_NOT_APPROVED: 'ابتدا همه تأییدکنندگان باید تأیید کنند.',
          MINUTE_NOT_PENDING: 'صورت‌جلسه در وضعیت مناسب نیست.',
          MINUTES_VERSION_CONFLICT: 'این صورت‌جلسه توسط کاربر دیگری تغییر کرده است.',
        };
        toast.error(msgs[data.error_code] || 'تأیید دبیر ناموفق بود.');
        return;
      }
      toast.success(data.message || 'تأیید دبیر ثبت شد.');
      refresh();
    } finally { setActing(false); }
  };

  const handleChairPublish = async () => {
    if (acting || !minute) return;
    setActing(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('confirm_and_publish_minutes_by_chair', {
        p_minute_id: minute.id,
        p_expected_updated_at: minute.updated_at,
      });
      if (rpcError) { toast.error('انتشار ناموفق بود.'); return; }
      if (data?.success === false) {
        const msgs: Record<string, string> = {
          MINUTES_NO_PERMISSION: 'شما رئیس این صورت‌جلسه نیستید.',
          SECRETARY_NOT_CONFIRMED: 'ابتدا دبیر باید تأیید کند.',
          NOT_ALL_APPROVERS_APPROVED: 'همه تأییدکنندگان هنوز تأیید نکرده‌اند.',
          MINUTES_VERSION_CONFLICT: 'این صورت‌جلسه توسط کاربر دیگری تغییر کرده است.',
        };
        toast.error(msgs[data.error_code] || 'انتشار ناموفق بود.');
        return;
      }
      toast.success(data.message || 'صورت‌جلسه منتشر شد.');
      refresh();
    } finally { setActing(false); }
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
              {minute.approval_mode && <ApprovalModeBadge mode={minute.approval_mode as ApprovalMode} />}
              {minute.revision_number > 1 && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  نسخه {minute.revision_number}
                </span>
              )}
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
            {(minute.status === 'draft' || minute.status === 'changes_requested') && canManage && (
              <button
                onClick={goEdit}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
              >
                <Edit2 className="w-4 h-4" />
                ویرایش و اصلاح
              </button>
            )}
            {/* Approver: Approve button (system mode, pending_approval, my approval is pending) */}
            {minute.status === 'pending_approval' && minute.approval_mode === 'system' && myApproval && (
              <button
                onClick={handleApprove}
                disabled={acting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-green-600 hover:bg-green-700 text-white transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {acting ? 'در حال...' : 'تأیید'}
              </button>
            )}
            {/* Approver: Request changes button */}
            {minute.status === 'pending_approval' && minute.approval_mode === 'system' && myApproval && (
              <button
                onClick={() => setShowRequestChanges(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-orange-500 hover:bg-orange-600 text-white transition-colors"
              >
                <Send className="w-4 h-4" />
                درخواست اصلاح
              </button>
            )}
            {/* Secretary: Confirm button */}
            {isSecretary && !minute.secretary_confirmed_at &&
             ((minute.approval_mode === 'system' && minute.status === 'approved') ||
              (minute.approval_mode === 'in_person' && minute.status === 'pending_approval')) && (
              <button
                onClick={handleSecretaryConfirm}
                disabled={acting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-teal-600 hover:bg-teal-700 text-white transition-colors disabled:opacity-50"
              >
                <CheckCircle2 className="w-4 h-4" />
                {acting ? 'در حال...' : 'تأیید دبیر'}
              </button>
            )}
            {/* Chair: Publish button */}
            {isChair && minute.secretary_confirmed_at && minute.status !== 'published' && (
              (minute.approval_mode === 'system' && allApprovalsApproved) ||
              minute.approval_mode === 'in_person'
            ) && (
              <button
                onClick={handleChairPublish}
                disabled={acting}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50"
              >
                <Globe className="w-4 h-4" />
                {acting ? 'در حال...' : 'تأیید و انتشار'}
              </button>
            )}
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
          {activeTab === 'approvals' && (
            <TabApprovals
              approvals={approvals}
              comments={approvalComments}
              agendaItems={agendaResults}
              minute={minute}
              currentUserId={currentUserId}
              showRequestChanges={showRequestChanges}
              setShowRequestChanges={setShowRequestChanges}
              onAfterAction={refresh}
            />
          )}
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

// ── Tab: Approvals ────────────────────────────────────────────────────────────

interface TabApprovalsProps {
  approvals: ApprovalRow[];
  comments: ApprovalCommentRow[];
  agendaItems: AgendaResultRow[];
  minute: MinuteDetail;
  currentUserId?: string;
  showRequestChanges: boolean;
  setShowRequestChanges: (v: boolean) => void;
  onAfterAction: () => void;
}

function TabApprovals({ approvals, comments, agendaItems, minute, currentUserId, showRequestChanges, setShowRequestChanges, onAfterAction }: TabApprovalsProps) {
  const approvedCount = approvals.filter(a => a.status === 'approved').length;
  const totalCount = approvals.length;

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-bold text-gray-900 dark:text-white border-b border-gray-100 dark:border-gray-700 pb-3">
        وضعیت تأییدها
      </h2>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{approvedCount}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">تأییدشده</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalCount}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">کل تأییدکنندگان</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{minute.revision_number}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">نسخه فعلی</p>
        </div>
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
          <p className="text-sm font-bold text-gray-900 dark:text-white">
            {minute.secretary_confirmed_at ? 'بله' : 'خیر'}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">تأیید دبیر</p>
        </div>
      </div>

      {/* Approvals list */}
      {approvals.length === 0 ? (
        <EmptyState title="بدون تأییدکننده" description={minute.approval_mode === 'in_person' ? 'در مدل حضوری تأیید سیستمی شرکت‌کنندگان وجود ندارد.' : 'هنوز تأییدکننده‌ای ثبت نشده است.'} />
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">تأییدکننده</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">وضعیت</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500">تاریخ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {approvals.map(a => (
                <tr key={a.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{a.approver_name}</td>
                  <td className="px-4 py-3"><ApprovalStatusBadge status={a.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {a.approved_at ? new Date(a.approved_at).toLocaleDateString('fa-IR') :
                     a.changes_requested_at ? new Date(a.changes_requested_at).toLocaleDateString('fa-IR') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Change requests */}
      {comments.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">درخواست‌های اصلاح</h3>
          {comments.map(c => {
            const agenda = c.agenda_result_id ? agendaItems.find(ag => ag.id === c.agenda_result_id) : null;
            return (
              <div key={c.id} className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-900/40 rounded-xl p-4 space-y-1">
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <span className="font-medium text-orange-700 dark:text-orange-400">{c.created_by_name}</span>
                  <span>•</span>
                  <span>{new Date(c.created_at).toLocaleDateString('fa-IR')}</span>
                </div>
                <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                  {agenda ? `بند: ${agenda.agenda_title_snapshot}` : 'اعتراض کلی'}
                </p>
                <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-medium">علت:</span> {c.reason}</p>
                {c.suggested_correction && (
                  <p className="text-sm text-gray-600 dark:text-gray-400"><span className="font-medium">پیشنهاد اصلاح:</span> {c.suggested_correction}</p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Request changes modal */}
      {showRequestChanges && (
        <RequestChangesModal
          minute={minute}
          agendaItems={agendaItems}
          onClose={() => setShowRequestChanges(false)}
          onSubmitted={() => { setShowRequestChanges(false); onAfterAction(); }}
          currentUserId={currentUserId}
        />
      )}
    </div>
  );
}

// ── Request Changes Modal ─────────────────────────────────────────────────────

interface RequestChangesModalProps {
  minute: MinuteDetail;
  agendaItems: AgendaResultRow[];
  onClose: () => void;
  onSubmitted: () => void;
  currentUserId?: string;
}

interface ChangeItem {
  agenda_result_id: string | null;
  reason: string;
  suggested_correction: string;
}

function RequestChangesModal({ minute, agendaItems, onClose, onSubmitted }: RequestChangesModalProps) {
  const [items, setItems] = useState<ChangeItem[]>([{ agenda_result_id: null, reason: '', suggested_correction: '' }]);
  const [submitting, setSubmitting] = useState(false);

  const addItem = () => setItems(prev => [...prev, { agenda_result_id: null, reason: '', suggested_correction: '' }]);
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const updateItem = (idx: number, field: keyof ChangeItem, value: string | null) =>
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, [field]: value } : it));

  const handleSubmit = async () => {
    if (submitting) return;
    // Validate
    for (const item of items) {
      if (!item.reason.trim()) {
        toast.error('علت برای هر مورد اجباری است.');
        return;
      }
      if (!item.agenda_result_id && !item.suggested_correction.trim()) {
        toast.error('برای اعتراض کلی، پیشنهاد اصلاح اجباری است.');
        return;
      }
    }
    setSubmitting(true);
    try {
      const { data, error: rpcError } = await supabase.rpc('request_minutes_changes', {
        p_minute_id: minute.id,
        p_revision_number: minute.revision_number,
        p_items: items.map(it => ({
          agenda_result_id: it.agenda_result_id || null,
          reason: it.reason,
          suggested_correction: it.suggested_correction || null,
        })),
      });
      if (rpcError) { toast.error('درخواست اصلاح ناموفق بود.'); return; }
      if (data?.success === false) {
        const msgs: Record<string, string> = {
          NOT_AN_APPROVER: 'شما تأییدکننده این صورت‌جلسه نیستید.',
          MINUTE_NOT_PENDING: 'صورت‌جلسه در وضعیت تأیید نیست.',
          REVISION_NOT_CURRENT: 'این نسخه دیگر معتبر نیست.',
          APPROVAL_NOT_PENDING: 'درخواست اصلاح شما قبلاً ثبت شده یا باطل شده است.',
          APPROVAL_NOT_SYSTEM_MODE: 'این صورت‌جلسه از نوع سیستمی نیست.',
          NO_CHANGE_ITEMS: 'حداقل یک مورد لازم است.',
          REASON_REQUIRED: 'علت اجباری است.',
          AGENDA_RESULT_MISMATCH: 'بند انتخاب‌شده متعلق به این صورت‌جلسه نیست.',
          GENERAL_OBJECTION_NEEDS_CORRECTION: 'برای اعتراض کلی پیشنهاد اصلاح اجباری است.',
        };
        toast.error(msgs[data.error_code] || 'درخواست اصلاح ناموفق بود.');
        return;
      }
      toast.success(data.message || 'درخواست اصلاح ثبت شد.');
      onSubmitted();
    } finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">درخواست اصلاح</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <p className="text-sm text-gray-500 dark:text-gray-400">بند یا بندهای مورد اعتراض و علت اصلاح را وارد کنید.</p>
          {items.map((item, idx) => (
            <div key={idx} className="space-y-2 border border-gray-100 dark:border-gray-700 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-gray-500">مورد {idx + 1}</span>
                {items.length > 1 && (
                  <button onClick={() => removeItem(idx)} className="text-xs text-red-500 hover:text-red-600">حذف</button>
                )}
              </div>
              <select
                value={item.agenda_result_id || ''}
                onChange={e => updateItem(idx, 'agenda_result_id', e.target.value || null)}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white"
              >
                <option value="">اعتراض کلی (بدون بند خاص)</option>
                {agendaItems.map(ag => (
                  <option key={ag.id} value={ag.id}>{ag.agenda_title_snapshot}</option>
                ))}
              </select>
              <textarea
                value={item.reason}
                onChange={e => updateItem(idx, 'reason', e.target.value)}
                placeholder="علت اعتراض (اجباری)"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white resize-none"
              />
              <textarea
                value={item.suggested_correction}
                onChange={e => updateItem(idx, 'suggested_correction', e.target.value)}
                placeholder="پیشنهاد اصلاح (برای اعتراض کلی اجباری)"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl dark:bg-gray-700 dark:text-white resize-none"
              />
            </div>
          ))}
          <button onClick={addItem} className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700">
            <Plus className="w-4 h-4" /> افزودن مورد دیگر
          </button>
        </div>
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-100 dark:border-gray-700">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200">انصراف</button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 rounded-xl text-sm bg-orange-500 hover:bg-orange-600 text-white disabled:opacity-50"
          >
            {submitting ? 'در حال ارسال...' : 'ثبت درخواست اصلاح'}
          </button>
        </div>
      </div>
    </div>
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
