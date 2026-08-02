import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Users, SquareCheck as CheckSquare, Paperclip, Shield, History, Signature as FileSignature } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { getMinuteIdFromUrl, setMinuteIdInUrl, setMinutesPageInUrl, getMinutesTabFromUrl, setMinutesTabInUrl, type MinutesDetailTab } from '../../lib/minutesNavigation';
import type { DecisionRow } from './types';
import { MinutesPrintView } from './MinutesPrintView';
import { toDocData } from './minutesToDocData';
import { exportMinutesToWord } from '../../lib/minutesWordExport';
import type { MinutesDocumentData } from './MinutesDocumentData';
import { fetchMinutesConfig } from './fetchMinutesConfig';
import type { MinutesLayoutConfig } from './MinutesDocumentData';
import './minutes-print.css';
import type { ApprovalStatus } from './types';
import type { MinuteDetail, InternalParticipantRow, ExternalParticipantRow, AgendaResultRow, ApprovalRow, ApprovalCommentRow } from './Detail/types';
import { DetailLoadingView, DetailErrorView, DetailNotFoundView } from './Detail/DetailViews';
import { DetailHeader } from './Detail/DetailHeader';
import { TabSummary, TabParticipants } from './Detail/TabSummaryParticipants';
import { TabAgenda } from './Detail/TabAgenda';
import { TabDecisions } from './Detail/TabDecisions';
import { TabAttachments } from './Detail/TabAttachments';
import { TabApprovals } from './Detail/TabApprovals';
import { RequestChangesModal } from './Detail/TabApprovals';
import { TabHistory } from './Detail/TabHistory';
import { TabFinalVersion } from './Detail/TabFinalVersion';

const TABS = [
  { id: 'summary',       label: 'خلاصه',              icon: FileText },
  { id: 'participants',  label: 'شرکت‌کنندگان',        icon: Users },
  { id: 'agenda',        label: 'دستور جلسات',         icon: FileText },
  { id: 'decisions',     label: 'مصوبات',              icon: CheckSquare },
  { id: 'attachments',   label: 'پیوست‌ها',            icon: Paperclip },
  { id: 'approvals',     label: 'تأییدها',             icon: Shield },
  { id: 'history',       label: 'تاریخچه تغییرات',    icon: History },
  { id: 'final_version', label: 'نسخه نهایی',          icon: FileSignature },
];

interface Props {
  onNavigate: (page: string) => void;
  minuteId?: string;
  currentUserId?: string;
  isAdmin?: boolean;
}

async function waitForPrintAssets(root: HTMLElement, timeoutMs = 3000): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  const pending = images.filter(img => !img.complete);
  if (pending.length === 0) {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
    return;
  }

  const fontPromise = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();

  const imagePromises = pending.map(img => new Promise<void>((resolve) => {
    const settle = () => resolve();
    img.addEventListener('load', settle, { once: true });
    img.addEventListener('error', settle, { once: true });
  }));

  const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, timeoutMs));
  await Promise.race([Promise.all(imagePromises), timeoutPromise]);
  await fontPromise;
}

