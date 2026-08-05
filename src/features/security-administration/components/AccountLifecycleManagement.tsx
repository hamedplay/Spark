import { useState, useEffect, useCallback } from 'react';
import { Loader as Loader2, Search, ListFilter as Filter } from 'lucide-react';
import { loadLifecycleState } from '../services/accountLifecycleService';
import { AccountLifecycleActionDialog } from './AccountLifecycleActionDialog';
import { AccountLifecycleHistory } from './AccountLifecycleHistory';
import type { LifecycleState, LifecycleUser, LifecycleAction } from '../types/accountLifecycle';
import { STATUS_LABELS, STATUS_COLORS, ACTION_LABELS } from '../types/accountLifecycle';

const STATUS_FILTERS = [
  { value: '', label: 'همه وضعیت‌ها' },
  { value: 'PENDING_ADMIN_APPROVAL', label: 'در انتظار تأیید' },
  { value: 'ACTIVE', label: 'فعال' },
  { value: 'SUSPENDED', label: 'معلق' },
  { value: 'REJECTED', label: 'رد شده' },
  { value: 'PHONE_UNVERIFIED', label: 'تأیید نشده' },
];

export function AccountLifecycleManagement() {
  const [state, setState] = useState<LifecycleState | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [actionDialog, setActionDialog] = useState<{ user: LifecycleUser; action: LifecycleAction } | null>(null);
  const [historyUser, setHistoryUser] = useState<LifecycleUser | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadLifecycleState(statusFilter || null, search || null, 50, offset);
      setState(data);
    } catch {
      setState(null);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleActionComplete = () => {
    setActionDialog(null);
    void load();
  };

  return (
    <div className="space-y-4" dir="rtl">
      {/* Summary */}
      {state?.summary && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <SummaryCard label="در انتظار" value={state.summary.pending_approval} color="amber" />
          <SummaryCard label="فعال" value={state.summary.active} color="green" />
          <SummaryCard label="معلق" value={state.summary.suspended} color="orange" />
          <SummaryCard label="رد شده" value={state.summary.rejected} color="red" />
          <SummaryCard label="تأیید نشده" value={state.summary.phone_unverified} color="gray" />
          <SummaryCard label="قفل شده" value={state.summary.locked} color="red" />
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <Filter className="w-4 h-4 text-gray-400" />
        <select
          value={statusFilter}
          onChange={e => { setStatusFilter(e.target.value); setOffset(0); }}
          className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
        >
          {STATUS_FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>
        <div className="relative">
          <input
            type="text"
            value={search}
            onChange={e => { setSearch(e.target.value); setOffset(0); }}
            placeholder="جستجو..."
            className="px-3 py-1.5 pr-9 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 text-teal-500 animate-spin" />
        </div>
      ) : state?.users?.length ? (
        <div className="overflow-x-auto rounded-2xl border border-gray-100 dark:border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50">
              <tr className="text-right text-xs text-gray-500 dark:text-gray-400">
                <th className="px-3 py-3 font-medium">نام</th>
                <th className="px-3 py-3 font-medium">نام کاربری</th>
                <th className="px-3 py-3 font-medium">ایمیل</th>
                <th className="px-3 py-3 font-medium">موبایل</th>
                <th className="px-3 py-3 font-medium">وضعیت</th>
                <th className="px-3 py-3 font-medium">موبایل تأیید</th>
                <th className="px-3 py-3 font-medium">نسخه</th>
                <th className="px-3 py-3 font-medium">عملیات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {state.users.map(user => (
                <tr key={user.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                  <td className="px-3 py-2.5 text-gray-800 dark:text-white">{user.full_name || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300">{user.username || '—'}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 font-mono text-xs">{user.masked_email}</td>
                  <td className="px-3 py-2.5 text-gray-600 dark:text-gray-300 font-mono text-xs">{user.masked_phone}</td>
                  <td className="px-3 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[user.account_status] ?? STATUS_COLORS.PHONE_UNVERIFIED}`}>
                      {STATUS_LABELS[user.account_status] ?? user.account_status}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-gray-500">{user.phone_verified ? 'بله' : 'خیر'}</td>
                  <td className="px-3 py-2.5 text-xs text-gray-400">{user.account_lifecycle_version}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {user.eligibility.can_approve && (
                        <ActionButton label={ACTION_LABELS.APPROVE} color="green" onClick={() => setActionDialog({ user, action: 'APPROVE' })} />
                      )}
                      {user.eligibility.can_reject && (
                        <ActionButton label={ACTION_LABELS.REJECT} color="red" onClick={() => setActionDialog({ user, action: 'REJECT' })} />
                      )}
                      {user.eligibility.can_reopen && (
                        <ActionButton label={ACTION_LABELS.REOPEN} color="amber" onClick={() => setActionDialog({ user, action: 'REOPEN' })} />
                      )}
                      {user.eligibility.can_suspend && (
                        <ActionButton label={ACTION_LABELS.SUSPEND} color="orange" onClick={() => setActionDialog({ user, action: 'SUSPEND' })} />
                      )}
                      {user.eligibility.can_reactivate && (
                        <ActionButton label={ACTION_LABELS.REACTIVATE} color="green" onClick={() => setActionDialog({ user, action: 'REACTIVATE' })} />
                      )}
                      <ActionButton label="تاریخچه" color="blue" onClick={() => setHistoryUser(user)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-6 text-center text-sm text-gray-400">کاربری یافت نشد.</div>
      )}

      {/* Pagination */}
      {state?.pagination && (
        <div className="flex justify-between items-center text-sm">
          <span className="text-gray-500">
            {state.pagination.total_matches} کاربر — صفحه {Math.floor(offset / 50) + 1}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setOffset(Math.max(0, offset - 50))}
              disabled={offset === 0}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-50"
            >
              قبلی
            </button>
            <button
              onClick={() => setOffset(offset + 50)}
              disabled={!state.pagination.has_more}
              className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-50"
            >
              بعدی
            </button>
          </div>
        </div>
      )}

      {/* Action Dialog */}
      {actionDialog && (
        <AccountLifecycleActionDialog
          user={actionDialog.user}
          action={actionDialog.action}
          onClose={() => setActionDialog(null)}
          onComplete={handleActionComplete}
        />
      )}

      {/* History Dialog */}
      {historyUser && (
        <AccountLifecycleHistory user={historyUser} onClose={() => setHistoryUser(null)} />
      )}
    </div>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  const colors: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300',
    green: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300',
    orange: 'bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-300',
    red: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300',
    gray: 'bg-gray-50 text-gray-600 dark:bg-gray-700/50 dark:text-gray-400',
    blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/20 dark:text-blue-300',
  };
  return (
    <div className={`rounded-xl p-3 ${colors[color] ?? colors.gray}`}>
      <div className="text-lg font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function ActionButton({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  const colors: Record<string, string> = {
    green: 'bg-green-100 text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-300',
    red: 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-300',
    amber: 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-300',
    orange: 'bg-orange-100 text-orange-700 hover:bg-orange-200 dark:bg-orange-900/30 dark:text-orange-300',
    blue: 'bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/30 dark:text-blue-300',
  };
  return (
    <button
      onClick={onClick}
      className={`px-2 py-0.5 rounded-md text-xs font-medium transition ${colors[color] ?? colors.blue}`}
    >
      {label}
    </button>
  );
}
