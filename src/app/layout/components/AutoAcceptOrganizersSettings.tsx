import { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../../../lib/supabase';
import { useOrgUsers } from '../../../lib/useOrgUsers';

export function AutoAcceptOrganizersSettings() {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loadingSelection, setLoadingSelection] = useState(true);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const { allUsers, loading: usersLoading } = useOrgUsers(currentUserId);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data: authData } = await supabase.auth.getUser();
      if (cancelled) return;
      const userId = authData.user?.id || null;
      setCurrentUserId(userId);
      if (!userId) {
        setLoadingSelection(false);
        return;
      }
      const { data, error } = await supabase
        .from('user_auto_accept_organizers')
        .select('organizer_user_id')
        .eq('user_id', userId)
        .order('created_at');
      if (cancelled) return;
      if (error) {
        toast.error('بارگذاری فهرست پذیرش خودکار ناموفق بود');
        setSelectedIds([]);
      } else {
        setSelectedIds((data || []).map(row => row.organizer_user_id));
      }
      setLoadingSelection(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const usersById = useMemo(
    () => new Map(allUsers.map(user => [user.user_id, user])),
    [allUsers],
  );

  const candidates = useMemo(() => {
    const selected = new Set(selectedIds);
    const query = search.trim().toLocaleLowerCase('fa-IR');
    return allUsers
      .filter(user => user.user_id !== currentUserId && !selected.has(user.user_id))
      .filter(user => {
        if (!query) return true;
        return [
          user.full_name,
          user.position,
          user.position_title,
          user.unit_name,
          ...user.assignments.flatMap(assignment => [assignment.positionTitle, assignment.unitName]),
        ]
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
          .join(' ')
          .toLocaleLowerCase('fa-IR')
          .includes(query);
      })
      .slice(0, 20);
  }, [allUsers, currentUserId, search, selectedIds]);

  const addOrganizer = async (organizerUserId: string) => {
    if (!currentUserId || busyUserId) return;
    setBusyUserId(organizerUserId);
    const { error } = await supabase
      .from('user_auto_accept_organizers')
      .insert({ user_id: currentUserId, organizer_user_id: organizerUserId });
    setBusyUserId(null);
    if (error) {
      toast.error('افزودن برگزارکننده ناموفق بود');
      return;
    }
    setSelectedIds(current => current.includes(organizerUserId) ? current : [...current, organizerUserId]);
    setSearch('');
    toast.success('پذیرش خودکار برای این برگزارکننده فعال شد');
  };

  const removeOrganizer = async (organizerUserId: string) => {
    if (!currentUserId || busyUserId) return;
    setBusyUserId(organizerUserId);
    const { error } = await supabase
      .from('user_auto_accept_organizers')
      .delete()
      .eq('user_id', currentUserId)
      .eq('organizer_user_id', organizerUserId);
    setBusyUserId(null);
    if (error) {
      toast.error('حذف برگزارکننده ناموفق بود');
      return;
    }
    setSelectedIds(current => current.filter(id => id !== organizerUserId));
    toast.success('پذیرش خودکار برای این برگزارکننده غیرفعال شد');
  };

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-teal-500" />
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            پذیرش خودکار دعوت جلسه
          </p>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-gray-400 dark:text-gray-500">
          دعوت مستقیم از برگزارکنندگان منتخب بدون تأیید دستی پذیرفته می‌شود. دعوت‌های Delegation شامل این قابلیت نیستند و تداخل زمانی مانع پذیرش خودکار نمی‌شود.
        </p>
      </div>

      {loadingSelection || usersLoading ? (
        <div className="flex items-center justify-center py-4 text-xs text-gray-400">
          <Loader2 className="ml-2 h-4 w-4 animate-spin" />در حال بارگذاری...
        </div>
      ) : (
        <>
          {selectedIds.length > 0 && (
            <div className="space-y-1.5">
              {selectedIds.map(id => {
                const user = usersById.get(id);
                const name = user?.full_name?.trim() || user?.email || 'کاربر سازمانی';
                const sub = [user?.position_title || user?.position, user?.unit_name].filter(Boolean).join(' · ');
                return (
                  <div key={id} className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 dark:border-gray-700">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{name}</p>
                      {sub && <p className="truncate text-[10px] text-gray-400">{sub}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => void removeOrganizer(id)}
                      disabled={busyUserId !== null}
                      className="rounded-lg p-1.5 text-red-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-950/20"
                      aria-label="حذف از پذیرش خودکار"
                    >
                      {busyUserId === id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="relative">
            <Search className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="جستجوی برگزارکننده بر اساس نام، سمت یا واحد..."
              className="w-full rounded-xl border border-gray-200 bg-white py-2.5 pl-3 pr-9 text-xs text-gray-800 outline-none transition focus:border-teal-400 focus:ring-2 focus:ring-teal-100 dark:border-gray-700 dark:bg-gray-900 dark:text-white dark:focus:ring-teal-900/30"
            />
          </div>

          {search.trim() && (
            <div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-gray-200 p-1.5 dark:border-gray-700">
              {candidates.length === 0 ? (
                <p className="py-4 text-center text-xs text-gray-400">کاربری یافت نشد</p>
              ) : candidates.map(user => {
                const name = user.full_name?.trim() || user.email || 'کاربر سازمانی';
                const sub = [user.position_title || user.position, user.unit_name].filter(Boolean).join(' · ');
                return (
                  <button
                    key={user.user_id}
                    type="button"
                    onClick={() => void addOrganizer(user.user_id)}
                    disabled={busyUserId !== null}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-right transition hover:bg-gray-50 disabled:opacity-50 dark:hover:bg-gray-700/60"
                  >
                    {busyUserId === user.user_id ? <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-500" /> : <UserPlus className="h-3.5 w-3.5 text-teal-500" />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-semibold text-gray-700 dark:text-gray-200">{name}</p>
                      {sub && <p className="truncate text-[10px] text-gray-400">{sub}</p>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
