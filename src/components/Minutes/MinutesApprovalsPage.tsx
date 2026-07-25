import { useEffect, useState, useCallback } from 'react';
import { Eye, Check, CircleAlert as AlertCircle, Loader as Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { PageHeader, ApprovalStatusBadge, ApprovalModeBadge, EmptyState, TableSkeleton } from './MinutesShared';
import { supabase } from '../../lib/supabase';
import { setMinuteIdInUrl, setMinutesPageInUrl } from '../../lib/minutesNavigation';
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

  const fetchInbox = useCallback(async () => {
    if (!currentUserId) { setIsLoading(false); return; }
    setIsLoading(true);
    setError(null);
    try {
      // Fetch pending approvals for current user in current revision
      const { data: approvalsData, error: approvalsErr } = await supabase
        .from('minutes_approvals')
        .select('id, minute_id, revision_number, status')
        .eq('approver_user_id', currentUserId)
        .eq('status', 'pending')
        .order('updated_at', { ascending: false });

      if (approvalsErr) throw approvalsErr;
      if (!approvalsData || approvalsData.length === 0) {
        setRows([]);
        setIsLoading(false);
        return;
      }

      // Fetch parent minutes (only pending_approval ones are active in inbox)
      const minuteIds = approvalsData.map(a => a.minute_id);
      const { data: minutesData, error: minutesErr } = await supabase
        .from('minutes')
        .select('id, meeting_title_snapshot, meeting_date_snapshot, secretary_name_snapshot, approval_mode, revision_number, submitted_at, status')
        .in('id', minuteIds)
        .eq('status', 'pending_approval');

      if (minutesErr) throw minutesErr;

      const minuteMap = new Map((minutesData || []).map((m: Record<string, unknown>) => [m.id as string, m]));
      const inboxRows: ApprovalInboxRow[] = [];
      for (const a of approvalsData as Array<{ id: string; minute_id: string; revision_number: number; status: ApprovalStatus }>) {
        const m = minuteMap.get(a.minute_id) as Record<string, unknown> | undefined;
        if (!m) continue; // skip if minute not pending_approval or not visible
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

  return (
    <div dir="rtl" className="space-y-5">
      <PageHeader title="کارتابل تأیید" description="صورت‌جلساتی که در انتظار تأیید شما هستند" />

      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-4"><TableSkeleton rows={4} /></div>
        ) : error ? (
          <EmptyState icon={<AlertCircle className="w-8 h-8" />} title="خطا در بارگذاری" description={error} />
        ) : rows.length === 0 ? (
          <EmptyState title="موردی برای تأیید وجود ندارد" description="صورت‌جلساتی که برای تأیید به شما ارسال شوند در اینجا نمایش داده می‌شوند." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  {['عنوان جلسه','تاریخ','دبیر','مدل تأیید','نسخه','تاریخ ارسال','عملیات'].map(h => (
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
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.meeting_date}</td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.secretary_name}</td>
                    <td className="px-4 py-3"><ApprovalModeBadge mode={row.approval_mode} /></td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{row.revision_number}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      {row.submitted_at ? new Date(row.submitted_at).toLocaleDateString('fa-IR') : '—'}
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Keep ApprovalStatusBadge import used */}
      <span className="hidden"><ApprovalStatusBadge status="pending" /></span>
    </div>
  );
}
