import { useState } from 'react';
import { ChevronDown, ChevronUp, History, Clock } from 'lucide-react';
import type { SecurityHistoryEntry } from '../types/securitySettings';

interface Props {
  history: SecurityHistoryEntry[];
}

export function SecuritySettingsHistory({ history }: Props) {
  const [open, setOpen] = useState(false);

  if (history.length === 0) return null;

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-100 dark:border-gray-700 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition"
      >
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-gray-500" />
          <h4 className="text-sm font-semibold text-gray-800 dark:text-white">
            تاریخچه تغییرات امنیتی
          </h4>
          <span className="text-xs text-gray-400">({history.length} رکورد)</span>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
      </button>

      {open && (
        <div className="border-t border-gray-100 dark:border-gray-700 max-h-96 overflow-y-auto">
          {history.map((entry, i) => (
            <div key={i} className="px-4 py-3 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-xs font-mono text-gray-500 dark:text-gray-400">
                  نسخه {entry.version}
                </span>
                <span className="text-xs text-gray-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(entry.changed_at).toLocaleString('fa-IR')}
                </span>
              </div>
              <p className="text-xs text-gray-600 dark:text-gray-300 mb-1">
                {entry.change_reason || 'بدون دلیل ذکر شده'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <PolicyBadge label="MFA" value={entry.mfa_policy} />
                <LoginBadge label="نام کاربری" enabled={entry.username_login} />
                <LoginBadge label="ایمیل" enabled={entry.email_login} />
                <LoginBadge label="تلفن" enabled={entry.phone_login} />
                <LoginBadge label="TOTP" enabled={entry.allow_totp_mfa} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PolicyBadge({ label, value }: { label: string; value: string }) {
  const colors: Record<string, string> = {
    disabled: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
    optional: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
    required: 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colors[value] ?? colors.disabled}`}>
      {label}: {value}
    </span>
  );
}

function LoginBadge({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${enabled ? 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400' : 'bg-gray-100 dark:bg-gray-700 text-gray-400'}`}>
      {label}: {enabled ? 'روشن' : 'خاموش'}
    </span>
  );
}