export function MinutesDetailPage({ onNavigate, minuteId, currentUserId, isAdmin }: Props) {
  const [activeTab, setActiveTab] = useState<MinutesDetailTab>(() => getMinutesTabFromUrl() || 'summary');
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
  const [printLoading, setPrintLoading] = useState(false);
  const [printReady, setPrintReady] = useState(false);
  const [wordLoading, setWordLoading] = useState(false);
  const [docDataLoading, setDocDataLoading] = useState(false);
  const [docDataError, setDocDataError] = useState<string | null>(null);
  const [finalDocData, setFinalDocData] = useState<MinutesDocumentData | null>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [docConfig, setDocConfig] = useState<MinutesLayoutConfig | null>(null);

  const autoPrintTriggered = useRef(false);

  // afterprint cleanup
  useEffect(() => {
    if (!printReady) return;
    const cleanup = () => {
      setPrintReady(false);
      setPrintLoading(false);
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    const fallback = setTimeout(cleanup, 10000);
    return () => {
      window.removeEventListener('afterprint', cleanup);
      clearTimeout(fallback);
    };
  }, [printReady]);

  useEffect(() => {
    (async () => {
      const { logoUrl: logo, config } = await fetchMinutesConfig();
      setLogoUrl(logo);
      setDocConfig(config);
    })();
  }, []);

  const fetchDetail = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotFound(false);
    setFinalDocData(null);
    setDocDataError(null);

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
        .select('id, user_id, name_snapshot, position_snapshot, org_unit_name_snapshot, invitation_status, attendance_status, delegate_name')
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
        .from('profiles_public')
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
        .from('profiles_public')
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

    // Auto-print if print=1 in URL (triggered from list page)
    const url = new URL(window.location.href);
    if (url.searchParams.get('print') === '1') {
      url.searchParams.delete('print');
      window.history.replaceState(null, '', url.toString());
      autoPrintTriggered.current = true;
    }
  }, [minuteId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Auto-print: wait for finalDocData then print
  useEffect(() => {
    if (!autoPrintTriggered.current || !finalDocData || printLoading) return;
    autoPrintTriggered.current = false;
    handlePrint();
  }, [finalDocData, printLoading]);

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

  const refresh = useCallback(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Auto-prepare document data when entering the final_version tab
  useEffect(() => {
    if (activeTab === 'final_version' && !finalDocData && !docDataError && !docDataLoading && minute) {
      prepareDocumentData().catch(() => {
        // Error already handled in prepareDocumentData
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, finalDocData, docDataError, docDataLoading, minute]);

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

  const handlePrint = async () => {
    if (printLoading || printReady || !minute) return;
    setPrintLoading(true);
    try {
      const data = finalDocData ?? await prepareDocumentData();
      setFinalDocData(data);
      setPrintReady(true);
      // Wait for DOM render, fonts, and images before printing
      requestAnimationFrame(async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const root = document.body.querySelector('.minutes-print-root') as HTMLElement | null;
        if (root) {
          await waitForPrintAssets(root);
        }
        window.print();
      });
    } catch {
      toast.error('آماده‌سازی چاپ ناموفق بود.');
      setPrintLoading(false);
    }
  };

  const handleWordExport = async () => {
    if (wordLoading || !minute) return;
    setWordLoading(true);
    try {
      const data = finalDocData ?? await prepareDocumentData();
      setFinalDocData(data);
      await exportMinutesToWord(data);
      toast.success('فایل Word با موفقیت ساخته شد.');
    } catch (e) {
      console.error('Word export failed:', e);
      toast.error('ساخت فایل Word ناموفق بود.');
    } finally {
      setWordLoading(false);
    }
  };

  // Shared: load minutes_decisions via read-only RPC + owner names, build finalDocData, return it.
  const prepareDocumentData = async (): Promise<MinutesDocumentData> => {
    if (!minute) throw new Error('No minute loaded');
    setDocDataError(null);
    setDocDataLoading(true);
    try {
      const { data: viewData, error: viewErr } = await supabase.rpc('get_minutes_decisions_for_view', { p_minute_id: minute.id });
      if (viewErr) throw new Error(viewErr.message);
      const viewRows = (viewData || []) as Array<{
        id: string; title: string; description: string | null;
        priority: DecisionRow['priority']; status: DecisionRow['status'];
        progress_percent: number; start_date: string | null; due_date: string | null;
        responsible_unit_name_snapshot: string | null;
        primary_owner_user_id: string; owner_name: string | null;
        requires_followup: boolean; latest_update: string | null;
        agenda_result_id: string | null; agenda_title: string | null;
      }>;
      const decRows: DecisionRow[] = viewRows.map(r => ({
        id: r.id, minute_id: minute.id, agenda_result_id: r.agenda_result_id,
        title: r.title, description: r.description,
        primary_owner_user_id: r.primary_owner_user_id,
        responsible_unit_id: null,
        responsible_unit_name_snapshot: r.responsible_unit_name_snapshot,
        priority: r.priority, status: r.status, progress_percent: r.progress_percent,
        start_date: r.start_date, due_date: r.due_date, completed_at: null,
        requires_followup: r.requires_followup, latest_update: r.latest_update,
        created_by_user_id: r.primary_owner_user_id, created_at: '', updated_at: '',
        discussion_result: null, result_type: null, additional_notes: null,
      }));
      const namesMap: Record<string, string> = {};
      for (const r of viewRows) {
        if (r.owner_name) namesMap[r.primary_owner_user_id] = r.owner_name;
      }

      const data = toDocData({
        minute: {
          id: minute.id,
          meeting_title_snapshot: minute.meeting_title_snapshot,
          meeting_date_snapshot: minute.meeting_date_snapshot,
          meeting_start_time_snapshot: minute.meeting_start_time_snapshot,
          meeting_end_time_snapshot: minute.meeting_end_time_snapshot,
          meeting_location_snapshot: minute.meeting_location_snapshot,
          meeting_type: minute.meeting_type,
          org_unit_name_snapshot: minute.org_unit_name_snapshot,
          secretary_name_snapshot: minute.secretary_name_snapshot,
          chair_name_snapshot: minute.chair_name_snapshot,
          notes: minute.notes,
          confidentiality: minute.confidentiality,
          status: minute.status,
          approval_mode: minute.approval_mode,
          revision_number: minute.revision_number,
          secretary_confirmed_at: minute.secretary_confirmed_at,
          chair_confirmed_at: minute.chair_confirmed_at,
          published_at: minute.published_at,
        },
        internalParts,
        externalParts,
        agendaResults,
        approvals,
        approvalComments,
        decisions: decRows,
        ownerNames: namesMap,
        logoUrl,
        config: docConfig,
      });

      setFinalDocData(data);
      setDocDataLoading(false);
      return data;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'خطا در آماده‌سازی داده سند';
      setDocDataError(msg);
      setDocDataLoading(false);
      throw e;
    }
  };

  if (isLoading) {
    return <DetailLoadingView />;
  }

  if (error) {
    return <DetailErrorView error={error} />;
  }

  if (notFound || !minute) {
    return <DetailNotFoundView onNavigate={onNavigate} />;
  }

  const lastModified = minute.updated_at
    ? new Date(minute.updated_at).toLocaleDateString('fa-IR')
    : '';

  return (
    <div dir="rtl" className="space-y-4">
      <DetailHeader
        minute={minute}
        lastModified={lastModified}
        canManage={canManage}
        myApproval={myApproval}
        allApprovalsApproved={allApprovalsApproved}
        isSecretary={isSecretary}
        isChair={isChair}
        acting={acting}
        printLoading={printLoading}
        onNavigateBack={() => onNavigate('minutes')}
        onEdit={goEdit}
        onApprove={handleApprove}
        onRequestChanges={() => setShowRequestChanges(true)}
        onSecretaryConfirm={handleSecretaryConfirm}
        onChairPublish={handleChairPublish}
        onPrint={handlePrint}
        onWordExport={handleWordExport}
        wordLoading={wordLoading}
      />

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {/* Tab bar */}
        <div className="flex overflow-x-auto border-b border-gray-100 dark:border-gray-700">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                onClick={() => { setActiveTab(t.id as MinutesDetailTab); setMinutesTabInUrl(t.id as MinutesDetailTab); }}
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
          {activeTab === 'decisions' && (
            <TabDecisions
              minuteId={minute.id}
              minuteStatus={minute.status}
              secretaryId={minute.secretary_user_id}
              chairId={minute.chair_user_id}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
            />
          )}
          {activeTab === 'attachments' && <TabAttachments minuteId={minute.id} canManage={canManage} revisionNumber={minute.revision_number} />}
          {activeTab === 'approvals' && (
            <TabApprovals
              approvals={approvals}
              comments={approvalComments}
              agendaItems={agendaResults}
              minute={minute}
              internalParticipants={internalParts}
            />
          )}
          {activeTab === 'history' && <TabHistory minuteId={minute.id} />}
          {activeTab === 'final_version' && (
            <TabFinalVersion
              minuteId={minute.id}
              revisionNumber={minute.revision_number}
              canManage={canManage}
              docData={finalDocData}
              docDataLoading={docDataLoading}
              docDataError={docDataError}
              onPrepareDocumentData={prepareDocumentData}
              onPrint={handlePrint}
              onWordExport={handleWordExport}
              wordLoading={wordLoading}
              printLoading={printLoading}
            />
          )}
        </div>
      </div>
      {finalDocData && printReady && (
        <MinutesPrintView data={finalDocData} />
      )}
      {showRequestChanges && (
        <RequestChangesModal
          minute={minute}
          agendaItems={agendaResults}
          onClose={() => setShowRequestChanges(false)}
          onSubmitted={() => { setShowRequestChanges(false); refresh(); }}
          currentUserId={currentUserId ?? undefined}
        />
      )}
    </div>
  );
}
