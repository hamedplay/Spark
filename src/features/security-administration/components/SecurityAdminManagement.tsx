import { useState, useCallback, useEffect, useRef } from 'react';
import { Loader as Loader2, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import toast from 'react-hot-toast';
import { loadSecurityAdminManagementState } from '../services/securityAdministrationService';
import { getSecurityAdminErrorMessage } from '../utils/securityAdministrationValidation';
import type { AdminManagementState, AdminUserRow } from '../types/securityAdministration';
import { SecurityAdminRoleDialog } from './SecurityAdminRoleDialog';
import { SecurityAdminHistory } from './SecurityAdminHistory';

interface Props {
  onOpenStepUp: (params: {
    targetUserId: string;
    targetDisplayName: string;
    newValue: boolean;
    expectedVersion: number;
    changeReason: string;
  }) => void;
  stepUpResult: { targetUserId: string; success: boolean } | null;
  onStepUpConsumed: () => void;
}

const PAGE_SIZE = 50;

export function SecurityAdminManagement({ onOpenStepUp, stepUpResult, onStepUpConsumed }: Props) {
  const [state, setState] = useState<AdminManagementState | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<AdminUserRow | null>(null);
  const [dialogNewValue, setDialogNewValue] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadIdRef = useRef(0);

  const loadData = useCallback(async (searchVal: string, offsetVal: number) => {
    const myLoadId = ++loadIdRef.current;
    setLoading(true);
    try {
      const result = await loadSecurityAdminManagementState(searchVal || undefined, PAGE_SIZE, offsetVal);
      if (myLoadId !== loadIdRef.current) return;
      if (result.ok) {
        setState(result);
      } else {
        toast.error(getSecurityAdminErrorMessage(result.error));
      }
    } finally {
      if (myLoadId === loadIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setOffset(0);
      void loadData(search, 0);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search, loadData]);

  useEffect(() => {
    void loadData(search, offset);
  }, [offset, loadData, search]);

  // Handle step-up success: trigger the actual role change
  useEffect(() => {
    if (!stepUpResult || !stepUpResult.success) return;
    // The actual setter call is handled by the parent which has the snapshot
    onStepUpConsumed();
  }, [stepUpResult, onStepUpConsumed]);

  const handleInitiateChange = useCallback((target: AdminUserRow, newValue: boolean) => {
    setDialogTarget(target);
    setDialogNewValue(newValue);
    setDialogOpen(true);
  }, []);

  const handleConfirmChange = useCallback((reason: string) => {
    if (!dialogTarget) return;
    setDialogOpen(false);
    onOpenStepUp({
      targetUserId: dialogTarget.user_id,
      targetDisplayName: dialogTarget.full_name ?? dialogTarget.username ?? dialogTarget.user_id,
      newValue: dialogNewValue,
      expectedVersion: dialogTarget.security_role_version ?? 0,
      changeReason: reason,
    });
  }, [dialogTarget, dialogNewValue, onOpenStepUp]);

  const actorHasTotp = state?.summary.current_actor_has_verified_totp ?? false;

  if (loading && !state) {
    return (
      <div className="flex justify-center items-center h-48">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!state) {
    return <div className="p-6 text-center text-sm text-gray-500" dir="rtl">خطا در بارگذاری داده‌ها.</div>;
  }

  return (
    <div className="space-y-4" dir="rtl">
      {!actorHasTotp && (
        <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-sm text-amber-700 dark:text-amber-300">
          برای مدیریت مدیران امنیت، ابتدا TOTP را در پروفایل خود فعال کنید.
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="جستجوی کاربر..."
            className="w-full pr-10 pl-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-gray-100 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr className="text-right text-xs text-gray-500 dark:text-gray-400">
              <th className="px-4 py-3 font-medium">کاربر</th>
              <th className="px-4 py-3 font-medium">وضعیت حساب</th>
              <th className="px-4 py-3 font-medium">نقش ادمین عمومی</th>
              <th className="px-4 py-3 font-medium">نقش مدیر امنیت</th>
              <th className="px-4 py-3 font-medium">TOTP</th>
              <th className="px-4 py-3 font-medium">نسخه نقش</th>
              <th className="px-4 py-3 font-medium">عملیات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {state.users.map((user) => (
              <tr key={user.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {user.avatar_url && (
                      <img src={user.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                    )}
                    <div>
                      <div className="font-medium text-gray-800 dark:text-white">
                        {user.full_name ?? user.username ?? user.user_id}
                      </div>
                      {user.email && <div className="text-xs text-gray-400">{user.email}</div>}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={user.account_status} isActive={user.is_active} />
                </td>
                <td className="px-4 py-3">
                  {user.is_admin && <Badge color="blue">ادمین سامانه</Badge>}
                </td>
                <td className="px-4 py-3">
                  {user.is_security_admin ? <Badge color="red">مدیر امنیت</Badge> : <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {user.has_verified_totp
                    ? <Badge color="green">TOTP فعال</Badge>
                    : <Badge color="gray">TOTP غیرفعال</Badge>}
                </td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">
                  {user.security_role_version ?? 0}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-2">
                    {!user.is_security_admin && user.eligibility.can_grant && (
                      <button
                        type="button"
                        onClick={() => handleInitiateChange(user, true)}
                        disabled={!actorHasTotp}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition disabled:opacity-50"
                      >
                        اعطا
                      </button>
                    )}
                    {user.is_security_admin && user.eligibility.can_revoke && (
                      <button
                        type="button"
                        onClick={() => handleInitiateChange(user, false)}
                        disabled={!actorHasTotp}
                        className="px-3 py-1.5 text-xs font-medium bg-red-500 hover:bg-red-600 text-white rounded-lg transition disabled:opacity-50"
                      >
                        حذف
                      </button>
                    )}
                    {user.is_current_actor && (
                      <span className="text-xs text-gray-400">شما</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {state.users.length === 0 && !loading && (
        <div className="p-6 text-center text-sm text-gray-400">کاربری یافت نشد.</div>
      )}

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          disabled={offset === 0 || loading}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <ChevronRight className="w-4 h-4" /> قبلی
        </button>
        <span className="text-xs text-gray-400">صفحه {Math.floor(offset / PAGE_SIZE) + 1}</span>
        <button
          type="button"
          onClick={() => setOffset(offset + PAGE_SIZE)}
          disabled={state.users.length < PAGE_SIZE || loading}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          بعدی <ChevronLeft className="w-4 h-4" />
        </button>
      </div>

      <SecurityAdminHistory history={state.history} />

      {dialogOpen && dialogTarget && (
        <SecurityAdminRoleDialog
          target={dialogTarget}
          newValue={dialogNewValue}
          onClose={() => setDialogOpen(false)}
          onConfirm={handleConfirmChange}
        />
      )}
    </div>
  );
}

function StatusBadge({ status, isActive }: { status: string | null; isActive: boolean | null }) {
  if (isActive && status === 'ACTIVE') return <Badge color="green">Active</Badge>;
  if (status === 'SUSPENDED') return <Badge color="amber">Suspended</Badge>;
  if (status === 'LOCKED') return <Badge color="red">Locked</Badge>;
  return <Badge color="gray">{status ?? 'نامشخص'}</Badge>;
}

function Badge({ color, children }: { color: 'blue' | 'red' | 'green' | 'gray' | 'amber'; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[color]}`}>{children}</span>;
}
