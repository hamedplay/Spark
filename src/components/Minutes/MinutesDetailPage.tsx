import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Users, SquareCheck as CheckSquare, Paperclip, Shield, History, Signature as FileSignature } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { getMinuteIdFromUrl, setMinuteIdInUrl, getMinutesTabFromUrl, setMinutesTabInUrl, type MinutesDetailTab } from '../../lib/minutesNavigation';
import { MinutesPrintView } from './MinutesPrintView';
import type { MinutesDocumentData } from './MinutesDocumentData';
import type { MinutesLayoutConfig } from './MinutesDocumentData';
import { fetchMinutesConfig } from './fetchMinutesConfig';
import { loadDocumentSnapshot } from './minutesDocumentLoader';
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
  { id: 'decisions',     label: 'مصوبات',             icon: CheckSquare },
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
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState<string | null>(null);

  // Request token: incremented on every new load. Stale responses are rejected
  // by comparing their token against the current value.
  const loadTokenRef = useRef(0);

  // Track the currently loaded minute identity for snapshot invalidation.
  const loadedMinuteKeyRef = useRef<string>('');

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

  // Load config once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setConfigLoading(true);
      setConfigError(null);
      try {
        const { logoUrl: logo, config } = await fetchMinutesConfig();
        if (cancelled) return;
        setLogoUrl(logo);
        setDocConfig(config);
      } catch (e) {
        if (!cancelled) setConfigError(e instanceof Error ? e.message : 'خطا در بارگذاری تنظیمات قالب');
      } finally {
        if (!cancelled) setConfigLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const fetchDetail = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setNotFound(false);

    // Invalidate any previous snapshot
    setFinalDocData(null);
    setDocDataError(null);

    const targetId = minuteId || getMinuteIdFromUrl();

    if (!targetId) {
      setNotFound(true);
      setIsLoading(false);
      return;
    }

    // Assign a new request token and record the minute identity key.
    const myToken = ++loadTokenRef.current;
    const minuteKey = `${targetId}`;
    loadedMinuteKeyRef.current = minuteKey;

    try {
      const snapshot = await loadDocumentSnapshot({
        minuteId: targetId,
        cachedConfig: docConfig,
        cachedLogoUrl: logoUrl,
      });

      // Reject stale response: a newer load has started.
      if (myToken !== loadTokenRef.current) return;
      // Reject if the minute identity has changed since this load started.
      if (loadedMinuteKeyRef.current !== minuteKey) return;

      setMinute(snapshot.minute);
      setInternalParts(snapshot.internalParts);
      setExternalParts(snapshot.externalParts);
      setAgendaResults(snapshot.agendaResults);
      setApprovals(snapshot.approvals);
      setApprovalComments(snapshot.approvalComments);
      setFinalDocData(snapshot.docData);
      setLogoUrl(snapshot.logoUrl);
      setDocConfig(snapshot.config);
      setIsLoading(false);

      // Auto-print if print=1 in URL (triggered from list page)
      const url = new URL(window.location.href);
      if (url.searchParams.get('print') === '1') {
        url.searchParams.delete('print');
        window.history.replaceState(null, '', url.toString());
        autoPrintTriggered.current = true;
      }
    } catch (e) {
      if (myToken !== loadTokenRef.current) return;
      const msg = e instanceof Error ? e.message : 'خطا در بارگذاری';
      if (msg === 'MINUTE_NOT_FOUND') {
        setNotFound(true);
      } else {
        setError(msg);
      }
      setIsLoading(false);
    }
  }, [minuteId, docConfig, logoUrl]);

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

  // Invalidate snapshot when config changes after initial load
  useEffect(() => {
    if (docConfig && minute) {
      setFinalDocData(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docConfig]);

  // Auto-prepare document data when entering the final_version tab
  useEffect(() => {
    if (activeTab === 'final_version' && !finalDocData && !docDataError && !docDataLoading && minute && docConfig) {
      prepareDocumentData().catch(() => {
        // Error already handled in prepareDocumentData
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, finalDocData, docDataError, docDataLoading, minute, docConfig]);

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
      const { exportMinutesToWord } = await import('../../lib/minutesWordExport');
      await exportMinutesToWord(data);
      toast.success('فایل Word با موفقیت ساخته شد.');
    } catch (e) {
      console.error('Word export failed:', e);
      toast.error('ساخت فایل Word ناموفق بود.');
    } finally {
      setWordLoading(false);
    }
  };

  // Rebuild the document snapshot atomically. Uses the cached config if available,
  // otherwise fetches fresh. All sub-queries must succeed before finalDocData is set.
  const prepareDocumentData = async (): Promise<MinutesDocumentData> => {
    if (!minute) throw new Error('No minute loaded');
    setDocDataError(null);
    setDocDataLoading(true);

    const myToken = ++loadTokenRef.current;
    const minuteKey = `${minute.id}`;
    loadedMinuteKeyRef.current = minuteKey;

    try {
      const snapshot = await loadDocumentSnapshot({
        minuteId: minute.id,
        cachedConfig: docConfig,
        cachedLogoUrl: logoUrl,
      });

      // Reject stale response
      if (myToken !== loadTokenRef.current) return snapshot.docData;
      if (loadedMinuteKeyRef.current !== minuteKey) return snapshot.docData;

      // Update all state atomically
      setMinute(snapshot.minute);
      setInternalParts(snapshot.internalParts);
      setExternalParts(snapshot.externalParts);
      setAgendaResults(snapshot.agendaResults);
      setApprovals(snapshot.approvals);
      setApprovalComments(snapshot.approvalComments);
      setFinalDocData(snapshot.docData);
      setLogoUrl(snapshot.logoUrl);
      setDocConfig(snapshot.config);
      setDocDataLoading(false);
      return snapshot.docData;
    } catch (e) {
      if (myToken !== loadTokenRef.current) throw e;
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
              configLoading={configLoading}
              configError={configError}
              onPrepareDocumentData={prepareDocumentData}
              onRetryConfig={() => {
                setFinalDocData(null);
                setDocDataError(null);
                setConfigLoading(true);
                fetchMinutesConfig().then(({ logoUrl: logo, config }) => {
                  setLogoUrl(logo);
                  setDocConfig(config);
                  setConfigError(null);
                }).catch((e) => {
                  setConfigError(e instanceof Error ? e.message : 'خطا در بارگذاری تنظیمات قالب');
                }).finally(() => setConfigLoading(false));
              }}
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
