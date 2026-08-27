import { useMemo, useState } from 'react';
import { Search, UserCheck, X, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../lib/supabase';
import { useOrgUsers } from '../../lib/useOrgUsers';

interface Props {
  meetingId: string;
  meetingSubject: string;
  currentUserId: string;
  participantUserIds?: string[];
  notifyUserIds?: string[];
  onClose: () => void;
  onSuccess: (delegateUserId: string, delegateName: string) => void;
}

export function MeetingOwnerDelegateModal({
  meetingId,
  meetingSubject,
  currentUserId,
  participantUserIds = [],
  notifyUserIds = [],
  onClose,
  onSuccess,
}: Props) {
  const [search, setSearch] = useState('');
  const [submittingUserId, setSubmittingUserId] = useState<string | null>(null);
  const { allUsers, loading } = useOrgUsers(currentUserId);

  const unavailable = useMemo(
    () => new Set([currentUserId, ...participantUserIds, ...notifyUserIds]),
    [currentUserId, participantUserIds, notifyUserIds],
  );

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allUsers
      .filter((user) => !unavailable.has(user.user_id))
      .filter((user) => {
        if (!q) return true;
        return (
          (user.full_name || '').toLowerCase().includes(q)
          || (user.position_title || user.position || '').toLowerCase().includes(q)
          || (user.unit_name || '').toLowerCase().includes(q)
        );
      });
  }, [allUsers, search, unavailable]);

  const assignDelegate = async (userId: string, name: string) => {
    if (submittingUserId) return;
    setSubmittingUserId(userId);
    try {
      const { data, error } = await supabase.rpc('assign_meeting_owner_delegate', {
        p_meeting_id: meetingId,
        p_delegate_user_id: userId,
      });
      if (error) throw error;

      const result = data as { success?: boolean; error_code?: string; delegate_name?: string } | null;
      if (!result?.success) {
        const messages: Record<string, string> = {
          MEETING_NOT_FOUND: 'جلسه یافت نشد.',
          NOT_MEETING_OWNER: 'فقط سازنده جلسه می‌تواند جانشین تعیین کند.',
          INVALID_DELEGATE: 'کاربر انتخاب‌شده برای جانشینی معتبر نیست.',
          DELEGATE_PROFILE_INVALID: 'پروفایل جانشین فعال یا معتبر نیست.',
          DELEGATE_DIFFERENT_ORG: 'جانشین باید از همان سازمان باشد.',
          DELEGATE_ALREADY_INVITED: 'این کاربر از قبل در این جلسه حضور دارد یا دعوت شده است.',
        };
        toast.error(messages[result?.error_code || ''] || 'ثبت جانشین ناموفق بود');
        return;
      }

      const delegateName = result.delegate_name || name;
      toast.success(`درخواست جانشینی برای «${delegateName}» به کارتابل جلسات ارسال شد`);
      onSuccess(userId, delegateName);
    } catch (error) {
      console.error('[MeetingOwnerDelegateModal] assign failed', error);
      toast.error('ثبت جانشین ناموفق بود');
    } finally {
      setSubmittingUserId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      dir="rtl"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="flex max-h-[82vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-gray-800 sm:rounded-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-700">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-bold text-gray-900 dark:text-white">
              <UserCheck className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              انتخاب جانشین
            </h3>
            <p className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">{meetingSubject}</p>
            <p className="mt-1 text-[11px] leading-5 text-gray-400">
              جلسه به کارتابل جانشین ارسال می‌شود و پس از تأیید او در تقویمش نمایش داده خواهد شد.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
            aria-label="بستن"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="border-b border-gray-100 px-4 py-3 dark:border-gray-700">
          <label className="relative block">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="جستجوی نام، سمت یا واحد..."
              className="h-10 w-full rounded-xl border border-gray-200 bg-gray-50 pr-9 pl-3 text-sm text-gray-800 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:ring-amber-900/30"
              autoFocus
            />
          </label>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex min-h-40 items-center justify-center gap-2 text-sm text-gray-400">
              <Loader2 className="h-5 w-5 animate-spin" />
              در حال دریافت کاربران...
            </div>
          ) : candidates.length === 0 ? (
            <div className="flex min-h-40 items-center justify-center px-4 text-center text-sm text-gray-400">
              کاربر قابل انتخابی یافت نشد.
            </div>
          ) : (
            candidates.map((user) => {
              const name = user.full_name || 'بدون نام';
              const subtitle = [user.position_title || user.position, user.unit_name].filter(Boolean).join(' · ');
              const submitting = submittingUserId === user.user_id;
              return (
                <button
                  key={user.user_id}
                  type="button"
                  onClick={() => void assignDelegate(user.user_id, name)}
                  disabled={Boolean(submittingUserId)}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-right transition hover:bg-amber-50 disabled:opacity-50 dark:hover:bg-amber-900/20"
                >
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                    {name.charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-800 dark:text-white">{name}</p>
                    <p className="mt-0.5 truncate text-xs text-gray-400">{subtitle || 'بدون جایگاه سازمانی'}</p>
                  </div>
                  <span className="flex min-w-[58px] items-center justify-center gap-1 rounded-lg bg-amber-500 px-2.5 py-1.5 text-xs font-semibold text-white">
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
                    {submitting ? '' : 'انتخاب'}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </section>
    </div>
  );
}
