import { useState, useCallback } from 'react';
import { Settings as SettingsIcon, Shield, FileText } from 'lucide-react';
import { SecuritySettingsConsole } from '../../security-settings/components/SecuritySettingsConsole';
import { SecurityAdminManagement } from './SecurityAdminManagement';
import { SecurityAuditConsole } from './SecurityAuditConsole';
import { SecurityStepUpDialog } from '../../security-settings/components/SecurityStepUpDialog';
import { changeSecurityAdminRole } from '../services/securityAdministrationService';
import { getSecurityAdminErrorMessage } from '../utils/securityAdministrationValidation';
import toast from 'react-hot-toast';
import type { VersionConflictSnapshot } from '../types/securityAdministration';

type Tab = 'settings' | 'admins' | 'audit';

interface PendingChange {
  targetUserId: string;
  targetDisplayName: string;
  newValue: boolean;
  expectedVersion: number;
  changeReason: string;
}

export function SecurityControlCenter() {
  const [tab, setTab] = useState<Tab>('settings');
  const [stepUpOpen, setStepUpOpen] = useState(false);
  const [pendingChange, setPendingChange] = useState<PendingChange | null>(null);
  const [stepUpResult, setStepUpResult] = useState<{ targetUserId: string; success: boolean } | null>(null);
  const [conflict, setConflict] = useState<VersionConflictSnapshot | null>(null);
  const [, setChangeBusy] = useState(false);

  const handleOpenStepUp = useCallback((params: {
    targetUserId: string;
    targetDisplayName: string;
    newValue: boolean;
    expectedVersion: number;
    changeReason: string;
  }) => {
    setPendingChange(params);
    setStepUpOpen(true);
  }, []);

  const handleStepUpSuccess = useCallback(async () => {
    setStepUpOpen(false);

    if (!pendingChange) return;

    setChangeBusy(true);
    try {
      const result = await changeSecurityAdminRole({
        targetUserId: pendingChange.targetUserId,
        newValue: pendingChange.newValue,
        expectedVersion: pendingChange.expectedVersion,
        changeReason: pendingChange.changeReason,
      });

      if (!result.ok) {
        if (result.error === 'VERSION_CONFLICT') {
          setConflict({
            targetUserId: pendingChange.targetUserId,
            targetDisplayName: pendingChange.targetDisplayName,
            requestedValue: pendingChange.newValue,
            expectedVersion: pendingChange.expectedVersion,
            changeReason: pendingChange.changeReason,
          });
          toast.error(getSecurityAdminErrorMessage('VERSION_CONFLICT'));
        } else {
          toast.error(getSecurityAdminErrorMessage(result.error ?? 'UNKNOWN_SECURITY_ADMIN_ERROR'));
        }
        setStepUpResult({ targetUserId: pendingChange.targetUserId, success: false });
        return;
      }

      toast.success(pendingChange.newValue ? 'نقش مدیر امنیت اعطا شد.' : 'نقش مدیر امنیت حذف شد.');
      setConflict(null);
      setStepUpResult({ targetUserId: pendingChange.targetUserId, success: true });
    } catch {
      toast.error('خطای ناشناخته رخ داد.');
      setStepUpResult({ targetUserId: pendingChange.targetUserId, success: false });
    } finally {
      setChangeBusy(false);
      setPendingChange(null);
    }
  }, [pendingChange]);

  const handleStepUpConsumed = useCallback(() => {
    setStepUpResult(null);
  }, []);

  const tabs: { id: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { id: 'settings', label: 'تنظیمات امنیتی', icon: SettingsIcon },
    { id: 'admins', label: 'مدیران امنیت', icon: Shield },
    { id: 'audit', label: 'رویدادهای امنیتی', icon: FileText },
  ];

  return (
    <div className="space-y-4" dir="rtl">
      {/* Tab bar */}
      <div className="flex gap-2 border-b border-gray-100 dark:border-gray-700">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition ${
              tab === t.id
                ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {/* Conflict summary */}
      {conflict && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-2xl p-5 space-y-3">
          <h4 className="text-sm font-bold text-amber-800 dark:text-amber-200">تعارض نسخه</h4>
          <p className="text-xs text-amber-700 dark:text-amber-300">
            کاربر: {conflict.targetDisplayName} — نسخه مورد انتظار: {conflict.expectedVersion}
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            داده‌های جدید بارگذاری شده است. لطفاً تغییرات خود را بازبینی و دوباره اعمال کنید.
          </p>
        </div>
      )}

      {/* Tab content */}
      <div>
        {tab === 'settings' && <SecuritySettingsConsole />}
        {tab === 'admins' && (
          <SecurityAdminManagement
            onOpenStepUp={handleOpenStepUp}
            stepUpResult={stepUpResult}
            onStepUpConsumed={handleStepUpConsumed}
          />
        )}
        {tab === 'audit' && <SecurityAuditConsole />}
      </div>

      {/* Step-up dialog for role changes */}
      {stepUpOpen && pendingChange && (
        <SecurityStepUpDialog
          open={stepUpOpen}
          purpose="account_security_change"
          title="تأیید تغییر نقش امنیتی"
          description={`برای ${pendingChange.newValue ? 'اعطای' : 'حذف'} نقش مدیر امنیت از ${pendingChange.targetDisplayName}، کد ۶ رقمی را وارد کنید.`}
          confirmLabel="تأیید و اعمال"
          onClose={() => { setStepUpOpen(false); setPendingChange(null); }}
          onSuccess={handleStepUpSuccess}
        />
      )}
    </div>
  );
}
