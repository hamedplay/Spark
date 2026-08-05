import { useState, useEffect } from 'react';
import { X, Shield, ShieldOff, Check } from 'lucide-react';
import type { AdminUserRow } from '../types/securityAdministration';

interface Props {
  target: AdminUserRow;
  newValue: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}

export function SecurityAdminRoleDialog({ target, newValue, onClose, onConfirm }: Props) {
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    setReason('');
    setConfirmed(false);
  }, [target.user_id]);

  const isGrant = newValue;
  const reasonValid = reason.trim().length >= 10 && reason.trim().length <= 500;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center bg-black/50" dir="rtl">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-lg w-full mx-4 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-800 dark:text-white flex items-center gap-2">
            {isGrant ? <Shield className="w-5 h-5 text-blue-500" /> : <ShieldOff className="w-5 h-5 text-red-500" />}
            {isGrant ? 'اعطای نقش مدیر امنیت' : 'حذف نقش مدیر امنیت'}
          </h3>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <Row label="کاربر هدف" value={target.full_name ?? target.username ?? target.user_id} />
          <Row label="عملیات" value={isGrant ? 'اعطا (Grant)' : 'حذف (Revoke)'} />
          <Row label="وضعیت فعلی" value={target.is_security_admin ? 'مدیر امنیت' : 'کاربر عادی'} />
          <Row label="وضعیت جدید" value={isGrant ? 'مدیر امنیت' : 'کاربر عادی'} />
          <Row label="نسخه فعلی نقش" value={String(target.security_role_version ?? 0)} />
          <Row label="وضعیت TOTP" value={target.has_verified_totp ? 'فعال' : 'غیرفعال'} />
        </div>

        <div>
          <label className="text-sm font-medium text-gray-600 dark:text-gray-400 mb-2 block">
            دلیل تغییر <span className="text-red-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            maxLength={500}
            placeholder="دلیل این تغییر را توضیح دهید (حداقل ۱۰ کاراکتر)..."
            className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <p className="text-xs text-gray-400 mt-1">{reason.trim().length}/500</p>
        </div>

        <label className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl cursor-pointer">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-400"
          />
          <span className="text-sm text-gray-600 dark:text-gray-300">
            {isGrant
              ? 'تأیید می‌کنم این کاربر به تنظیمات و رویدادهای امنیتی دسترسی خواهد داشت.'
              : 'تأیید می‌کنم دسترسی امنیتی این کاربر حذف خواهد شد.'}
          </span>
        </label>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => reasonValid && confirmed && onConfirm(reason)}
            disabled={!reasonValid || !confirmed}
            className="flex-1 flex items-center justify-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium transition disabled:opacity-50"
          >
            <Check className="w-4 h-4" />
            تأیید و ادامه
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2.5 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-xl text-sm font-medium transition"
          >
            انصراف
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-800 dark:text-white">{value}</span>
    </div>
  );
}
