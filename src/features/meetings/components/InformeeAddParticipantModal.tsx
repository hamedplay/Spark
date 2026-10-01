import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader as Loader2, Search, UserPlus, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useOrgUsers } from '../../../lib/useOrgUsers';
import { addMeetingParticipantAsInformee } from '../repositories/meetingInformeeParticipantsRepository';

interface Props {
  meetingId: string;
  currentUserId: string;
  organizerId: string;
  existingParticipantIds: string[];
  onClose: () => void;
  onSuccess: (participantUserId: string) => void;
}

function getRpcErrorMessage(error: unknown): string {
  const message = error && typeof error === 'object' && 'message' in error
    ? String((error as { message?: unknown }).message || '')
    : '';

  if (message.includes('NOT_AUTHORIZED')) return 'دسترسی افزودن شرکت‌کننده برای شما وجود ندارد';
  if (message.includes('CROSS_ORG_PARTICIPANT')) return 'امکان افزودن کاربر خارج از سازمان وجود ندارد';
  if (message.includes('INVALID_PARTICIPANT')) return 'کاربر انتخاب‌شده قابل افزودن نیست';
  if (message.includes('MEETING_NOT_FOUND')) return 'جلسه موردنظر یافت نشد';
  return 'خطا در افزودن شرکت‌کننده';
}

export function InformeeAddParticipantModal({
  meetingId,
  currentUserId,
  organizerId,
  existingParticipantIds,
  onClose,
  onSuccess,
}: Props) {
  const [searchTerm, setSearchTerm] = useState('');
  const [addingUserId, setAddingUserId] = useState<string | null>(null);
  const { allUsers, loading, error } = useOrgUsers(currentUserId);

  const candidates = useMemo(() => {
    const existing = new Set(existingParticipantIds);
    const query = searchTerm.trim().toLocaleLowerCase('fa-IR');

    return allUsers
      .filter(user => user.user_id !== organizerId && user.user_id !== currentUserId && !existing.has(user.user_id))
      .filter(user => {
        if (!query) return true;
        const searchable = [
          user.full_name,
          user.position,
          user.position_title,
          user.unit_name,
          ...user.assignments.flatMap(assignment => [assignment.positionTitle, assignment.unitName]),
        ]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(' ')
          .toLocaleLowerCase('fa-IR');
        return searchable.includes(query);
      });
  }, [allUsers, currentUserId, existingParticipantIds, organizerId, searchTerm]);

  const handleAdd = async (participantUserId: string, displayName: string) => {
    if (addingUserId) return;
    setAddingUserId(participantUserId);
    try {
      const result = await addMeetingParticipantAsInformee(meetingId, participantUserId);
      if (!result.added) {
        toast('این کاربر قبلاً در فهرست شرکت‌کنندگان قرار دارد');
        onSuccess(result.participantUserId);
        return;
      }
      toast.success(`${displayName || 'کاربر'} به شرکت‌کنندگان جلسه اضافه شد`);
      onSuccess(result.participantUserId);
    } catch (rpcError) {
      toast.error(getRpcErrorMessage(rpcError));
    } finally {
      setAddingUserId(null);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-4" dir="rtl" onClick={onClose}>
      <div
        className="flex max-h-[82vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-900"
        onClick={event => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <div>
            <h3 className="text-base font-bold text-gray-900 dark:text-white">افزودن شرکت‌کننده</h3>
            <p className="mt-0.5 text-xs text-gray-400">فقط افراد جدید به همین جلسه اضافه می‌شوند.</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 transition hover:bg-gray-100 dark:hover:bg-gray-800" aria-label="بستن">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        <div className="border-b border-gray-100 p-4 dark:border-gray-800">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={searchTerm}
              onChange={event => setSearchTerm(event.target.value)}
              placeholder="جستجوی نام، سمت یا واحد..."
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-9 text-sm text-gray-800 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:border-gray-700 dark:bg-gray-800 dark:text-white dark:focus:ring-blue-900/40"
              autoFocus
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-blue-500" /></div>
          ) : error ? (
            <p className="py-8 text-center text-sm text-red-500">فهرست کاربران قابل دریافت نیست</p>
          ) : candidates.length === 0 ? (
            <p className="py-8 text-center text-sm text-gray-400">کاربر قابل افزودنی یافت نشد</p>
          ) : (
            <div className="space-y-1">
              {candidates.map(user => {
                const displayName = user.full_name?.trim() || 'همکار سازمانی';
                const position = user.position_title || user.position || '';
                const unit = user.unit_name || '';
                const isAdding = addingUserId === user.user_id;
                return (
                  <div key={user.user_id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-gray-50 dark:hover:bg-gray-800/70">
                    <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-sm font-bold text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                      {displayName.charAt(0) || '?'}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-800 dark:text-gray-100">{displayName}</p>
                      {(position || unit) && <p className="truncate text-xs text-gray-400">{[position, unit].filter(Boolean).join(' · ')}</p>}
                    </div>
                    <button
                      onClick={() => void handleAdd(user.user_id, displayName)}
                      disabled={addingUserId !== null}
                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isAdding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                      افزودن
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
