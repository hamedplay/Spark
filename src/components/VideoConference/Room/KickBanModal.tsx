import { UserX, ShieldOff, X } from 'lucide-react';

export interface KickConfirmData {
  peerId: string;
  userId: string;
  displayName: string;
}

export interface PendingBanData {
  durationMinutes: number | null;
  label: string;
}

export function KickBanModal(props: {
  kickConfirm: KickConfirmData;
  pendingBan: PendingBanData | null;
  banReason: string;
  setBanReason: (v: string) => void;
  canBan: boolean;
  onKick: () => void;
  onSelectBanDuration: (durationMinutes: number | null, label: string) => void;
  onConfirmBan: () => void;
  onBackFromBan: () => void;
  onClose: () => void;
}) {
  const { kickConfirm, pendingBan, banReason, setBanReason, canBan, onKick, onSelectBanDuration, onConfirmBan, onBackFromBan, onClose } = props;

  const banDurations: { label: string; min: number | null }[] = [
    { label: '۱ دقیقه', min: 1 },
    { label: '۵ دقیقه', min: 5 },
    { label: '۱۵ دقیقه', min: 15 },
    { label: '۳۰ دقیقه', min: 30 },
    { label: 'دائمی', min: null },
  ];

  return (
    <div role="dialog" aria-modal="true" aria-label="مدیریت کاربر" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl p-5 w-full max-w-sm space-y-3" dir="rtl">
        {/* Header */}
        <div className="flex items-center gap-3 pb-2 border-b border-gray-800">
          <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center text-sm font-bold text-white flex-shrink-0">
            {kickConfirm.displayName[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <h3 className="text-white font-bold text-sm">{kickConfirm.displayName}</h3>
            <p className="text-gray-500 text-xs">{pendingBan ? `مسدودی ${pendingBan.label}` : 'انتخاب عملیات'}</p>
          </div>
          <button
            onClick={onClose}
            className="mr-auto p-1 text-gray-500 hover:text-white"
          ><X className="w-4 h-4" /></button>
        </div>

        {/* Step 2: reason input after duration selected */}
        {pendingBan ? (
          <div className="space-y-3">
            <div>
              <label className="block text-xs text-gray-400 mb-1.5">دلیل مسدودسازی <span className="text-gray-600">(اختیاری)</span></label>
              <textarea
                value={banReason}
                onChange={e => setBanReason(e.target.value)}
                placeholder="مثلاً: رفتار نامناسب، ارسال اسپم..."
                rows={2}
                maxLength={200}
                autoFocus
                className="w-full p-2.5 bg-gray-800 border border-gray-700 rounded-xl text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-600 resize-none"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={onConfirmBan}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-sm font-medium transition-colors"
              >
                تأیید مسدودسازی
              </button>
              <button
                onClick={onBackFromBan}
                className="px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-xl text-sm transition-colors"
              >
                برگشت
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Kick — no ban */}
            <button
              onClick={onKick}
              className="w-full flex items-center gap-3 p-3 bg-gray-800 hover:bg-gray-700 rounded-xl text-sm text-gray-200 transition-colors text-right"
            >
              <UserX className="w-4 h-4 text-amber-400 flex-shrink-0" />
              <div>
                <p className="font-medium">اخراج (بدون مسدودی)</p>
                <p className="text-xs text-gray-500">کاربر می‌تواند دوباره وارد شود</p>
              </div>
            </button>

            {canBan && (<>
              <p className="text-xs text-gray-500 px-1">مسدود کردن:</p>
              {banDurations.map(({ label, min }) => (
                <button
                  key={label}
                  onClick={() => onSelectBanDuration(min, label)}
                  className="w-full flex items-center gap-3 p-3 bg-gray-800 hover:bg-red-900/30 rounded-xl text-sm text-gray-200 hover:text-red-300 transition-colors text-right"
                >
                  <ShieldOff className="w-4 h-4 text-red-400 flex-shrink-0" />
                  <span>مسدودی {label}</span>
                </button>
              ))}
            </>)}

            <button
              onClick={onClose}
              className="w-full py-2 text-gray-500 hover:text-gray-300 text-sm transition-colors"
            >
              انصراف
            </button>
          </>
        )}
      </div>
    </div>
  );
}
