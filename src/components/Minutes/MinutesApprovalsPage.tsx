import { useEffect, useState, useCallback } from 'react';
import { Eye, Check, CircleAlert as AlertCircle, Loader as Loader2, UserCheck, Users, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, ApprovalStatusBadge, ApprovalModeBadge, EmptyState, TableSkeleton } from './MinutesShared';
import { MinutesBackButton } from './MinutesBackButton';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl, setMinutesPageInUrl } from '../../lib/minutesNavigation';
import { formatJalaliDateForDisplay, formatJalaliTimestamp } from '../../lib/minutesDate';
import type { ApprovalStatus, ApprovalMode } from './types';

interface ApprovalInboxRow {
  approval_id: string;
  minute_id: string;
  revision_number: number;
  meeting_title: string;
  meeting_date: string;
  secretary_name: string;
  approval_mode: ApprovalMode;
  submitted_at: string;
  my_status: ApprovalStatus;
  is_delegate: boolean;
  original_approver_name: string | null;
  delegate_user_id: string | null;
  delegate_name: string | null;
  updated_at: string;
}

interface DelegateCandidate {
  user_id: string;
  full_name: string;
}

interface Props {
  onNavigate: (page: string) => void;
  currentUserId?: string;
}

export function MinutesApprovalsPage({ onNavigate, currentUserId }: Props) {
  const [rows, setRows] = useState<ApprovalInboxRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [delegateModalApprovalId, setDelegateModalApprovalId] = useState<string | null>(null);
  const [delegateCandidates, setDelegateCandidates] = useState<DelegateCandidate[]>([]);
  const [delegateLoading, setDelegateLoading] = useState(false);
  const [selectedDelegateId, setSelectedDelegateId] = useState<string | null>(null);
  const [delegatingApproval, setDelegatingApproval] = useState<string | null>(null);

  const fetchInbox = useCallback(async () => {
    if (!currentUserId) { setIsLoading(false); return; }
    setIsLoading(true);
    setError(null);
    try {
      const { data: approvalsData, error: approvalsErr } = await supabase
        .from('minutes_approvals')
        .select('id, minute_id, revision_number, status, approver_user_id, delegate_user_id, delegated_at, updated_at')
        .or(`approver_user_id.eq.${currentUserId},delegate_user_id.eq.${currentUserId}`)
        .eq('status', 'pending')
        .order('updated_at', { ascending: false });

      if (approvalsErr) throw approvalsErr;
      if (!approvalsData || approvalsData.length === 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }

      const minuteIds = approvalsData.map(a => a.minute_id);
      const { data: minutesData, error: minutesErr } = await supabase
        .from('minutes')
        .select('id, meeting_title_snapshot, meeting_date_snapshot, secretary_name_snapshot, approval_mode, revision_number, submitted_at, status')
        .in('id', minuteIds)
        .eq('status', 'pending_approval');

      if (minutesErr) throw minutesErr;

      const minuteMap = new Map((minutesData || []).map((m: Record<string, unknown>) => [m.id as string, m]));

      const approverIds = new Set<string>();
      for (const a of approvalsData as Array<Record<string, unknown>>) {
        approverIds.add(a.approver_user_id as string);
        if (a.delegate_user_id) approverIds.add(a.delegate_user_id as string);
      }

      const { data: profiles } = await supabase
        .from('profiles_public')
        .select('user_id, full_name')
        .in('user_id', [...approverIds]);

      const nameMap = new Map((profiles || []).map((p: { user_id: string; full_name: string }) => [p.user_id, p.full_name || 'کاربر']));

      const inboxRows: ApprovalInboxRow[] = [];
      for (const a of approvalsData as Array<{
        id: string; minute_id: string; revision_number: number; status: ApprovalStatus;
        approver_user_id: string; delegate_user_id: string | null; delegated_at: string | null;
        updated_at: string;
      }>) {
        const m = minuteMap.get(a.minute_id) as Record<string, unknown> | undefined;
        if (!m) continue;
        const isDelegate = a.delegate_user_id === currentUserId;
        inboxRows.push({
          approval_id: a.id,
          minute_id: a.minute_id,
          revision_number: a.revision_number,
          meeting_title: (m.meeting_title_snapshot as string) || '',
          meeting_date: (m.meeting_date_snapshot as string) || '',
          secretary_name: (m.secretary_name_snapshot as string) || '',
          approval_mode: m.approval_mode as ApprovalMode,
          submitted_at: (m.submitted_at as string) || '',
          my_status: a.status,
          is_delegate: isDelegate,
          original_approver_name: isDelegate ? (nameMap.get(a.approver_user_id) || 'تأییدکننده') : null,
          delegate_user_id: a.delegate_user_id,
          delegate_name: a.delegate_user_id ? (nameMap.get(a.delegate_user_id) || 'جانشین') : null,
          updated_at: a.updated_at,
        });
      }
      setRows(inboxRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'خطا در بارگذاری کارتابل');
    } finally {
      setIsLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  const goToDetail = (minuteId: string) => {
    setMinuteIdInUrl(minuteId);
    setMinutesPageInUrl('minutes-detail');
    onNavigate('minutes-detail');
  };

  const handleApprove = async (minuteId: string, revisionNumber: number, approvalId: string) => {
    if (actingId) return;
    setActingId(approvalId);
    try {
      const { data, error: rpcError } = await supabase.rpc('approve_minute_revision', {
        p_minute_id: minuteId,
        p_revision_number: revisionNumber,
      });
      if (rpcError) { toast.error('تأیید ناموفق بود.'); return; }
      if (data?.success === false) {
        const msgs: Record<string, string> = {
          NOT_AN_APPROVER: 'شما تأییدکننده این صورت‌جلسه نیستید.',
          MINUTE_NOT_PENDING: 'صورت‌جلسه در وضعیت تأیید نیست.',
          REVISION_NOT_CURRENT: 'این نسخه دیگر معتبر نیست.',
          APPROVAL_NOT_PENDING: 'تأیید شما قبلاً ثبت شده یا باطل شده است.',
        };
        toast.error(msgs[data.error_code] || 'تأیید ناموفق بود.');
        return;
      }
      toast.success(data.message || 'تأیید شما ثبت شد.');
      await fetchInbox();
    } finally { setActingId(null); }
  };

  const openDelegateModal = async (approvalId: string, minuteId: string, revisionNumber: number) => {
    setDelegateModalApprovalId(approvalId);
    setSelectedDelegateId(null);
    setDelegateLoading(true);
    try {
      const { data: existingApprovers } = await supabase
        .from('minutes_approvals')
        .select('approver_user_id')
        .eq('minute_id', minuteId)
        .eq('revision_number', revisionNumber);

      const approverIds = new Set((existingApprovers || []).map(a => a.approver_user_id));
      approverIds.add(currentUserId || '');

      const { data: profiles, error } = await supabase
        .from('profiles_public')
        .select('user_id, full_name')
        .eq('is_active', true)
        .neq('is_hidden', true)
        .order('full_name', { ascending: true });

      if (error) throw error;

      const candidates = (profiles || [])
        .filter((p: { user_id: string; full_name: string }) => !approverIds.has(p.user_id))
        .map((p: { user_id: string; full_name: string }) => ({ user_id: p.user_id, full_name: p.full_name || 'کاربر' }));

      setDelegateCandidates(candidates);
    } catch {
      toast.error('بارگذاری کاربران ناموفق بود.');
      setDelegateModalApprovalId(null);
    } finally {
      setDelegateLoading(false);
    }
  };

  const handleAssignDelegate = async (approvalId: string) => {
    if (!selectedDelegateId) { toast.error('یک جانشین انتخاب کنید.'); return; }
    setDelegatingApproval(approvalId);
    try {
      const { data: approvalRow } = await supabase
        .from('minutes_approvals')
        .select('updated_at')
        .eq('id', approvalId)
        .maybeSingle();

      if (!approvalRow) { toast.error('رکورد تأیید یافت نشد.'); return; }

      const { data, error: rpcError } = await supabase.rpc('assign_minutes_approval_delegate', {
        p_approval_id: approvalId,
        p_delegate_user_id: selectedDelegateId,
        p_expected_updated_at: approvalRow.updated_at,
      });

      if (rpcError) { toast.error('انتخاب جانشین ناموفق بود.'); return; }
      if (data?.success === false) {
        const msgs: Record<string, string> = {
          NOT_AN_APPROVER: 'شما تأییدکننده این صورت‌جلسه نیستید.',
          CANNOT_DELEGATE_TO_SELF: 'نمی‌توانید خودتان را به‌عنوان جانشین انتخاب کنید.',
          DELEGATE_ALREADY_ASSIGNED: 'برای این تأیید قبلاً جانشین انتخاب شده است.',
          APPROVAL_NOT_PENDING: 'این تأیید دیگر در وضعیت انتظار نیست.',
          MINUTE_NOT_PENDING: 'صورت‌جلسه در وضعیت تأیید نیست.',
          REVISION_NOT_CURRENT: 'این نسخه دیگر معتبر نیست.',
          APPROVAL_VERSION_CONFLICT: 'اطلاعات تغییر کرده است. صفحه را تازه‌سازی کنید.',
          DELEGATE_ALREADY_APPROVER: 'این کاربر از قبل تأییدکننده این صورت‌جلسه است.',
          DELEGATE_PROFILE_INVALID: 'پروفایل جانشین معتبر نیست یا فعال نیست.',
          DELEGATE_DIFFERENT_ORG: 'جانشین باید از همان سازمان باشد.',
        };
        toast.error(msgs[data.error_code] || data.message || 'انتخاب جانشین ناموفق بود.');
        return;
      }
      toast.success(data.message || 'جانشین با موفقیت انتخاب شد.');
      setDelegateModalApprovalId(null);
      setSelectedDelegateId(null);
      await fetchInbox();
    } finally {
      setDelegatingApproval(null);
    }
  };

  return (
    <div dir="rtl" className="space-y-5">
      <MinutesBackButton onNavigate={onNavigate} target="minutes-hub" label="بازگشت به هاب" />
      <PageHeader title="کارتابل تأیید" description="صورت‌جلساتی که در انتظار تأیید شما یا جانشینی شما هستند" />

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={4} /></div>
        ) : error ? (
          <EmptyState icon={<AlertCircle className="w-8 h-8" />} title="خطا در بارگذاری" description={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="موردی برای تأیید وجود ندارد" description="صورت‌جلساتی که برای تأیید به شما ارسال شوند در اینجا نمایش داده می‌شوند." />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    {['عنوان جلسه','تاریخ','دبیر','مدل تأیید','نسخه','تاریخ ارسال','جانشین','عملیات'].map(h => (
                      <th key={h} className="px-4 py-3 text-right text-xs font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {rows.map(row => (
                    <tr key={row.approval_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                      <td className="px-4 py-3">
                        <button onClick={() => goToDetail(row.minute_id)} className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline text-right">
                          {row.meeting_title}
                        </button>
                        {row.is_delegate && row.original_approver_name && (
                          <span className="block text-xs text-blue-500 mt-0.5">
                            جانشین تأییدکننده: {row.original_approver_name}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{formatJalaliDateForDisplay(row.meeting_date)}</td>
                      <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.secretary_name}</td>
                      <td className="px-4 py-3"><ApprovalModeBadge mode={row.approval_mode} /></td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{row.revision_number}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                        {row.submitted_at ? formatJalaliTimestamp(row.submitted_at) : '—'}
                      </td>
                      <td className="px-4 py-3">
                        {row.delegate_user_id ? (
                          <span className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400">
                            <UserCheck className="w-3.5 h-3.5" />
                            {row.delegate_name}
                          </span>
                        ) : (
                          <span className="text-gray-400 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <button onClick={() => goToDetail(row.minute_id)} title="مشاهده و اقدام"
                            className="p-1.5 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 text-blue-500 transition-colors">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleApprove(row.minute_id, row.revision_number, row.approval_id)}
                            disabled={actingId === row.approval_id}
                            title="تأیید سریع"
                            className="p-1.5 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20 text-green-500 transition-colors disabled:opacity-50"
                          >
                            {actingId === row.approval_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                          </button>
                          {!row.is_delegate && !row.delegate_user_id && (
                            <button
                              onClick={() => openDelegateModal(row.approval_id, row.minute_id, row.revision_number)}
                              title="انتخاب جانشین"
                              className="p-1.5 rounded-lg hover:bg-purple-50 dark:hover:bg-purple-900/20 text-purple-500 transition-colors"
                            >
                              <Users className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="lg:hidden divide-y divide-gray-100 dark:divide-gray-700">
              {rows.map(row => (
                <div key={row.approval_id} className="p-4 space-y-2">
                  <button onClick={() => goToDetail(row.minute_id)} className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline text-right block">
                    {row.meeting_title}
                  </button>
                  {row.is_delegate && row.original_approver_name && (
                    <div className="text-xs text-blue-500 flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5" />
                      جانشین تأییدکننده: {row.original_approver_name}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span>{formatJalaliDateForDisplay(row.meeting_date)}</span>
                    <span>·</span>
                    <span>{row.secretary_name}</span>
                    <span>·</span>
                    <ApprovalModeBadge mode={row.approval_mode} />
                    <span>·</span>
                    <span>نسخه {row.revision_number}</span>
                  </div>
                  {row.delegate_user_id && !row.is_delegate && (
                    <div className="text-xs text-blue-600 dark:text-blue-400 flex items-center gap-1">
                      <UserCheck className="w-3.5 h-3.5" />
                      جانشین: {row.delegate_name}
                    </div>
                  )}
                  {row.submitted_at && (
                    <div className="text-xs text-gray-400">{formatJalaliTimestamp(row.submitted_at)}</div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <button onClick={() => goToDetail(row.minute_id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-sm font-medium transition-colors">
                      <Eye className="w-4 h-4" /> مشاهده و اقدام
                    </button>
                    <button
                      onClick={() => handleApprove(row.minute_id, row.revision_number, row.approval_id)}
                      disabled={actingId === row.approval_id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {actingId === row.approval_id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} تأیید سریع
                    </button>
                    {!row.is_delegate && !row.delegate_user_id && (
                      <button
                        onClick={() => openDelegateModal(row.approval_id, row.minute_id, row.revision_number)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 text-sm font-medium transition-colors"
                      >
                        <Users className="w-4 h-4" /> جانشین
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Delegate selection modal */}
      {delegateModalApprovalId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDelegateModalApprovalId(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200">انتخاب جانشین تأییدکننده</h3>
              <button onClick={() => setDelegateModalApprovalId(null)} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              جانشین می‌تواند به‌جای شما صورت‌جلسه را تأیید یا درخواست اصلاح کند. مسئول اصلی تأیید همچنان شما خواهید بود.
            </p>
            {delegateLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
              </div>
            ) : delegateCandidates.length === 0 ? (
              <p className="text-sm text-gray-500 text-center py-4">هیچ کاربر فعالی برای جانشینی یافت نشد.</p>
            ) : (
              <>
                <select
                  value={selectedDelegateId || ''}
                  onChange={e => setSelectedDelegateId(e.target.value || null)}
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">انتخاب کنید...</option>
                  {delegateCandidates.map(c => (
                    <option key={c.user_id} value={c.user_id}>{c.full_name}</option>
                  ))}
                </select>
                <button
                  onClick={() => handleAssignDelegate(delegateModalApprovalId)}
                  disabled={!selectedDelegateId || delegatingApproval === delegateModalApprovalId}
                  className="w-full px-4 py-2.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
                >
                  {delegatingApproval === delegateModalApprovalId ? (
                    <span className="flex items-center justify-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> در حال ثبت...</span>
                  ) : 'تأیید انتخاب جانشین'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Keep ApprovalStatusBadge import used */}
      <span className="hidden"><ApprovalStatusBadge status="pending" /></span>
    </div>
  );
}
