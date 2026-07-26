import { ShieldOff, Clock } from 'lucide-react';

export function BanDetailModal({ banDetail, onClose }: {
  banDetail: { reason: string | null; expiresAt: string | null };
  onClose: () => void;
}) {
  return (
    <div role="dialog" aria-modal="true" aria-label="مسدودیت" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-gray-900 border border-red-800/60 rounded-2xl p-6 w-full max-w-sm space-y-4" dir="rtl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-red-900/40 flex items-center justify-center flex-shrink-0">
            <ShieldOff className="w-5 h-5 text-red-400" />
          </div>
          <div>
            <h3 className="text-white font-bold">دسترسی مسدود شده</h3>
            <p className="text-red-400 text-xs">ورود به این اتاق برای شما ممکن نیست</p>
          </div>
        </div>
        {banDetail.reason && (
          <div className="bg-red-950/50 border border-red-800/40 rounded-xl p-3">
            <p className="text-red-400 text-xs mb-1">دلیل مسدودیت:</p>
            <p className="text-red-200 text-sm">{banDetail.reason}</p>
          </div>
        )}
        <div className={`flex items-center gap-2 text-xs rounded-xl px-3 py-2 ${banDetail.expiresAt ? 'bg-amber-950/40 text-amber-400' : 'bg-red-950/40 text-red-400'}`}>
          <Clock className="w-3.5 h-3.5 flex-shrink-0" />
          {banDetail.expiresAt ? (() => {
            const diff = Math.ceil((new Date(banDetail.expiresAt).getTime() - Date.now()) / 60000);
            if (diff <= 0) return 'مسدودیت منقضی شده — لطفاً دوباره تلاش کنید';
            if (diff < 60) return `رفع مسدودیت پس از ${diff} دقیقه`;
            const h = Math.floor(diff / 60);
            const m = diff % 60;
            return `رفع مسدودیت پس از ${h} ساعت${m ? ` و ${m} دقیقه` : ''}`;
          })() : 'مسدودیت دائمی'}
        </div>
        <button onClick={onClose} className="w-full py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-xl text-sm transition-colors">باشه</button>
      </div>
    </div>
  );
}
